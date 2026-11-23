import { describe, expect, it, vi } from "vitest";
import { NoopRefiner } from "../src/llm.js";
import { ModQueue } from "../src/queue.js";
import { ModService } from "../src/service.js";
import { suggest } from "../src/suggest.js";
import type { TelegramGateway } from "../src/telegram.js";

const gateway = (over: Partial<TelegramGateway> = {}): TelegramGateway => ({
  banChatMember: vi.fn(async () => {}),
  unbanChatMember: vi.fn(async () => {}),
  muteChatMember: vi.fn(async () => {}),
  unmuteChatMember: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
  ...over,
});

const base = { chatId: 1, chatTitle: "G", userId: 2, username: "u", text: "t", messageId: 3, risk: "high" as const, score: 0.9, reason: "r" };

describe("suggestions and repeat offenders", () => {
  it("counts offenses per user and chat", () => {
    const q = new ModQueue();
    expect(q.add(base).offenses).toBe(1);
    expect(q.add(base).offenses).toBe(2);
    expect(q.add({ ...base, userId: 9 }).offenses).toBe(1);
    expect(q.add({ ...base, chatId: 5 }).offenses).toBe(1);
  });

  it("escalates the suggestion with repeat offenses", () => {
    expect(suggest("high", 1)).toEqual({ action: "mute", muteMinutes: 1440, deleteRecent: 1 });
    expect(suggest("high", 2)).toEqual({ action: "ban", deleteRecent: 10 });
    expect(suggest("medium", 1)).toEqual({ action: "mute", muteMinutes: 60, deleteRecent: 1 });
    expect(suggest("medium", 3)).toEqual({ action: "ban", deleteRecent: 10 });
    expect(suggest("low", 1)).toEqual({ action: "ignore" });
  });

  it("keeps offense counts across restarts", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(mkdtempSync(join(tmpdir(), "gavel-")), "q.json");
    new ModQueue(file).add(base);
    expect(new ModQueue(file).add(base).offenses).toBe(2);
  });
});

describe("action safety", () => {
  it("a second action on a card being processed is rejected", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tg = gateway({ banChatMember: vi.fn(() => gate) });
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const added = service.queue.add(base);
    const first = service.act(added.id, { action: "ban" });
    const second = await service.act(added.id, { action: "ignore" });
    expect(second).toBeNull();
    release();
    expect(await first).not.toBeNull();
    expect(tg.banChatMember).toHaveBeenCalledTimes(1);
  });

  it("a failed Telegram call puts the card back so it can be retried", async () => {
    const tg = gateway({ banChatMember: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined) });
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const added = service.queue.add(base);
    await expect(service.act(added.id, { action: "ban" })).rejects.toThrow("boom");
    expect(service.queue.stats()).toEqual({ pending: 1, handled: 0 });
    expect(await service.act(added.id, { action: "ban" })).not.toBeNull();
    expect(service.queue.stats()).toEqual({ pending: 0, handled: 1 });
  });

  it("actions on the same user run one after another", async () => {
    const order: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tg = gateway({
      muteChatMember: vi.fn(async () => {
        order.push("mute-start");
        await gate;
        order.push("mute-end");
      }),
      banChatMember: vi.fn(async () => {
        order.push("ban");
      }),
    });
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const a = service.queue.add(base);
    const b = service.queue.add({ ...base, messageId: 4 });
    const p1 = service.act(a.id, { action: "mute" });
    const p2 = service.act(b.id, { action: "ban" });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(["mute-start"]);
    release();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["mute-start", "mute-end", "ban"]);
  });

  it("an undo token is dead once a newer action hit the same user", async () => {
    const tg = gateway();
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const a = service.queue.add(base);
    const b = service.queue.add({ ...base, messageId: 4 });
    const first = await service.act(a.id, { action: "mute" });
    await service.act(b.id, { action: "ban" });
    expect(await service.undo(first!.undoToken)).toBe(false);
    expect(tg.unmuteChatMember).not.toHaveBeenCalled();
  });

  it("a failed undo keeps the token so it can be retried", async () => {
    const tg = gateway({ unbanChatMember: vi.fn().mockRejectedValueOnce(new Error("net")).mockResolvedValue(undefined) });
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const a = service.queue.add(base);
    const done = await service.act(a.id, { action: "ban" });
    await expect(service.undo(done!.undoToken)).rejects.toThrow("net");
    expect(await service.undo(done!.undoToken)).toBe(true);
    expect(service.queue.stats()).toEqual({ pending: 1, handled: 0 });
  });
});

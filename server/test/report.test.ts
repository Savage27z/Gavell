import { describe, expect, it, vi } from "vitest";
import { NoopRefiner } from "../src/llm.js";
import { ModQueue } from "../src/queue.js";
import { ModService } from "../src/service.js";
import type { TelegramGateway } from "../src/telegram.js";

const gw = (members: Record<string, string>) =>
  ({
    banChatMember: vi.fn(),
    muteChatMember: vi.fn(),
    unbanChatMember: vi.fn(),
    unmuteChatMember: vi.fn(),
    deleteMessage: vi.fn(),
    memberStatus: vi.fn(async (c: number, u: number) => members[c + ":" + u] ?? "left"),
  }) as unknown as TelegramGateway & { muteChatMember: ReturnType<typeof vi.fn>; deleteMessage: ReturnType<typeof vi.fn>; banChatMember: ReturnType<typeof vi.fn> };
const make = (members: Record<string, string>, now = () => 1_000_000) => {
  const tg = gw(members);
  const service = new ModService(new ModQueue(), tg, new NoopRefiner(), now);
  service.noteChat(-1, "Base Degens");
  service.noteChat(-2, "Other Chat");
  return { tg, service };
};
const scam = "Hi, I'm from Phantom Support. Your wallet has a sync error. DM me to validate: phantom-validate.xyz";

describe("member reports (forwarded DMs)", () => {
  it("queues one item per moderated group the scammer is in, and never acts by itself", async () => {
    const { tg, service } = make({ "-1:10": "member", "-2:10": "member", "-1:99": "member", "-2:99": "member" });
    const res = await service.report({ reporterId: 10, text: scam, sender: { userId: 99, username: "evil" } });
    expect(res).toMatchObject({ status: "queued", targets: 2 });
    expect(service.queue.stats().pending).toBe(2);
    expect(service.queue.next()!.source).toBe("report");
    expect(tg.muteChatMember).not.toHaveBeenCalled();
    expect(tg.deleteMessage).not.toHaveBeenCalled();
    expect(tg.banChatMember).not.toHaveBeenCalled();
  });

  it("rejects reporters who are not members of any moderated group", async () => {
    const { service } = make({ "-1:99": "member" });
    expect(await service.report({ reporterId: 10, text: scam, sender: { userId: 99 } })).toEqual({ status: "rejected", reason: "not-member" });
    expect(service.queue.stats().pending).toBe(0);
  });

  it("rate limits a reporter to 5 reports per 10 minutes", async () => {
    let t = 1_000_000;
    const { service } = make({ "-1:10": "member", "-1:99": "member" }, () => t);
    for (let i = 0; i < 5; i++) expect((await service.report({ reporterId: 10, text: scam + " " + i, sender: { userId: 99 } })).status).toBe("queued");
    expect(await service.report({ reporterId: 10, text: scam, sender: { userId: 99 } })).toEqual({ status: "rejected", reason: "rate-limit" });
    t += 11 * 60_000;
    expect((await service.report({ reporterId: 10, text: scam, sender: { userId: 99 } })).status).toBe("queued");
  });

  it("merges reports of the same scammer into one REPORTED xN item", async () => {
    const { service } = make({ "-1:10": "member", "-1:11": "member", "-1:12": "member", "-1:99": "member" });
    for (const r of [10, 11, 12, 10]) await service.report({ reporterId: r, text: scam, sender: { userId: 99 } });
    expect(service.queue.stats().pending).toBe(1);
    expect(service.queue.next()!.reports).toBe(3);
  });

  it("a hidden sender gives an item that can only be ignored, and never touches Telegram", async () => {
    const { tg, service } = make({ "-1:10": "member" });
    expect(await service.report({ reporterId: 10, text: scam, sender: { name: "Support Team" } })).toMatchObject({ status: "queued", targets: 0 });
    const item = service.queue.next()!;
    expect(item.userId).toBe(0);
    expect(item.suggested.action).toBe("ignore");
    await service.act(item.id, { action: "mute", muteMinutes: 60 });
    expect(tg.muteChatMember).not.toHaveBeenCalled();
  });

  it("a real report mutes only on an explicit action, and never tries to delete message id 0", async () => {
    const { tg, service } = make({ "-1:10": "member", "-1:99": "member" });
    await service.report({ reporterId: 10, text: scam, sender: { userId: 99, username: "evil" } });
    const item = service.queue.next()!;
    expect(item.risk).not.toBe("low");
    await service.act(item.id, { action: "mute", muteMinutes: 60, deleteRecent: 3 });
    expect(tg.muteChatMember).toHaveBeenCalledTimes(1);
    expect(tg.deleteMessage).not.toHaveBeenCalledWith(-1, 0);
  });
});

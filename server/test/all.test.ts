import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { classify } from "../src/classifier.js";
import { parseIntent } from "../src/intent.js";
import { NoopRefiner } from "../src/llm.js";
import { ModQueue } from "../src/queue.js";
import { ModService } from "../src/service.js";
import type { TelegramGateway } from "../src/telegram.js";

const mockTg = (): TelegramGateway => ({
  banChatMember: vi.fn(async () => {}),
  unbanChatMember: vi.fn(async () => {}),
  muteChatMember: vi.fn(async () => {}),
  unmuteChatMember: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
});

const item = (over = {}) => ({
  chatId: 1, chatTitle: "G", userId: 2, username: "u", text: "t", messageId: 3,
  risk: "low" as const, score: 0.1, reason: "r", ...over,
});

describe("classifier", () => {
  it("flags seed phrase scams high", () => {
    const v = classify("Admin here, send your 12-word seed phrase in DM. Urgent");
    expect(v.risk).toBe("high");
    expect(v.reason.length).toBeLessThanOrEqual(60);
  });
  it("leaves benign chat low", () => {
    expect(classify("gm everyone, ETH looking good today").risk).toBe("low");
  });
  it("new account boosts score", () => {
    const text = "dm me for signals";
    expect(classify(text, 1).score).toBeGreaterThan(classify(text, 400).score);
  });
});

describe("queue ordering", () => {
  it("returns highest risk first, then oldest", () => {
    const q = new ModQueue();
    q.add(item({ text: "old-med", risk: "medium", flaggedAt: "2026-01-01T00:00:00Z" }));
    q.add(item({ text: "new-high", risk: "high", flaggedAt: "2026-01-03T00:00:00Z" }));
    q.add(item({ text: "old-high", risk: "high", flaggedAt: "2026-01-02T00:00:00Z" }));
    expect(q.next()?.text).toBe("old-high");
    expect(q.next()?.text).toBe("old-high");
  });
});

describe("intent parsing", () => {
  it("ban + delete last N", () => {
    expect(parseIntent("ban and delete their last 10")).toEqual({ action: "ban", deleteRecent: 10 });
  });
  it("mute for a day", () => {
    expect(parseIntent("mute for a day")).toEqual({ action: "mute", muteMinutes: 1440 });
  });
  it("mute for 2 hours", () => {
    expect(parseIntent("mute for 2 hours")).toEqual({ action: "mute", muteMinutes: 120 });
  });
  it("ignore", () => {
    expect(parseIntent("ignore this one")).toEqual({ action: "ignore" });
    expect(parseIntent("not a scam")).toEqual({ action: "ignore" });
    expect(parseIntent("do not ban them, keep it")).toBeNull();
    expect(parseIntent("don't mute")).toBeNull();
    expect(parseIntent("skip")).toBeNull();
    expect(parseIntent("ignore and delete their last 5")).toBeNull();
  });
  it("rejects gibberish", () => {
    expect(parseIntent("what is the weather")).toBeNull();
  });
});

describe("http contract", () => {
  const setup = () => {
    const tg = mockTg();
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const app = buildApp({ service, pairingCode: "pw", transcriber: null, production: false });
    const headers = { "x-pairing-code": "pw" };
    return { tg, service, app, headers };
  };

  it("health open, others need pairing code", async () => {
    const { app } = setup();
    expect((await app.inject("/health")).json()).toEqual({ ok: true });
    expect((await app.inject("/queue/stats")).statusCode).toBe(401);
  });

  it("204 when empty, seed fills queue", async () => {
    const { app, headers } = setup();
    expect((await app.inject({ url: "/queue/next", headers })).statusCode).toBe(204);
    const seeded = await app.inject({ method: "POST", url: "/dev/seed", headers });
    expect(seeded.json().added).toBeGreaterThanOrEqual(12);
    expect((await app.inject({ url: "/queue/next", headers })).json().risk).toBe("high");
  });

  it("ban executes, deletes, then undo restores", async () => {
    const { app, tg, service, headers } = setup();
    service.queue.add(item());
    const next = (await app.inject({ url: "/queue/next", headers })).json();
    const res = await app.inject({ method: "POST", url: `/queue/${next.id}/action`, headers, payload: { action: "ban" } });
    expect(res.json().ok).toBe(true);
    expect(tg.banChatMember).toHaveBeenCalledWith(next.chatId, next.userId);
    expect(tg.deleteMessage).toHaveBeenCalledWith(next.chatId, next.messageId);
    const stats = (await app.inject({ url: "/queue/stats", headers })).json();
    expect(stats.handled).toBe(1);
    const undo = await app.inject({ method: "POST", url: "/queue/undo", headers, payload: { undoToken: res.json().undoToken } });
    expect(undo.json().ok).toBe(true);
    expect(tg.unbanChatMember).toHaveBeenCalledWith(next.chatId, next.userId);
    expect((await app.inject({ url: "/queue/stats", headers })).json().handled).toBe(0);
  });

  it("skip cycles to the next item and wraps when all are skipped", async () => {
    const { app, service, headers } = setup();
    const a = service.queue.add(item());
    const b = service.queue.add(item());
    const skipped = (await app.inject({ url: `/queue/next?skip=${a.id}`, headers })).json();
    expect(skipped.id).toBe(b.id);
    const wrapped = (await app.inject({ url: `/queue/next?skip=${a.id},${b.id}`, headers })).json();
    expect([a.id, b.id]).toContain(wrapped.id);
  });

  it("seeded demo items never reach Telegram", async () => {
    const { app, tg, headers } = setup();
    await app.inject({ method: "POST", url: "/dev/seed", headers });
    const next = (await app.inject({ url: "/queue/next", headers })).json();
    const res = await app.inject({ method: "POST", url: `/queue/${next.id}/action`, headers, payload: { action: "ban" } });
    expect(res.json().ok).toBe(true);
    expect(tg.banChatMember).not.toHaveBeenCalled();
  });

  it("mute uses default 1440 minutes", async () => {
    const { app, tg, service, headers } = setup();
    const added = service.queue.add(item());
    await app.inject({ method: "POST", url: `/queue/${added.id}/action`, headers, payload: { action: "mute" } });
    const until = vi.mocked(tg.muteChatMember).mock.calls[0]![2];
    expect(until - Math.floor(Date.now() / 1000)).toBeGreaterThan(1440 * 60 - 5);
  });

  it("deleteRecent removes known recent messages", async () => {
    const { app, tg, service, headers } = setup();
    for (const id of [11, 12, 13]) {
      await service.ingest({ chatId: 1, chatTitle: "G", userId: 2, username: "u", text: "hi", messageId: id });
    }
    const flagged = await service.ingest({ chatId: 1, chatTitle: "G", userId: 2, username: "u", text: "DM me your seed phrase, support here", messageId: 14 });
    await app.inject({ method: "POST", url: `/queue/${flagged!.id}/action`, headers, payload: { action: "ban", deleteRecent: 3 } });
    const deleted = vi.mocked(tg.deleteMessage).mock.calls.map((c) => c[1]).sort();
    expect(deleted).toEqual([12, 13, 14]);
  });

  it("ignore never touches telegram; unknown id 404; bad action 400", async () => {
    const { app, tg, service, headers } = setup();
    const added = service.queue.add(item());
    expect((await app.inject({ method: "POST", url: `/queue/${added.id}/action`, headers, payload: { action: "ignore" } })).statusCode).toBe(200);
    expect(tg.banChatMember).not.toHaveBeenCalled();
    expect((await app.inject({ method: "POST", url: "/queue/nope/action", headers, payload: { action: "ban" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/queue/x/action", headers, payload: { action: "zap" } })).statusCode).toBe(400);
  });

  it("voice intent 200/422, transcribe 501 without STT", async () => {
    const { app, headers } = setup();
    const ok = await app.inject({ method: "POST", url: "/voice/intent", headers, payload: { text: "ban and delete their last 10", itemId: "x" } });
    expect(ok.json()).toEqual({ action: "ban", deleteRecent: 10 });
    expect((await app.inject({ method: "POST", url: "/voice/intent", headers, payload: { text: "banana split?", itemId: "x" } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/voice/transcribe", headers, payload: { audio: "AAAA" } })).statusCode).toBe(501);
  });

  it("transcribe returns text with a transcriber", async () => {
    const service = new ModService(new ModQueue(), null, new NoopRefiner());
    const app = buildApp({ service, pairingCode: "pw", transcriber: { transcribe: async () => "ban them" }, production: false });
    const res = await app.inject({ method: "POST", url: "/voice/transcribe", headers: { "x-pairing-code": "pw" }, payload: { audio: "AAAA" } });
    expect(res.json()).toEqual({ text: "ban them" });
  });

  it("no seed endpoint in production", async () => {
    const service = new ModService(new ModQueue(), null, new NoopRefiner());
    const app = buildApp({ service, pairingCode: "pw", transcriber: null, production: true });
    expect((await app.inject({ method: "POST", url: "/dev/seed", headers: { "x-pairing-code": "pw" } })).statusCode).toBe(404);
  });
});

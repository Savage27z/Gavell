import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { NoopRefiner } from "../src/llm.js";
import { ModQueue } from "../src/queue.js";
import { ModService } from "../src/service.js";
import type { TelegramGateway } from "../src/telegram.js";

const base = { chatId: -1, chatTitle: "Chat", userId: 1, username: "a", text: "Claim airdrop now", messageId: 1, risk: "high" as const, score: 0.9, reason: "r" };
const gateway = (over: Partial<TelegramGateway> = {}) =>
  ({ banChatMember: vi.fn(), muteChatMember: vi.fn(), unbanChatMember: vi.fn(), unmuteChatMember: vi.fn(), deleteMessage: vi.fn(), ...over }) as unknown as TelegramGateway;
const headers = { "x-pairing-code": "c" };
const appFor = (service: ModService) => buildApp({ service, pairingCode: "c", transcriber: null, production: true });

describe("wave detection", () => {
  it("does not group unrelated users who only share a common host like t.me", () => {
    const q = new ModQueue();
    const a = q.add({ ...base, text: "Join my crypto channel t.me/alpha_calls for gains" });
    q.add({ ...base, userId: 2, text: "Free faucet drops daily, details at t.me/faucet_bot" });
    expect(q.wave(a.id)).toHaveLength(1);
  });

  it("a wave never suggests a ban just because one member is a repeat offender", () => {
    const q = new ModQueue();
    q.add({ ...base, text: "Verify at phantom-validate.xyz now", offenses: 3 });
    q.add({ ...base, userId: 2, text: "Go to phantom-validate.xyz to fix sync", offenses: 1 });
    const lead = q.next()!;
    expect(lead.waveSize).toBe(2);
    expect(lead.suggested.action).toBe("mute");
  });

  it("groups users who share a non-generic scam domain", () => {
    const q = new ModQueue();
    const a = q.add({ ...base, text: "Verify at phantom-validate.xyz now" });
    q.add({ ...base, userId: 2, text: "Support says go to phantom-validate.xyz to fix sync" });
    expect(q.wave(a.id)).toHaveLength(2);
  });

  it("groups different users with near-identical text, ignoring digits and punctuation", () => {
    const q = new ModQueue();
    const a = q.add({ ...base, text: "Claim your FREE airdrop at 100 wallets now!!" });
    q.add({ ...base, userId: 2, text: "claim your free airdrop at 250 wallets, now" });
    q.add({ ...base, userId: 3, text: "totally unrelated hello message here" });
    expect(q.next()!.waveSize).toBe(2);
    expect(q.wave(a.id)).toHaveLength(2);
  });

  it("groups by shared URL domain", () => {
    const q = new ModQueue();
    const a = q.add({ ...base, text: "visit scam-claims.top/a today" });
    q.add({ ...base, userId: 2, text: "different words entirely https://www.scam-claims.top/b" });
    expect(q.wave(a.id)).toHaveLength(2);
  });

  it("never mixes chats and does not persist waveSize", () => {
    const file = join(mkdtempSync(join(tmpdir(), "gavel-")), "q.json");
    const q = new ModQueue(file);
    const a = q.add(base);
    const other = q.add({ ...base, chatId: -2, userId: 2 });
    expect(a.waveSize).toBe(1);
    expect(other.waveSize).toBe(1);
    expect(q.wave(a.id)).toHaveLength(1);
    expect(new ModQueue(file).next()!.waveSize).toBe(1);
  });
});

describe("wave actions", () => {
  const seed = (service: ModService) => [1, 2, 3].map((userId) => service.queue.add({ ...base, userId, messageId: userId }));

  it("applies the action to every member and returns all undo tokens", async () => {
    const tg = gateway();
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const [a] = seed(service);
    const res = await appFor(service).inject({ method: "POST", url: `/queue/${a!.id}/action`, headers, payload: { action: "mute", wave: true } });
    const body = res.json();
    expect(body).toMatchObject({ ok: true, applied: 3, failed: 0 });
    expect(body.undoTokens).toHaveLength(3);
    expect(body.undoToken).toBe(body.undoTokens[0]);
    expect(tg.muteChatMember).toHaveBeenCalledTimes(3);
    expect(service.queue.stats()).toMatchObject({ pending: 0, handled: 3 });
    expect(service.queue.auditLog()[0]).toMatchObject({ waveSize: 3, action: "mute" });
  });

  it("releases only the failing member and reports partial results", async () => {
    const tg = gateway({ muteChatMember: vi.fn(async (_c: number, userId: number) => { if (userId === 2) throw new Error("boom"); }) });
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const [a] = seed(service);
    const res = await appFor(service).inject({ method: "POST", url: `/queue/${a!.id}/action`, headers, payload: { action: "mute", wave: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, applied: 2, failed: 1 });
    expect(service.queue.stats()).toMatchObject({ pending: 1, handled: 2 });
    expect(service.queue.next()!.userId).toBe(2);
  });

  it("undoes the whole wave with undoTokens", async () => {
    const tg = gateway();
    const service = new ModService(new ModQueue(), tg, new NoopRefiner());
    const [a] = seed(service);
    const app = appFor(service);
    const { undoTokens } = (await app.inject({ method: "POST", url: `/queue/${a!.id}/action`, headers, payload: { action: "mute", wave: true } })).json();
    const res = await app.inject({ method: "POST", url: "/queue/undo", headers, payload: { undoTokens } });
    expect(res.json()).toEqual({ ok: true });
    expect(tg.unmuteChatMember).toHaveBeenCalledTimes(3);
    expect(service.queue.stats()).toMatchObject({ pending: 3, handled: 0 });
    expect(service.queue.auditLog().every((e) => e.undone)).toBe(true);
  });

  it("without wave only the one item is acted on", async () => {
    const service = new ModService(new ModQueue(), null, new NoopRefiner());
    const [a] = seed(service);
    await service.act(a!.id, { action: "ban" });
    expect(service.queue.stats().pending).toBe(2);
  });
});

describe("audit and stats", () => {
  it("lists newest first, honours limit, counts actions and marks undone", async () => {
    const service = new ModService(new ModQueue(), null, new NoopRefiner());
    const items = [
      service.queue.add({ ...base, userId: 1, text: "alpha" }),
      service.queue.add({ ...base, userId: 2, text: "bravo" }),
      service.queue.add({ ...base, userId: 3, text: "charlie" }),
    ];
    await service.act(items[0]!.id, { action: "mute", muteMinutes: 60, deleteRecent: 1 });
    await service.act(items[1]!.id, { action: "ban" });
    const last = await service.act(items[2]!.id, { action: "ignore" });
    await service.undo(last!.undoToken);
    const app = appFor(service);
    const log = (await app.inject({ url: "/audit?limit=2", headers })).json();
    expect(log.map((e: { userId: number }) => e.userId)).toEqual([3, 2]);
    expect(log[0]).toMatchObject({ itemId: items[2]!.id, action: "ignore", undone: true, waveSize: 1 });
    const full = (await app.inject({ url: "/audit", headers })).json();
    expect(full[2]).toMatchObject({ action: "mute", muteMinutes: 60, deleteRecent: 1, chatId: -1, username: "a" });
    expect((await app.inject({ url: "/queue/stats", headers })).json()).toEqual({ pending: 1, handled: 2, muted: 1, banned: 1, ignored: 0, undone: 1, high: 1 });
  });

  it("persists the audit log with the queue file", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "gavel-")), "q.json");
    const service = new ModService(new ModQueue(file), null, new NoopRefiner());
    await service.act(service.queue.add(base).id, { action: "ban" });
    expect(new ModQueue(file).auditLog()).toHaveLength(1);
  });
});

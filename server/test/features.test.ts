import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { NoopRefiner } from "../src/llm.js";
import { ModQueue } from "../src/queue.js";
import { ModService } from "../src/service.js";
import type { TelegramGateway } from "../src/telegram.js";

const SCAM = "Admin here, send your 12-word seed phrase in DM. Urgent";
const tg = (): TelegramGateway => ({
  banChatMember: vi.fn(async () => {}),
  unbanChatMember: vi.fn(async () => {}),
  muteChatMember: vi.fn(async () => {}),
  unmuteChatMember: vi.fn(async () => {}),
  deleteMessage: vi.fn(async () => {}),
  sendMessage: vi.fn(async () => {}),
  memberStatus: vi.fn(async () => "administrator"),
});
const msg = (userId: number, text = SCAM, username = "u" + userId) => ({ chatId: -1, chatTitle: "G", userId, username, text, messageId: userId });

function setup(clock = { t: Date.now() }, gateway: TelegramGateway | null = tg()) {
  const queue = new ModQueue();
  const service = new ModService(queue, gateway, new NoopRefiner(), () => clock.t);
  return { queue, service, clock, gateway };
}

describe("new joiner flag", () => {
  it("marks a first post within 24 h of joining", async () => {
    const { service, clock } = setup();
    service.noteJoin(-1, 5);
    clock.t += 7 * 60_000;
    const item = await service.ingest(msg(5));
    expect(service.queue.get(item!.id)?.joinedMinAgo).toBe(7);
    const old = await service.ingest(msg(6));
    expect(service.queue.get(old!.id)?.joinedMinAgo).toBeUndefined();
  });
  it("stops flagging after 24 h", async () => {
    const { service, clock } = setup();
    service.noteJoin(-1, 5);
    clock.t += 25 * 3600_000;
    const item = await service.ingest(msg(5));
    expect(service.queue.get(item!.id)?.joinedMinAgo).toBeUndefined();
  });
});

describe("response-time ranking", () => {
  it("ranks moderators by median time from flagged to action", async () => {
    const { service, queue } = setup(undefined, null);
    const add = (secAgo: number, u: number) => queue.add({ chatId: -1, chatTitle: "G", userId: u, username: "u" + u, text: "t" + u, messageId: u, risk: "high", score: 1, reason: "r", flaggedAt: new Date(Date.now() - secAgo * 1000).toISOString() });
    await service.act(add(120, 1).id, { action: "ignore" }, "Slow");
    await service.act(add(10, 2).id, { action: "ignore" }, "Fast");
    const stats = queue.moderatorStats();
    expect(stats.map((s) => s.name)).toEqual(["Fast", "Slow"]);
    expect(stats[0]!.rank).toBe(1);
    expect(stats[1]!.medianResponseSec).toBeGreaterThanOrEqual(120);
  });
});

describe("since you were away", () => {
  it("summarises only after 10 minutes and only what others did", async () => {
    const { service, clock } = setup({ t: Date.now() - 35 * 60_000 }, null);
    expect(service.touch("Ann")).toBeUndefined();
    clock.t += 2 * 60_000;
    expect(service.touch("Ann")).toBeUndefined();
    const a = await service.ingest(msg(1));
    await service.ingest(msg(2, "Totally different: claim airdrop at https://free-arb.xyz now"));
    clock.t += 30 * 60_000;
    await service.act(a!.id, { action: "ignore" }, "Maya");
    const line = service.touch("Ann");
    expect(line).toMatch(/^Away 30m: \d+ new, 1 handled \(Maya 1\)/);
    expect(service.touch("Ann")).toBeUndefined();
  });
});

describe("raid replay", () => {
  it("records a raid and builds a timeline with who handled it", async () => {
    const { service, queue } = setup(undefined, null);
    await service.ingest(msg(1));
    const second = await service.ingest(msg(2));
    expect(queue.raidList()).toHaveLength(1);
    await service.actWave(second!.id, { action: "mute", muteMinutes: 60 }, "Maya");
    const t = queue.raidTimeline(queue.raidList()[0]!.id)!;
    expect(t.outcome).toEqual({ accounts: 2, handled: 2, open: 0 });
    expect(t.events.some((e) => e.event.includes("by Maya"))).toBe(true);
    expect(t.events[0]!.event).toContain("First post");
  });
  it("serves JSON and an HTML view behind the pairing code", async () => {
    const { service } = setup(undefined, null);
    await service.ingest(msg(1));
    await service.ingest(msg(2));
    const app = buildApp({ service, pairingCode: "demo", transcriber: null, production: true });
    expect((await app.inject({ url: "/raids" })).statusCode).toBe(401);
    const list = await app.inject({ url: "/raids", headers: { "x-pairing-code": "demo" } });
    const id = list.json()[0].id;
    expect((await app.inject({ url: "/raids/" + id, headers: { "x-pairing-code": "demo" } })).json().events.length).toBeGreaterThan(2);
    const view = await app.inject({ url: "/raids/view?code=demo" });
    expect(view.statusCode).toBe(200);
    expect(view.body).toContain("Raid replay");
  });
});

describe("night mode", () => {
  const setupNight = async () => {
    const env = setup();
    env.service.noteChat(-1, "G");
    await env.service.setNight(9, true);
    env.clock.t += 11 * 60_000;
    return env;
  };
  it("is off by default: nothing is muted", async () => {
    const { service, clock, gateway } = setup();
    clock.t += 11 * 60_000;
    for (const u of [1, 2, 3]) await service.ingest(msg(u));
    expect(gateway!.muteChatMember).not.toHaveBeenCalled();
    expect(service.queue.stats().pending).toBe(3);
  });
  it("mutes and deletes at 3 accounts, never bans, and leaves a card", async () => {
    const { service, queue, gateway } = await setupNight();
    await service.ingest(msg(1));
    await service.ingest(msg(2));
    expect(gateway!.muteChatMember).not.toHaveBeenCalled();
    await service.ingest(msg(3));
    expect(gateway!.muteChatMember).toHaveBeenCalledTimes(3);
    expect(gateway!.banChatMember).not.toHaveBeenCalled();
    expect(gateway!.deleteMessage).toHaveBeenCalledTimes(3);
    const card = queue.next()!;
    expect(card.source).toBe("night");
    expect(card.contained).toHaveLength(3);
    expect(service.nightUndo(card.id)).toHaveLength(3);
    await service.ingest(msg(4));
    expect(gateway!.muteChatMember).toHaveBeenCalledTimes(4);
    expect(queue.get(card.id)?.contained).toHaveLength(4);
  });
  it("mutes each account once even if it posted several times", async () => {
    const { service, queue, gateway } = await setupNight();
    await service.ingest(msg(1));
    await service.ingest(msg(1));
    await service.ingest(msg(2));
    await service.ingest(msg(3));
    expect(gateway!.muteChatMember).toHaveBeenCalledTimes(3);
    expect(queue.next()!.contained).toHaveLength(3);
  });
  it("does nothing while a moderator is active", async () => {
    const { service, clock, gateway } = await setupNight();
    service.touch("Ann");
    clock.t += 2 * 60_000;
    for (const u of [1, 2, 3]) await service.ingest(msg(u));
    expect(gateway!.muteChatMember).not.toHaveBeenCalled();
  });
  it("restore unmutes, re-posts the message and removes the card", async () => {
    const { service, queue, gateway } = await setupNight();
    for (const u of [1, 2, 3]) await service.ingest(msg(u));
    const card = queue.next()!;
    const tokens = service.nightUndo(card.id)!;
    expect(await service.undoMany(tokens)).toBe(true);
    expect(gateway!.unmuteChatMember).toHaveBeenCalledTimes(3);
    expect(gateway!.sendMessage).toHaveBeenCalledWith(-1, expect.stringContaining("[restored by mods] @u"));
    expect(queue.get(card.id)).toBeUndefined();
    expect(service.nightUndo(card.id)).toBeUndefined();
  });
  it("only chat admins can switch it on", async () => {
    const env = setup();
    env.service.noteChat(-1, "G");
    (env.gateway!.memberStatus as ReturnType<typeof vi.fn>).mockResolvedValue("member");
    expect(await env.service.setNight(9, true)).toEqual([]);
    expect(env.queue.isNight(-1)).toBe(false);
  });
});

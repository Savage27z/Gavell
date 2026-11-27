import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { NoopRefiner } from "../src/llm.js";
import { ModQueue } from "../src/queue.js";
import { ModService } from "../src/service.js";
import type { TelegramGateway } from "../src/telegram.js";

const base = { chatId: -1, chatTitle: "Chat", userId: 1, username: "a", text: "x", messageId: 1, risk: "high" as const, score: 0.9, reason: "r" };
const gateway = () => ({ banChatMember: vi.fn(), muteChatMember: vi.fn(), unbanChatMember: vi.fn(), unmuteChatMember: vi.fn(), deleteMessage: vi.fn() }) as unknown as TelegramGateway;
const setup = (now: () => number = () => 1_000) => {
  const service = new ModService(new ModQueue(), gateway(), new NoopRefiner(), now);
  const app = buildApp({ service, pairingCode: "boss", moderators: { maya1: "Maya", alex1: "Alex" }, transcriber: null, production: true });
  const as = (code: string) => ({ "x-pairing-code": code });
  return { service, app, as };
};

describe("two moderators on one queue", () => {
  it("accepts each moderator's own code and rejects unknown ones", async () => {
    const { app, as } = setup();
    expect((await app.inject({ url: "/queue/stats", headers: as("maya1") })).statusCode).toBe(200);
    expect((await app.inject({ url: "/queue/stats", headers: as("alex1") })).statusCode).toBe(200);
    expect((await app.inject({ url: "/queue/stats", headers: as("nope") })).statusCode).toBe(401);
  });

  it("gives the second moderator a different card while the first has one open", async () => {
    const { service, app, as } = setup();
    service.queue.add({ ...base, text: "first scam at one.example/a" });
    service.queue.add({ ...base, userId: 2, text: "second scam, different words entirely" });
    const maya = (await app.inject({ url: "/queue/next", headers: as("maya1") })).json();
    const alex = (await app.inject({ url: "/queue/next", headers: as("alex1") })).json();
    expect(alex.id).not.toBe(maya.id);
    expect(alex.viewedBy).toBeUndefined();
  });

  it("with one card left, the second moderator sees who is on it", async () => {
    const { service, app, as } = setup();
    service.queue.add({ ...base });
    const maya = (await app.inject({ url: "/queue/next", headers: as("maya1") })).json();
    const alex = (await app.inject({ url: "/queue/next", headers: as("alex1") })).json();
    expect(alex.id).toBe(maya.id);
    expect(alex.viewedBy).toBe("Maya");
  });

  it("the lock expires after 30 seconds", async () => {
    let t = 1_000;
    const { service, app, as } = setup(() => t);
    service.queue.add({ ...base });
    await app.inject({ url: "/queue/next", headers: as("maya1") });
    t += 31_000;
    expect((await app.inject({ url: "/queue/next", headers: as("alex1") })).json().viewedBy).toBeUndefined();
  });

  it("two presses at once: exactly one acts, the other is told who did", async () => {
    const { service, app, as } = setup();
    const item = service.queue.add({ ...base });
    const act = (code: string) => app.inject({ method: "POST", url: "/queue/" + item.id + "/action", headers: as(code), payload: { action: "mute", muteMinutes: 60 } });
    const [a, b] = await Promise.all([act("maya1"), act("alex1")]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(["Maya", "Alex"]).toContain(loser.json().by);
    expect(service.queue.stats().handled).toBe(1);
  });

  it("records who acted in the audit log and the shift stats", async () => {
    const { service, app, as } = setup();
    const item = service.queue.add({ ...base });
    await app.inject({ method: "POST", url: "/queue/" + item.id + "/action", headers: as("alex1"), payload: { action: "ignore" } });
    const audit = (await app.inject({ url: "/audit", headers: as("maya1") })).json();
    expect(audit[0].by).toBe("Alex");
    expect((await app.inject({ url: "/queue/stats", headers: as("maya1") })).json().byModerator).toEqual({ Alex: 1 });
  });

  it("an item that never existed is still a 404", async () => {
    const { app, as } = setup();
    expect((await app.inject({ method: "POST", url: "/queue/missing/action", headers: as("maya1"), payload: { action: "ignore" } })).statusCode).toBe(404);
  });
});

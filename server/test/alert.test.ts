import { describe, expect, it, vi } from "vitest";
import { CompositeAlerter, OnCallRegistry, RaidWatcher, TelegramDmAlerter, TwilioCaller, raidMessage } from "../src/alert.js";
import { NoopRefiner } from "../src/llm.js";
import { ModQueue } from "../src/queue.js";
import { ModService } from "../src/service.js";
import type { StoredItem } from "../src/types.js";

const item = (userId: number, over: Partial<StoredItem> = {}): StoredItem =>
  ({ id: "i" + userId, chatId: -1, chatTitle: "Solana Degens", userId, username: "u" + userId, text: "Claim your free ARB airdrop at arb-claims.top", messageId: userId, risk: "high", score: 0.9, reason: "r", offenses: 1, suggested: "mute", flaggedAt: new Date().toISOString(), ...over }) as StoredItem;
const wave = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));

describe("raid alert", () => {
  it("does not alert for a single account", () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    expect(new RaidWatcher({ notify }).observe(item(1), wave(1))).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("counts accounts, not messages from one account", () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const same = [item(1), item(1, { id: "x" }), item(1, { id: "y" })]; // one account, three messages
    expect(new RaidWatcher({ notify }).observe(same[0]!, same)).toBe(false);
  });

  it("alerts once per raid, then respects the cooldown, then alerts again", () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    let t = 0;
    const w = new RaidWatcher({ notify }, 3, 600_000, () => t);
    expect(w.observe(item(3), wave(3))).toBe(true);
    t = 5 * 60_000;
    expect(w.observe(item(4), wave(4))).toBe(false);
    t = 11 * 60_000;
    expect(w.observe(item(5), wave(5))).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("ignores seeded demo items and non-high items", () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const w = new RaidWatcher({ notify });
    expect(w.observe(item(3, { demo: true }), wave(3))).toBe(false);
    expect(w.observe(item(3, { risk: "medium" }), wave(3))).toBe(false);
  });

  it("never moderates: the alerter has no gateway at all", () => {
    expect(Object.keys(new RaidWatcher({ notify: vi.fn() })).sort()).toEqual(["alerter", "cooldownMs", "last", "now", "threshold"]);
  });

  it("DMs only opted-in moderators and survives one failing", async () => {
    const reg = new OnCallRegistry();
    reg.add(10);
    reg.add(11);
    const send = vi.fn().mockRejectedValueOnce(new Error("blocked")).mockResolvedValue(undefined);
    await new TelegramDmAlerter(send, reg).notify({ chatId: -1, chatTitle: "T", accounts: 4, sample: "x" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(reg.remove(10)).toBe(true);
    expect(reg.list()).toEqual([11]);
  });

  it("places one Twilio call per phone with escaped TwiML", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await new TwilioCaller("ACx", "tok", "+100", ["+1", "+2"], undefined, fetcher as unknown as typeof fetch).notify({ chatId: -1, chatTitle: "A&B <x>", accounts: 3, sample: "" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = String((fetcher.mock.calls[0]![1] as { body: string }).body);
    expect(new URLSearchParams(body).get("Twiml")).toContain("A&amp;B &lt;x&gt;");
    expect((fetcher.mock.calls[0]![1] as { headers: Record<string, string> }).headers.authorization).toMatch(/^Basic /);
  });

  it("with a public URL, Twilio is given the URL and no inline TwiML (trial accounts)", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const caller = new TwilioCaller("ACx", "tok", "+100", ["+1"], "https://x.example/", fetcher as unknown as typeof fetch);
    await caller.notify({ chatId: -1, chatTitle: "T", accounts: 3, sample: "" });
    const sent = new URLSearchParams(String((fetcher.mock.calls[0]![1] as { body: string }).body));
    expect(sent.get("Url")).toBe("https://x.example/twiml/raid");
    expect(sent.get("Twiml")).toBeNull();
    expect(caller.twiml()).toContain("raid in progress in T");
  });

  it("a composite keeps going when one channel fails", async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    await new CompositeAlerter([{ notify: vi.fn().mockRejectedValue(new Error("x")) }, { notify: ok }]).notify({ chatId: 1, chatTitle: "T", accounts: 3, sample: "" });
    expect(ok).toHaveBeenCalled();
    expect(raidMessage({ chatId: 1, chatTitle: "T", accounts: 3, sample: "", test: true })).toContain("TEST ALERT");
  });

  it("fires through ModService.ingest when 2 different accounts post the same scam", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const service = new ModService(new ModQueue(), null, new NoopRefiner(), Date.now, new RaidWatcher({ notify }));
    for (const u of [1, 2, 3]) {
      await service.ingest({ chatId: -5, chatTitle: "Raid chat", userId: u, username: "u" + u, text: "Claim your airdrop now! Wallet connect required, verify your 12-word seed phrase at arb-claims.top/claim. Last chance", messageId: u });
    }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatchObject({ chatTitle: "Raid chat", accounts: 2 });
    expect(service.queue.stats().pending).toBe(3);
  });
});

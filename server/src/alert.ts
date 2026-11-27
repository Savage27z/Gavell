import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StoredItem } from "./types.js";

export interface Raid {
  chatId: number;
  chatTitle: string;
  accounts: number;
  sample: string;
  test?: boolean;
}

export interface Alerter {
  notify(raid: Raid): Promise<void>;
}

/** Wakes people up. It never moderates anything. */
export class RaidWatcher {
  private last = new Map<number, number>();

  constructor(
    private alerter: Alerter,
    private threshold = 2,
    private cooldownMs = 10 * 60_000,
    private now: () => number = Date.now,
  ) {}

  observe(item: StoredItem, wave: StoredItem[]): boolean {
    if (item.demo || item.risk !== "high") return false;
    const accounts = new Set(wave.map((m) => m.userId)).size;
    if (accounts < this.threshold) return false;
    const t = this.now();
    const prev = this.last.get(item.chatId);
    if (prev !== undefined && t - prev < this.cooldownMs) return false;
    this.last.set(item.chatId, t);
    void this.alerter.notify({ chatId: item.chatId, chatTitle: item.chatTitle, accounts, sample: item.text.slice(0, 120) }).catch(() => {});
    return true;
  }
}

export class OnCallRegistry {
  private ids = new Set<number>();

  constructor(private file?: string) {
    if (file && existsSync(file)) this.ids = new Set(JSON.parse(readFileSync(file, "utf8")) as number[]);
  }

  add(id: number) {
    this.ids.add(id);
    this.save();
  }

  remove(id: number) {
    const had = this.ids.delete(id);
    this.save();
    return had;
  }

  list(): number[] {
    return [...this.ids];
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.list()));
  }
}

export function raidMessage(r: Raid): string {
  const lead = r.test ? "TEST ALERT (nothing is happening). " : "";
  return lead + "Gavel: raid in progress in " + r.chatTitle + ". " + r.accounts + " accounts posted the same scam. Open Gavel to review. Nothing has been actioned.";
}

export class TelegramDmAlerter implements Alerter {
  constructor(private send: (userId: number, text: string) => Promise<unknown>, private registry: OnCallRegistry) {}

  async notify(raid: Raid): Promise<void> {
    const text = raidMessage(raid) + (raid.sample ? '\n\nExample: "' + raid.sample + '"' : "");
    await Promise.allSettled(this.registry.list().map((id) => this.send(id, text)));
  }
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export class TwilioCaller implements Alerter {
  private last = "Gavel: a raid may be in progress. Open Gavel to review.";

  /** publicUrl: where Twilio can fetch the spoken message. Trial accounts cannot send inline TwiML. */
  constructor(
    private sid: string,
    private token: string,
    private from: string,
    private phones: string[],
    private publicUrl?: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  /** The TwiML served at /twiml/raid. It only ever reads the last raid text, never request input. */
  twiml(): string {
    return '<Response><Say voice="alice">' + xml(this.last) + "</Say></Response>";
  }

  async notify(raid: Raid): Promise<void> {
    this.last = raidMessage(raid);
    const twiml = this.twiml();
    await Promise.allSettled(
      this.phones.map(async (to) => {
        const res = await this.fetcher("https://api.twilio.com/2010-04-01/Accounts/" + this.sid + "/Calls.json", {
          method: "POST",
          headers: {
            authorization: "Basic " + Buffer.from(this.sid + ":" + this.token).toString("base64"),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(this.publicUrl ? { To: to, From: this.from, Url: this.publicUrl.replace(/\/$/, "") + "/twiml/raid" } : { To: to, From: this.from, Twiml: twiml }).toString(),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error("twilio " + res.status);
      }),
    );
  }
}

export class CompositeAlerter implements Alerter {
  constructor(private parts: Alerter[]) {}
  async notify(raid: Raid): Promise<void> {
    await Promise.allSettled(this.parts.map((p) => p.notify(raid)));
  }
}

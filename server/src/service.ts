import { randomUUID } from "node:crypto";
import type { RaidWatcher } from "./alert.js";
import { classify } from "./classifier.js";
import type { Refiner } from "./llm.js";
import type { ModQueue } from "./queue.js";
import type { TelegramGateway } from "./telegram.js";
import type { ActionRequest, FlaggedItem, IncomingMessage, StoredItem } from "./types.js";

const UNDO_WINDOW_MS = 60_000;
const FLAG_THRESHOLD = 0.35;
const RECENT_PER_USER = 50;
const REPORT_LIMIT = 5;
const REPORT_WINDOW_MS = 10 * 60_000;

export interface ReportInput {
  reporterId: number;
  text: string;
  /** The forwarded sender. userId is missing when the sender hides forwarding. */
  sender: { userId?: number; username?: string | null; name?: string };
}

export type ReportResult = { status: "queued"; targets: number; reports: number } | { status: "rejected"; reason: "not-member" | "rate-limit" | "empty" };

interface UndoEntry {
  item: StoredItem;
  action: ActionRequest["action"];
  expires: number;
  key: string;
  version: number;
}

export class ModService {
  private recent = new Map<string, number[]>();
  private undos = new Map<string, UndoEntry>();
  private locks = new Map<string, Promise<void>>();
  private versions = new Map<string, number>();
  private chats = new Map<number, string>();
  private reportLog = new Map<number, number[]>();
  private reporters = new Map<string, Set<number>>();
  private viewing = new Map<string, { by: string; until: number }>();
  private handled = new Map<string, string>();

  constructor(
    readonly queue: ModQueue,
    private tg: TelegramGateway | null,
    private refiner: Refiner,
    private now: () => number = Date.now,
    private watcher?: RaidWatcher,
  ) {}

  /** Soft lock: a card a moderator opened in the last 30 s is shown to others only when nothing else is left. */
  lockedByOthers(name: string): string[] {
    const now = this.now();
    return [...this.viewing.entries()].filter(([, v]) => v.by !== name && v.until > now).map(([id]) => id);
  }

  viewedBy(id: string, name: string): string | undefined {
    const v = this.viewing.get(id);
    return v && v.by !== name && v.until > this.now() ? v.by : undefined;
  }

  markViewing(id: string, name: string): void {
    if (!this.viewedBy(id, name)) this.viewing.set(id, { by: name, until: this.now() + 30_000 });
  }

  handledBy(id: string): string | undefined {
    return this.handled.get(id);
  }

  noteChat(chatId: number, title: string): void {
    this.chats.set(chatId, title);
  }

  /** A member forwarded a scam DM to the bot. Never acts; only queues for a moderator. */
  async report(input: ReportInput): Promise<ReportResult> {
    const text = input.text.trim();
    if (!text) return { status: "rejected", reason: "empty" };
    const now = this.now();
    const log = (this.reportLog.get(input.reporterId) ?? []).filter((t) => now - t < REPORT_WINDOW_MS);
    if (log.length >= REPORT_LIMIT) return { status: "rejected", reason: "rate-limit" };
    const known = [...this.chats.entries()];
    const reporterChats: [number, string][] = [];
    for (const [id, title] of known) {
      if (!this.tg || ["member", "administrator", "creator", "restricted"].includes(await this.tg.memberStatus(id, input.reporterId))) reporterChats.push([id, title]);
    }
    if (!reporterChats.length && (this.tg || known.length)) return { status: "rejected", reason: "not-member" };
    this.reportLog.set(input.reporterId, [...log, now]);
    const scammer = input.sender.userId;
    const targets: [number, string][] = [];
    if (scammer && scammer !== input.reporterId) {
      for (const [id, title] of reporterChats) {
        if (!this.tg || ["member", "restricted"].includes(await this.tg.memberStatus(id, scammer))) targets.push([id, title]);
      }
    }
    const verdict = classify(text);
    const score = Math.max(verdict.score, 0.35);
    const risk = verdict.risk === "low" ? "medium" : verdict.risk;
    const reason = ("Reported: " + verdict.reason).slice(0, 60);
    const label = input.sender.username ?? input.sender.name ?? null;
    const destinations: [number, string][] = targets.length ? targets : [reporterChats[0] ?? [0, "Direct message"]];
    let reports = 1;
    for (const [chatId, chatTitle] of destinations) {
      const hidden = !targets.length;
      const existing = hidden ? undefined : this.queue.findReport(chatId, scammer!);
      if (existing) {
        const set = this.reporters.get(existing.id) ?? new Set<number>();
        set.add(input.reporterId);
        this.reporters.set(existing.id, set);
        reports = set.size;
        this.queue.setReports(existing.id, reports);
        continue;
      }
      const item = this.queue.add({
        chatId,
        chatTitle,
        userId: hidden ? 0 : scammer!,
        username: hidden ? (input.sender.name ?? null) : label,
        text,
        messageId: 0,
        risk,
        score,
        reason,
        source: "report",
        reports: 1,
      });
      this.reporters.set(item.id, new Set([input.reporterId]));
    }
    return { status: "queued", targets: targets.length, reports };
  }

  async ingest(msg: IncomingMessage): Promise<FlaggedItem | null> {
    const key = `${msg.chatId}:${msg.userId}`;
    const ids = this.recent.get(key) ?? [];
    ids.push(msg.messageId);
    this.recent.set(key, ids.slice(-RECENT_PER_USER));

    let verdict = classify(msg.text, msg.accountAgeDays);
    if (verdict.score < this.refiner.minScore) return null;
    verdict = await this.refiner.refine(msg.text, verdict);
    if (verdict.score < FLAG_THRESHOLD) return null;
    const added = this.queue.add({
      chatId: msg.chatId,
      chatTitle: msg.chatTitle,
      userId: msg.userId,
      username: msg.username,
      text: msg.text,
      messageId: msg.messageId,
      risk: verdict.risk,
      score: verdict.score,
      reason: verdict.reason,
    });
    this.watcher?.observe(this.queue.get(added.id)!, this.queue.wave(added.id));
    return added;
  }

  private serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(task, task);
    const settled = run.then(() => undefined, () => undefined);
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return run;
  }

  async act(id: string, req: ActionRequest, by?: string): Promise<{ undoToken: string } | null> {
    const item = this.queue.claim(id);
    if (!item) return null;
    if (by) this.handled.set(id, by);
    return this.process(item, req, 1, by);
  }

  async actWave(id: string, req: ActionRequest, by?: string): Promise<{ undoTokens: string[]; failed: number } | null> {
    const members = this.queue.wave(id).flatMap((m) => this.queue.claim(m.id) ?? []);
    if (!members.length) return null;
    if (by) for (const m of members) this.handled.set(m.id, by);
    if (by) this.handled.set(id, by);
    const results = await Promise.allSettled(members.map((m) => this.process(m, req, members.length, by)));
    const undoTokens = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.undoToken] : []));
    return { undoTokens, failed: results.length - undoTokens.length };
  }

  private async process(item: StoredItem, req: ActionRequest, waveSize: number, by?: string): Promise<{ undoToken: string }> {
    const key = `${item.chatId}:${item.userId}`;
    try {
      return await this.serialize(key, async () => {
        if (req.action !== "ignore" && this.tg && !item.demo && item.userId !== 0) {
          const toDelete = new Set<number>(item.messageId > 0 ? [item.messageId] : []);
          const known = this.recent.get(key) ?? [];
          if (req.deleteRecent) known.slice(-req.deleteRecent).forEach((m) => toDelete.add(m));
          if (req.action === "ban") {
            await this.tg.banChatMember(item.chatId, item.userId);
          } else {
            const minutes = req.muteMinutes ?? 1440;
            await this.tg.muteChatMember(item.chatId, item.userId, Math.floor(this.now() / 1000) + minutes * 60);
          }
          if (req.action === "ban" || req.deleteRecent) {
            await Promise.allSettled([...toDelete].map((m) => this.tg!.deleteMessage(item.chatId, m)));
          }
        }
        this.queue.commit(item.id, { action: req.action, muteMinutes: req.muteMinutes, deleteRecent: req.deleteRecent, waveSize, by });
        const undoToken = randomUUID();
        const version = (this.versions.get(key) ?? 0) + 1;
        this.versions.set(key, version);
        this.undos.set(undoToken, { item, action: req.action, expires: this.now() + UNDO_WINDOW_MS, key, version });
        return { undoToken };
      });
    } catch (error) {
      this.queue.release(item.id);
      throw error;
    }
  }

  async undoMany(tokens: string[]): Promise<boolean> {
    const results = await Promise.allSettled(tokens.map((t) => this.undo(t)));
    const undone = results.some((r) => r.status === "fulfilled" && r.value);
    if (!undone && results.some((r) => r.status === "rejected")) throw new Error("undo failed");
    return undone;
  }

  async undo(token: string): Promise<boolean> {
    const entry = this.undos.get(token);
    if (!entry || entry.expires < this.now()) return false;
    return this.serialize(entry.key, async () => {
      if (this.versions.get(entry.key) !== entry.version) {
        this.undos.delete(token);
        return false;
      }
      if (this.tg && !entry.item.demo && entry.item.userId !== 0) {
        if (entry.action === "ban") await this.tg.unbanChatMember(entry.item.chatId, entry.item.userId);
        if (entry.action === "mute") await this.tg.unmuteChatMember(entry.item.chatId, entry.item.userId);
      }
      this.undos.delete(token);
      this.queue.restore(entry.item);
      return true;
    });
  }
}

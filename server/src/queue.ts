import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gentlest, suggest } from "./suggest.js";
import type { AuditEntry, FlaggedItem, Risk, StoredItem } from "./types.js";
import { waveOf } from "./wave.js";

const riskRank: Record<Risk, number> = { high: 2, medium: 1, low: 0 };

interface Persisted {
  pending: StoredItem[];
  handled: number;
  offenses?: Record<string, number>;
  audit?: AuditEntry[];
}

export class ModQueue {
  private pending: StoredItem[] = [];
  private handled = 0;
  private offenses = new Map<string, number>();
  private claimed = new Map<string, StoredItem>();
  private audit: AuditEntry[] = [];

  constructor(private file?: string) {
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as Persisted;
      this.pending = data.pending;
      this.handled = data.handled;
      this.offenses = new Map(Object.entries(data.offenses ?? {}));
      this.audit = data.audit ?? [];
    }
  }

  add(input: Omit<FlaggedItem, "id" | "flaggedAt" | "offenses" | "suggested" | "ownSuggested" | "waveSize"> & { flaggedAt?: string; offenses?: number }): FlaggedItem {
    const key = `${input.chatId}:${input.userId}`;
    const offenses = input.offenses ?? (this.offenses.get(key) ?? 0) + 1;
    if (input.offenses === undefined) this.offenses.set(key, offenses);
    const item: StoredItem = {
      ...input,
      offenses,
      suggested: suggest(input.risk, offenses),
      text: input.text.slice(0, 400),
      reason: input.reason.slice(0, 60),
      id: randomUUID(),
      flaggedAt: input.flaggedAt ?? new Date().toISOString(),
    };
    this.pending.push(item);
    this.save();
    return this.withWave(item);
  }

  next(skip: string[] = []): FlaggedItem | undefined {
    const unskipped = this.pending.filter((i) => !skip.includes(i.id));
    const candidates = unskipped.length ? unskipped : this.pending;
    const top = [...candidates].sort(
      (a, b) => riskRank[b.risk] - riskRank[a.risk] || Date.parse(a.flaggedAt) - Date.parse(b.flaggedAt),
    )[0];
    return top && this.withWave(top);
  }

  get(id: string): StoredItem | undefined {
    return this.pending.find((i) => i.id === id);
  }

  wave(id: string): StoredItem[] {
    const item = this.get(id);
    return item ? waveOf(item, this.pending) : [];
  }

  claim(id: string): StoredItem | undefined {
    const item = this.get(id);
    if (!item) return undefined;
    this.pending = this.pending.filter((i) => i.id !== id);
    this.claimed.set(id, item);
    return item;
  }

  release(id: string): void {
    const item = this.claimed.get(id);
    if (!item) return;
    this.claimed.delete(id);
    this.pending.push(item);
  }

  commit(id: string, entry: Omit<AuditEntry, "at" | "itemId" | "chatId" | "userId" | "username" | "undone">): void {
    const item = this.claimed.get(id);
    if (!item) return;
    this.claimed.delete(id);
    this.handled += 1;
    this.audit.push({
      at: new Date().toISOString(),
      itemId: id,
      chatId: item.chatId,
      userId: item.userId,
      username: item.username,
      ...entry,
      undone: false,
    });
    this.save();
  }

  restore(item: StoredItem): void {
    if (this.get(item.id)) return;
    this.pending.push(item);
    this.handled = Math.max(0, this.handled - 1);
    const entry = this.audit.findLast((e) => e.itemId === item.id && !e.undone);
    if (entry) entry.undone = true;
    this.save();
  }

  stats() {
    return { pending: this.pending.length, handled: this.handled };
  }

  pendingHigh(): number {
    return this.pending.filter((i) => i.risk === "high").length;
  }

  shiftStats() {
    const live = this.audit.filter((e) => !e.undone);
    const count = (action: AuditEntry["action"]) => live.filter((e) => e.action === action).length;
    return { muted: count("mute"), banned: count("ban"), ignored: count("ignore"), undone: this.audit.length - live.length };
  }

  auditLog(limit = 50): AuditEntry[] {
    return this.audit.slice(-limit).reverse();
  }

  private withWave(item: StoredItem): FlaggedItem {
    const members = waveOf(item, this.pending);
    const suggested = members.length > 1 ? members.map((m) => m.suggested).reduce(gentlest) : item.suggested;
    return { ...item, suggested, ownSuggested: item.suggested, waveSize: members.length };
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ pending: [...this.pending, ...this.claimed.values()], handled: this.handled, offenses: Object.fromEntries(this.offenses), audit: this.audit } satisfies Persisted));
  }
}

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gentlest, suggest } from "./suggest.js";
import type { AuditEntry, FlaggedItem, RaidRecord, Risk, StoredItem } from "./types.js";
import { waveOf } from "./wave.js";

const riskRank: Record<Risk, number> = { high: 2, medium: 1, low: 0 };

interface Persisted {
  pending: StoredItem[];
  handled: number;
  offenses?: Record<string, number>;
  audit?: AuditEntry[];
  raids?: RaidRecord[];
  night?: number[];
  joins?: Record<string, number>;
}

export class ModQueue {
  private pending: StoredItem[] = [];
  private handled = 0;
  private offenses = new Map<string, number>();
  private claimed = new Map<string, StoredItem>();
  private audit: AuditEntry[] = [];
  private raids: RaidRecord[] = [];
  private night = new Set<number>();
  private joins = new Map<string, number>();

  constructor(private file?: string) {
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as Persisted;
      this.pending = data.pending;
      this.handled = data.handled;
      this.offenses = new Map(Object.entries(data.offenses ?? {}));
      this.audit = data.audit ?? [];
      this.raids = data.raids ?? [];
      this.night = new Set(data.night ?? []);
      this.joins = new Map(Object.entries(data.joins ?? {}));
    }
  }

  add(input: Omit<FlaggedItem, "id" | "flaggedAt" | "offenses" | "suggested" | "ownSuggested" | "waveSize"> & { flaggedAt?: string; offenses?: number }): FlaggedItem {
    const key = `${input.chatId}:${input.userId}`;
    const offenses = input.offenses ?? (this.offenses.get(key) ?? 0) + 1;
    if (input.offenses === undefined) this.offenses.set(key, offenses);
    const item: StoredItem = {
      ...input,
      offenses,
      suggested: input.userId === 0 ? { action: "ignore" } : suggest(input.risk, offenses),
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

  findReport(chatId: number, userId: number): StoredItem | undefined {
    return this.pending.find((i) => i.source === "report" && i.chatId === chatId && i.userId === userId && userId !== 0);
  }

  setReports(id: string, reports: number): void {
    const item = this.get(id);
    if (!item) return;
    item.reports = reports;
    this.save();
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

  commit(id: string, entry: Omit<AuditEntry, "at" | "itemId" | "chatId" | "userId" | "username" | "undone" | "flaggedAt" | "responseMs">): void {
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
      flaggedAt: item.flaggedAt,
      responseMs: Math.max(0, Date.now() - Date.parse(item.flaggedAt)),
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

  update(id: string, patch: Partial<StoredItem>): void {
    const item = this.get(id);
    if (!item) return;
    Object.assign(item, patch);
    this.save();
  }

  drop(id: string): void {
    this.pending = this.pending.filter((i) => i.id !== id);
    this.save();
  }

  setJoin(key: string, at: number): void {
    this.joins.set(key, at);
    for (const [k, t] of this.joins) if (at - t > 7 * 86_400_000) this.joins.delete(k);
    this.save();
  }

  joinedAt(key: string): number | undefined {
    return this.joins.get(key);
  }

  isNight(chatId: number): boolean {
    return this.night.has(chatId);
  }

  setNight(chatId: number, on: boolean): void {
    if (on) this.night.add(chatId);
    else this.night.delete(chatId);
    this.save();
  }

  /** Records or extends a raid: one record per chat and set of overlapping accounts. */
  noteRaid(item: StoredItem, wave: StoredItem[]): RaidRecord {
    let raid = this.raids.find((r) => r.chatId === item.chatId && wave.some((w) => r.members.some((m) => m.userId === w.userId)));
    if (!raid) {
      raid = { id: randomUUID(), chatId: item.chatId, chatTitle: item.chatTitle, sample: item.text.slice(0, 120), startedAt: item.flaggedAt, members: [] };
      this.raids.push(raid);
    }
    for (const w of wave) if (!raid.members.some((m) => m.userId === w.userId)) raid.members.push({ userId: w.userId, username: w.username, at: w.flaggedAt });
    raid.members.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    raid.startedAt = raid.members[0]!.at;
    this.save();
    return raid;
  }

  raidList(): RaidRecord[] {
    return [...this.raids].reverse();
  }

  raidTimeline(id: string) {
    const raid = this.raids.find((r) => r.id === id);
    if (!raid) return undefined;
    const ids = new Set(raid.members.map((m) => m.userId));
    const name = (u: string | null, id2: number) => (u ? "@" + u : "user " + id2);
    const events: { at: string; event: string; responseSec?: number }[] = raid.members.map((m, i) => ({ at: m.at, event: (i === 0 ? "First post: " : "Posted: ") + name(m.username, m.userId) }));
    if (raid.members.length >= 2) events.push({ at: raid.members[1]!.at, event: "Gavel grouped " + raid.members.length + " accounts as one wave" });
    for (const e of this.audit) {
      if (e.chatId !== raid.chatId || !ids.has(e.userId) || e.undone) continue;
      if (Date.parse(e.at) < Date.parse(raid.startedAt)) continue;
      events.push({ at: e.at, event: e.action + " " + name(e.username, e.userId) + (e.by ? " by " + e.by : ""), ...(e.responseMs !== undefined ? { responseSec: Math.round(e.responseMs / 1000) } : {}) });
    }
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const live = this.audit.filter((e) => e.chatId === raid.chatId && ids.has(e.userId) && !e.undone && Date.parse(e.at) >= Date.parse(raid.startedAt));
    const handled = new Set(live.map((e) => e.userId)).size;
    return { ...raid, events, outcome: { accounts: raid.members.length, handled, open: raid.members.length - handled } };
  }

  moderatorStats() {
    const by = new Map<string, number[]>();
    for (const e of this.audit) if (!e.undone && e.by && e.responseMs !== undefined) by.set(e.by, [...(by.get(e.by) ?? []), e.responseMs]);
    const rows = [...by.entries()].map(([name, ms]) => {
      const sorted = [...ms].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      return { name, handled: ms.length, medianResponseSec: Math.round(median / 1000), fastestSec: Math.round(sorted[0]! / 1000) };
    });
    return rows.sort((a, b) => a.medianResponseSec - b.medianResponseSec).map((r, i) => ({ rank: i + 1, ...r }));
  }

  since(sinceIso: string, me: string) {
    const t = Date.parse(sinceIso);
    const fresh = this.audit.filter((e) => e.flaggedAt && Date.parse(e.flaggedAt) > t).length + this.pending.filter((i) => Date.parse(i.flaggedAt) > t).length;
    const handledBy: Record<string, number> = {};
    let handled = 0;
    for (const e of this.audit) {
      if (e.undone || Date.parse(e.at) <= t || !e.by || e.by === me) continue;
      handled += 1;
      handledBy[e.by] = (handledBy[e.by] ?? 0) + 1;
    }
    const raids = this.raids.filter((r) => Date.parse(r.startedAt) > t).length;
    return { fresh, handled, handledBy, raids, pending: this.pending.length };
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
    const byModerator: Record<string, number> = {};
    for (const e of live) if (e.by) byModerator[e.by] = (byModerator[e.by] ?? 0) + 1;
    return { muted: count("mute"), banned: count("ban"), ignored: count("ignore"), undone: this.audit.length - live.length, ...(Object.keys(byModerator).length ? { byModerator } : {}) };
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
    writeFileSync(this.file, JSON.stringify({ pending: [...this.pending, ...this.claimed.values()], handled: this.handled, offenses: Object.fromEntries(this.offenses), audit: this.audit, raids: this.raids, night: [...this.night], joins: Object.fromEntries(this.joins) } satisfies Persisted));
  }
}

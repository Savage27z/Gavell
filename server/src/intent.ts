import type { ActionRequest } from "./types.js";

const words: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, fifty: 50,
};

function parseNumber(token: string): number | undefined {
  if (/^\d+$/.test(token)) return Number(token);
  return words[token];
}

function parseDurationMinutes(text: string): number | undefined {
  if (/\b(a|one)\s+(day|24\s*hours?)\b|\bday\b|\ba\s+day\b/.test(text)) return 1440;
  if (/\b(a|one)\s+week\b|\bweek\b/.test(text)) return 10080;
  const m = text.match(/(\w+)\s*(minute|min|hour|hr|day|week)s?\b/);
  if (!m) return undefined;
  const n = parseNumber(m[1]!);
  if (n === undefined) return undefined;
  const unit = m[2]!;
  const mult = unit.startsWith("min") ? 1 : unit.startsWith("h") ? 60 : unit === "day" ? 1440 : 10080;
  return n * mult;
}

export function parseIntent(raw: string): ActionRequest | null {
  const text = raw.toLowerCase().replace(/[.,!?]/g, " ");
  const isBan = /\b(ban|kick|remove|block|nuke|boot)\b/.test(text);
  const isMute = /\b(mute|silence|timeout|time out|restrict)\b/.test(text);
  const isIgnore = /\b(ignore|dismiss|leave|keep|safe|fine|allow)\b|\bnot\s+(a\s+)?(spam|scam)\b/.test(text);
  if (!isBan && !isMute && !isIgnore) return null;
  if (/\bnot\s+(a\s+)?(spam|scam)\b/.test(text)) return { action: "ignore" };
  if ((isBan || isMute) && /\b(don'?t|do\s+not|never|not|no)\b/.test(text)) return null;
  if (isIgnore && !isBan && !isMute && /\b(delete|purge|wipe|clear)\b/.test(text)) return null;

  const del = text.match(/(?:delete|remove|purge|wipe|clear)\s+(?:their\s+|all\s+their\s+|the\s+)?(?:last\s+|latest\s+|recent\s+)?(\w+)\s+(?:messages?|posts?|msgs?)?/);
  const lastN = text.match(/last\s+(\w+)/);
  let deleteRecent: number | undefined;
  if (/\b(delete|purge|wipe|clear)\b/.test(text)) {
    deleteRecent = parseNumber(lastN?.[1] ?? del?.[1] ?? "") ?? (/\ball\b|everything/.test(text) ? 50 : undefined);
  }

  if (isBan) return deleteRecent ? { action: "ban", deleteRecent } : { action: "ban" };
  if (isMute) {
    const muteMinutes = parseDurationMinutes(text) ?? 1440;
    return deleteRecent ? { action: "mute", muteMinutes, deleteRecent } : { action: "mute", muteMinutes };
  }
  return { action: "ignore" };
}

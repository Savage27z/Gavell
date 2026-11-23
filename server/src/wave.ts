import type { StoredItem } from "./types.js";

const DOMAIN = /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi;
const SIMILARITY = 0.8;
const SHARED_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.org', 'bit.ly', 'tinyurl.com', 'cutt.ly', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'google.com', 'github.com', 'medium.com', 'opensea.io', 'discord.gg', 'discord.com', 'reddit.com', 'wikipedia.org']);

function domains(text: string): Set<string> {
  return new Set([...text.matchAll(DOMAIN)].map((m) => m[1]!.toLowerCase()).filter((d) => !SHARED_HOSTS.has(d)));
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[\p{N}\p{P}\p{S}]/gu, " ").split(/\s+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / (a.size + b.size - shared);
}

export function sameWave(a: StoredItem, b: StoredItem): boolean {
  if (a.id === b.id) return true;
  if (a.chatId !== b.chatId) return false;
  const da = domains(a.text);
  if ([...domains(b.text)].some((d) => da.has(d))) return true;
  return jaccard(words(a.text), words(b.text)) >= SIMILARITY;
}

export function waveOf(item: StoredItem, pending: StoredItem[]): StoredItem[] {
  return pending.filter((other) => sameWave(item, other));
}

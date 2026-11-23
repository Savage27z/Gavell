import type { Risk, Verdict } from "./types.js";

interface Rule {
  pattern: RegExp;
  weight: number;
  reason: string;
}

const rules: Rule[] = [
  { pattern: /seed\s*phrase|recovery\s*phrase|private\s*key|12[- ]word|24[- ]word/i, weight: 0.5, reason: "Asks for seed phrase" },
  { pattern: /wallet\s*(connect|validation|sync|verify|issue|error)|validate\s*(your\s*)?wallet|claim\s*(your\s*)?(airdrop|reward|tokens?)/i, weight: 0.4, reason: "Wallet/airdrop lure" },
  { pattern: /\b(support|helpdesk|admin|mods?|moderators?|team)\b.*\b(dm|message\s+(me|us)|contact|pm)\b|\b(dm|message\s+(me|us)|contact|pm)\b.*\b(support|helpdesk|admin|mods?)\b/i, weight: 0.35, reason: "Fake support" },
  { pattern: /\b(dm|pm)\s*me\b|\bmessage\s*me\b|\bwhatsapp\b|\btext\s*me\b/i, weight: 0.25, reason: "Asks to DM" },
  { pattern: /(guaranteed|risk[- ]free|100x|\d{2,}\s*%\s*(daily|weekly|profit|returns?)|double\s*your|send\s*\d+(\.\d+)?\s*(btc|eth|usdt|sol)\s*(and|get|receive))/i, weight: 0.4, reason: "Too-good-to-be-true profit" },
  { pattern: /(giveaway|giving\s*away|airdrop|stealth\s*drop|free\s*(btc|eth|usdt|nft|mint))/i, weight: 0.25, reason: "Giveaway bait" },
  { pattern: /send\s+[\d.]+\s*(btc|eth|usdt|sol)\b.*\b(receive|get|back)\b/i, weight: 0.4, reason: "Send-to-receive scam" },
  { pattern: /(verify|confirm|re-?verify)\s+(your\s+)?(identity|account|wallet)|account\s+will\s+be\s+(banned|suspended|closed)|everyone\s+re-?verify/i, weight: 0.4, reason: "Fake verification" },
  { pattern: /eligib|rewards?\b.*\bwallet|wallet\b.*\brewards?/i, weight: 0.3, reason: "Eligibility lure" },
  { pattern: /wallet\s+address|send\s+me\s+your/i, weight: 0.25, reason: "Asks for wallet info" },
  { pattern: /earn\s*\$?\d+.*\b(daily|a\s+day|weekly|per\s+day)\b/i, weight: 0.4, reason: "Easy-money pitch" },
  { pattern: /(new\s+token|token\s+launch|launching|presale|pre-sale|buy\s+early)/i, weight: 0.3, reason: "Token pump pitch" },
  { pattern: /https?:\/\/\S*(claim|verify|airdrop|mint|connect|approve|eligib|reward|login|secure|double)\S*/i, weight: 0.35, reason: "Phishing-style link" },
  { pattern: /t\.me\/\w+/i, weight: 0.15, reason: "Telegram invite" },
  { pattern: /\b(urgent|immediately|last\s*chance|expires?|limited\s*time|act\s*now)\b/i, weight: 0.15, reason: "Urgency pressure" },
  { pattern: /(bit\.ly|tinyurl|t\.me\/\+|cutt\.ly|\.xyz|\.top|\.click|\.live)\b/i, weight: 0.3, reason: "Suspicious link" },
  { pattern: /https?:\/\/\S+/i, weight: 0.1, reason: "Contains link" },
  { pattern: /(trading\s*signals?|pump\s*group|insider|forex\s*expert|recovery\s*(expert|service)|lost\s*funds)/i, weight: 0.3, reason: "Investment/recovery pitch" },
];

export function riskFromScore(score: number): Risk {
  if (score >= 0.65) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

export function classify(text: string, accountAgeDays?: number): Verdict {
  const hits = rules.filter((r) => r.pattern.test(text));
  let score = 1 - hits.reduce((p, r) => p * (1 - r.weight), 1);
  const reasons = hits.sort((a, b) => b.weight - a.weight).map((r) => r.reason);
  if (hits.length > 0 && /\b(never|don'?t|do\s+not|beware|scam\s+alert|warning|reminder)\b/i.test(text) && !/https?:\/\//i.test(text)) {
    score *= 0.4;
    reasons.push("Looks like a warning");
  }
  if (accountAgeDays !== undefined && accountAgeDays < 7 && hits.length > 0) {
    score = Math.min(1, score + 0.15);
    reasons.push("New account");
  }
  score = Math.round(score * 100) / 100;
  const reason = (reasons.slice(0, 2).join(" + ") || "Looks fine").slice(0, 60);
  return { score, risk: riskFromScore(score), reason };
}

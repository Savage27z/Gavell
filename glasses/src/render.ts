import { describeAction, shortAction, type State } from "./machine";
import type { FlaggedItem, Risk } from "./types";

export interface Screen {
  header: string;
  body: string;
  footer: string;
}

const BADGE: Record<Risk, string> = { high: "[!!!] HIGH", medium: "[!!] MED", low: "[!] LOW" };
const BODY_CHARS = 120;

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + "\u2026";
}

function cardBody(item: FlaggedItem): string {
  const name = item.username ? `@${item.username}` : `user ${item.userId}`;
  const repeat = item.offenses > 1 ? ` | #${item.offenses} offense` : "";
  const lines = [`${name} in ${truncate(item.chatTitle, 20)}${repeat}`, `"${truncate(item.text, BODY_CHARS)}"`, `> ${truncate(item.reason, 60)}`];
  if (item.waveSize > 1 && shortAction(item.ownSuggested) !== shortAction(item.suggested)) {
    lines.push(`Wave acts gently. This one alone: ${shortAction(item.ownSuggested)}`);
  }
  return lines.join("\n");
}

function cardHeader(state: State, item: FlaggedItem): string {
  const parts = [BADGE[item.risk]];
  if (state.alert) return `${parts[0]}   NEW HIGH - Dn to view`;
  if (item.waveSize > 1) parts.push(`WAVE x${item.waveSize}`);
  parts.push(`${state.pending} pending`);
  return parts.join("   ");
}

function cardFooter(item: FlaggedItem): string {
  if (item.waveSize > 1) return `Press ${shortAction(item.suggested)} x${item.waveSize} | 2x ignore x${item.waveSize} | Dn skip | Up undo`;
  return `Press ${shortAction(item.suggested)} | 2x ignore | Dn skip | Up undo | Hold voice`;
}

export function renderScreen(state: State): Screen {
  switch (state.phase) {
    case "pairing":
      return {
        header: "GAVEL",
        body: "Open this app on your phone\nand enter the pairing code.",
        footer: "Waiting for pairing...",
      };
    case "loading":
      return { header: "GAVEL", body: "Loading...", footer: "" };
    case "card":
    case "busy":
      if (!state.item) return { header: "GAVEL", body: state.message, footer: "" };
      return {
        header: cardHeader(state, state.item),
        body: state.phase === "busy" ? state.message : cardBody(state.item),
        footer: cardFooter(state.item),
      };
    case "confirm":
      return {
        header: "CONFIRM?",
        body: [describeAction(state.request ?? { action: "ignore" }), state.item ? `@${state.item.username ?? state.item.userId}: "${truncate(state.item.text, 60)}"` : ""].join("\n"),
        footer: "Press yes | Dn cancel",
      };
    case "toast":
      return {
        header: "DONE",
        body: state.message,
        footer: state.undoTokens.length ? "Swipe up to undo" : "",
      };
    case "empty":
      return {
        header: "GAVEL",
        body: state.shift?.handled ? `Queue clear\nShift: ${state.shift.handled} handled ${state.shift.muted} mute ${state.shift.banned} ban ${state.shift.ignored} ignore` : "Queue clear",
        footer: state.undoTokens.length ? "Up undo | Dn refresh" : "Dn refresh",
      };
    case "error":
      return { header: "OFFLINE", body: state.error ?? "Something went wrong", footer: "Press to retry" };
    case "listening":
      return { header: "LISTENING", body: 'Say: "ban and delete their last 10"\nor "mute for a day"', footer: "Release to send" };
    case "transcribing":
      return { header: "VOICE", body: state.message, footer: "" };
  }
}

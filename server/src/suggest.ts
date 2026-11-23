import type { ActionRequest, Risk } from "./types.js";

const severity = (r: ActionRequest): number => (r.action === "ban" ? 3 : r.action === "mute" ? 2 : 1);

export function gentlest(a: ActionRequest, b: ActionRequest): ActionRequest {
  if (severity(a) !== severity(b)) return severity(a) < severity(b) ? a : b;
  if (a.action === "mute") return (a.muteMinutes ?? 0) <= (b.muteMinutes ?? 0) ? a : b;
  return (a.deleteRecent ?? 0) <= (b.deleteRecent ?? 0) ? a : b;
}

export function suggest(risk: Risk, offenses: number): ActionRequest {
  if (offenses >= 3 || (risk === "high" && offenses >= 2)) return { action: "ban", deleteRecent: 10 };
  if (risk === "high") return { action: "mute", muteMinutes: 1440, deleteRecent: 1 };
  if (risk === "medium") return { action: "mute", muteMinutes: 60, deleteRecent: 1 };
  return { action: "ignore" };
}

export type Risk = "low" | "medium" | "high";
export type Action = "ban" | "mute" | "ignore";

export interface FlaggedItem {
  id: string;
  chatId: number;
  chatTitle: string;
  userId: number;
  username: string | null;
  text: string;
  messageId: number;
  risk: Risk;
  score: number;
  reason: string;
  flaggedAt: string;
  offenses: number;
  waveSize: number;
  suggested: ActionRequest;
  ownSuggested: ActionRequest;
  demo?: boolean;
  /** Set when a member forwarded a scam DM to the bot. */
  source?: "report" | "night";
  reports?: number;
  /** Minutes since the sender joined, when they joined in the last 24 h. */
  joinedMinAgo?: number;
  /** Night-mode card: the accounts that were contained. */
  contained?: string[];
}

export interface RaidRecord {
  id: string;
  chatId: number;
  chatTitle: string;
  sample: string;
  startedAt: string;
  members: { userId: number; username: string | null; at: string }[];
}

export type StoredItem = Omit<FlaggedItem, "waveSize" | "ownSuggested">;

export interface AuditEntry {
  at: string;
  itemId: string;
  chatId: number;
  userId: number;
  username: string | null;
  action: Action;
  muteMinutes?: number;
  deleteRecent?: number;
  waveSize: number;
  undone: boolean;
  by?: string;
  flaggedAt?: string;
  responseMs?: number;
}

export interface Verdict {
  score: number;
  risk: Risk;
  reason: string;
}

export interface IncomingMessage {
  chatId: number;
  chatTitle: string;
  userId: number;
  username: string | null;
  text: string;
  messageId: number;
  accountAgeDays?: number;
}

export interface ActionRequest {
  action: Action;
  deleteRecent?: number;
  muteMinutes?: number;
  /** Voice scope: apply to the whole wave on the card. */
  wave?: boolean;
}

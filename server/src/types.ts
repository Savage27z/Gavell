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
}

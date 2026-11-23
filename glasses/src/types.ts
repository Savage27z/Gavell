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
  suggested: ActionRequest;
  ownSuggested: ActionRequest;
  waveSize: number;
}

export interface ActionRequest {
  action: Action;
  deleteRecent?: number;
  muteMinutes?: number;
}

export interface ActionResult {
  undoToken: string;
  undoTokens?: string[];
  applied?: number;
  failed?: number;
}

export interface ShiftStats {
  high?: number;
  handled: number;
  muted: number;
  banned: number;
  ignored: number;
}

export interface QueueStats extends ShiftStats {
  pending: number;
  undone: number;
  high?: number;
}

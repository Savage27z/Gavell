# Gavel API contract (source of truth)

Backend (Node 24 + TypeScript, Fastify) on http://localhost:8787. All JSON. Auth: header `x-pairing-code` must equal env PAIRING_CODE (glasses app has no login UI; user types the code once, stored in localStorage).

## Types
FlaggedItem = {
  id: string,
  chatId: number, chatTitle: string,
  userId: number, username: string | null,
  text: string,            // original message, truncated to 400 chars
  messageId: number,
  risk: "low" | "medium" | "high",
  score: number,           // 0..1
  reason: string,          // <= 60 chars, e.g. "Fake support + wallet link"
  flaggedAt: string,       // ISO
  offenses: number,        // times this user has been flagged in this chat, including this one
  waveSize: number,        // >= 1; pending items in the same chat sharing a URL domain or near-identical text (Jaccard >= 0.8 after lowercasing, stripping digits/punctuation). Computed at read time, not persisted
  suggested: { action: Action, deleteRecent?: number, muteMinutes?: number }  // server's recommended action, executed by press
  ownSuggested: { action: Action, deleteRecent?: number, muteMinutes?: number },  // this item's own suggestion; differs from suggested when it is in a wave (wave takes the gentlest)
}
Action = "ban" | "mute" | "ignore"

## Endpoints
GET  /health                          -> { ok: true }
GET  /queue/next?skip=id1,id2         -> FlaggedItem | 204 (empty). Does not remove the item; highest risk first, oldest first within a risk. Skipped ids are avoided; when all pending items are skipped the list wraps.
POST /voice/transcribe  { audio: base64 pcm16 16kHz } -> { text } | 501 when STT is not configured
GET  /queue/stats                     -> { pending, handled, muted, banned, ignored, undone }  (muted/banned/ignored exclude undone actions)
GET  /audit?limit=50                  -> AuditEntry[] newest first. AuditEntry = { at, itemId, chatId, userId, username, action, muteMinutes?, deleteRecent?, waveSize, undone }
POST /queue/:id/action  { action: Action, deleteRecent?: number, muteMinutes?: number, wave?: boolean }
                                      -> { ok: true, undoToken: string }  (ban deletes the message; mute default 1440 min; deleteRecent deletes that user's last N messages in the chat when known)
                                      With wave: true the action applies to every item in the target's wave (same chat only), each claimed atomically up front; a failing member is released alone.
                                      -> { ok, applied, failed, undoToken (first), undoTokens: string[] }; ok is false on partial failure (still 200), 502 when none applied
POST /queue/undo        { undoToken } | { undoTokens: string[] }  -> { ok: true }  (unban/unrestrict; valid 60 s)
POST /voice/intent      { text: string, itemId: string } -> { action: Action, deleteRecent?: number, muteMinutes?: number } | 422
                                      (parses short phrases like "ban and delete their last 10", "mute for a day")
POST /dev/seed                         -> { added: number }  (only when NODE_ENV!=production; injects sample scams without Telegram)

## Rules
- NEVER auto-moderate. Only act on POST /queue/:id/action.
- Bot token, LLM key only in env (see .env.example). Never log them.
- Classifier: cheap rules first (links, new account, "DM me", "support", seed phrase / wallet words), optional LLM refinement if LLM_API_KEY set; must work offline with rules only.

## Glasses gestures (Even Hub)
press = run FlaggedItem.suggested (shown in the footer, with "xN" when waveSize > 1, applied to the whole wave); only 3+ offenses, or high risk with 2+, suggest a ban, double press = ignore, swipe down = next/skip, swipe up = undo last action (the whole wave after a wave press), long press = open voice command (mic -> STT -> /voice/intent), then a confirm screen: press = yes, swipe down = cancel.

While a card is shown, the poll of /queue/next sets a "NEW HIGH" header alert when the top item is high risk, differs from the card, and the card is not high. The card is never swapped; swipe down shows it. The empty screen shows the shift summary from /queue/stats.

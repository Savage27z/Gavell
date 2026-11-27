# DoraHacks submission draft

## Demo video
https://youtu.be/p-A0uJ_V0dM (silent screen recording with voice-over; simulator only; the wave is seeded demo data)

## Title
Gavel: moderate Telegram scam waves from your glasses

## Problem
Crypto Telegram groups get hit by scam waves: fake support, wallet drainer links, impersonated admins and fake giveaways. The same scam often arrives from several accounts at once. Moderators lose members to one successful scam within minutes, yet moderating means unlocking a phone and hunting through a fast chat.

## Who it is for
Moderators of crypto and Web3 communities who need to react in seconds while away from their desk.

## How it works
A Telegram bot in your group reads messages. A rules classifier flags likely scams, and an optional LLM reviews every message to catch scams with no obvious keywords. The Even G2 app shows one flagged item at a time: risk, reason, sender and text.

- **Press** runs the suggested action shown in the footer (ignore, mute 1 h, mute 24 h, or ban with the last 10 messages deleted for repeat offenders). The suggestion escalates with risk and with how many times that user was flagged in the chat.
- **Scam waves:** when several accounts post the same scam, the card shows WAVE x4 and one press acts on all of them with the gentlest suggested action. Swipe up undoes the whole wave.
- **Double press** ignores, **swipe down** skips, **swipe up** undoes within 60 seconds, **long press** takes a spoken command such as "mute for a day", shown for confirmation before it runs.
- The queue refreshes on its own every 4 seconds. A NEW HIGH banner appears when more high-risk items arrive while you look at a card, and the card never changes under your thumb.
- Nothing is moderated automatically unless an admin turns on night mode (/night on, off by default). Every other action is an explicit gesture or a confirmed voice command, and there is an audit log.
- **Raid alert:** when 2 or more accounts post the same high-risk scam, on-call moderators get a Telegram DM and an optional phone call. The alert never acts.
- **Member reports:** a member forwards a scam DM to the bot and it becomes a REPORTED card.
- **Teamwork:** named moderators, "Maya is on this", and a safe response when two press at once.
- **Also built:** "mute the wave" by voice, a new-joiner label, response-time ranking, a "since you were away" line, raid replay, and night mode (mutes 3 or more matching accounts for 60 minutes only while nobody has the queue open, never bans, restorable for 12 hours).

## Why glasses
The decision is short and urgent, and a moderator on shift keeps their eyes up and hands free. One card, one suggested action and a few gestures fit a 576x288 green display.

## What is verified, and what is not
- Verified against a real Telegram supergroup with a second account: flagging, mute, message delete and undo.
- Verified in the Even Hub simulator: the card, wave press and undo, double press, auto-refresh, the NEW HIGH banner and shift summary.
- Verified end to end in the simulator: a recorded phrase ("mute for a day") played into a virtual microphone while holding Long Press, transcribed by Whisper (Groq), parsed, and shown on the confirm screen. A computer-generated phrase, not a person speaking into real glasses.
- LLM check (OpenRouter, gpt-4o-mini): 10 of 10 scams and 0 false positives on a 20-message set that was also used for tuning, against 7 of 10 for rules alone. A smoke test, not an accuracy claim.
- Unit-tested only (no live Telegram run yet): voice wave scope, new-joiner flag, response ranking, away line, raid replay and night mode.
- Not built: Business inbox, join warnings, a shared banned-elsewhere list, chat lock, assigning cards.
- Not verified: real G2 hardware, real speech from the glasses mic, and a real ban.

## Technical highlights
- Fastify API with a written contract; grammY for Telegram ban, restrict, delete and undo.
- Claim-then-commit actions, per-user serialization and versioned undo tokens, so double presses and stale undos cannot conflict.
- Rules plus LLM classifier with a timeout and a rules fallback; 50 server and 34 glasses tests.
- Even Hub plugin driven by a pure state machine.

## Track
Messaging & News, and the Best Telegram integration prize.

## Built before the hackathon
This repository started from a prototype built before the event, as stated at the top of the README. Commits after the first one were made during the hackathon.

## Feature requests for Telegram / Even Hub APIs

1. **Even Hub: continuous voice capture API.** Today a voice command needs a long press and a bounded mic session. A push-to-talk stream with partial STT results would let moderators speak "ban and delete their last ten" and see the parsed intent form live.
2. **Even Hub: text-wrapping and font metrics for the 576x288 canvas.** A measure call that returns wrapped line counts would let us fit a message, a reason, and an action hint without trial and error.
3. **Even Hub: background notifications or wake on glasses.** A way to raise a short glance alert when a high-risk item arrives while the plugin is not in the foreground, so moderators do not have to poll.
4. **Telegram: bot-visible join-age and account-age signals.** Account age is the strongest scam signal and bots cannot read it. A field on `User` or `ChatMember` would improve the classifier without any LLM.
5. **Telegram: a reversible "quarantine" moderation primitive.** Ban, mute and delete are blunt and only partly undoable (deleted messages cannot be restored). A hold state that hides a message from members until a moderator approves it would make glasses triage safe by design.

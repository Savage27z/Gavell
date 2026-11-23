# DoraHacks submission draft

## Title
Gavel: moderate Telegram scam waves from your glasses

## Problem
Crypto Telegram groups get hit by scam waves: fake support, wallet drainer links, impersonated admins and fake giveaways. Moderators lose members to a single successful scam within minutes, yet moderating means unlocking a phone and hunting through a fast chat.

## Who it is for
Volunteer and professional moderators of crypto communities who need to react in seconds, including while away from their desk.

## How it works
A Telegram bot reads group messages and a rules-first classifier flags likely scams, with optional LLM refinement. The Even G2 app shows one item at a time: risk, reason, sender and text. Press bans, double press ignores, swipe down skips, swipe up undoes, and long press opens a voice command like "mute for a day" or "ban and delete their last 10". The bot never moderates on its own; every action is an explicit moderator gesture, with a 60 second undo.

## Why glasses
The decision is short, urgent and one-handed. A 576x288 green glance plus five gestures is enough, and the moderator keeps their eyes up and hands free.

## Technical highlights
- Fastify API with a documented contract; Telegram Bot API for ban, restrict, delete and undo.
- Offline-capable rules classifier with an optional LLM stage, evaluated on 25 labelled messages.
- Voice intent parsing for short moderation phrases.
- Even Hub plugin and simulator-driven demo.

## Track
Heads Up hackathon: productivity and safety on Even Realities G2. Confirm the exact track name on DoraHacks before submitting.

## Built before the hackathon
See the "What existed before Nov 23" section of the README (placeholder to be completed by the team).

## Feature requests for Telegram / Even Hub APIs

1. **Even Hub: continuous voice capture API.** Today a voice command needs a long press and a bounded mic session. A push-to-talk stream with partial STT results would let moderators speak "ban and delete their last ten" and see the parsed intent form live.
2. **Even Hub: text-wrapping and font metrics for the 576x288 canvas.** A measure call that returns wrapped line counts would let us fit a message, a reason, and an action hint without trial and error.
3. **Even Hub: background notifications or wake on glasses.** A way to raise a short glance alert when a high-risk item arrives while the plugin is not in the foreground, so moderators do not have to poll.
4. **Telegram: bot-visible join-age and account-age signals.** Account age is the strongest scam signal and bots cannot read it. A field on `User` or `ChatMember` would improve the rules classifier without any LLM.
5. **Telegram: a reversible "quarantine" moderation primitive.** Ban, mute and delete are blunt and only partly undoable (deleted messages cannot be restored). A hold state that hides a message from members until a moderator approves it would make glasses triage safe by design.

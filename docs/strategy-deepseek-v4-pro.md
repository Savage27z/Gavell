# Gavel Hackathon Strategy: Feature Priorities for Build Week (Nov 23–29)

## Current State Assessment

The product works end-to-end in its current scope: 35 tests passing (22 server, 13 glasses), server live on :8787, Even Hub simulator rendering screenshots. The architecture is clean — a Fastify API with a documented contract, a rules-first classifier with optional LLM refinement, a Telegram integration via Grammy, and a glasses app with a well-tested state machine driving 5 gestures across 9 UI phases.

**What's solid:** The classifier catches obvious scams reliably (14/14 on dev set, 0 false positives). The gesture state machine is complete and well-tested — every gesture transition, undo path, and error state has a test. The API contract is tight and documented. The mock client lets the glasses app run without any backend, which is smart for development and the demo.

**What's missing for a winning entry:** The product is a dumb pipe. Message → classify → show → manual decision. There's no AI assistance in the decision itself, no user context, no smart defaults. The judging criteria explicitly reward "smart defaults or AI drafts instead of long dictation" under Read & Write (25%). The classifier has never been tested with a real LLM. There's no multi-group support, no repeat-offender tracking, no batch triage for scam waves. The demo storyboard shows a single moderator handling one item at a time — it doesn't convey the urgency or intelligence that would make judges think "I need this."

The gap between "works" and "wins" is about 40 hours of focused work. Below is what to spend it on.

---

## Ranked Feature Priorities

### 1. AI Action Suggestions (Smart Defaults)

**Score impact:** Usefulness +10pp, Read & Write +12pp, UX +5pp  
**Effort:** 6–8 hours  
**Risk:** Low — the LLM path already exists (`server/src/llm.ts:17-56`), it just needs a real key, a tuned prompt, and the glasses UI to show suggestions.  
**What to cut:** Nothing. This is the highest-leverage feature in the entire project.

The current flow: moderator sees a message, must decide ban/mute/ignore, must also decide how many messages to delete and for how long. Every decision is manual. The judging criteria's "Read and write" section says "acting fast: short phrase, one tap or ring, smart defaults or AI drafts instead of long dictation." Right now Gavel has none of that.

**What to build:** When the glasses load a card, call a new endpoint `POST /queue/:id/suggest` that returns a recommended `ActionRequest` based on: the message text, the user's flag history in this group, and (when available) account age. The glasses show the suggestion as the default action — e.g., the card footer changes from "Press ban | 2x ignore | Dn skip | Up undo | Hold voice" to "Suggested: Ban + delete last 10. Press to confirm." The moderator still presses to act; the AI only suggests, never auto-moderates.

**Implementation plan:**
- `server/src/service.ts`: Add `suggest(item: FlaggedItem): ActionRequest` that combines classifier score, user history (new `userStats` map), and optionally an LLM call
- `server/src/app.ts`: Add `POST /queue/:id/suggest` endpoint
- `glasses/src/machine.ts`: Add `suggestion` field to State, fetch on card load, render in footer
- `glasses/src/render.ts`: Show suggestion in the footer area, replacing the static cheat-sheet text

**Demo moment:** "This account was flagged 3 times before. Gavel suggests a ban and deleting their last 10 messages. One press, done." This single moment addresses three judging criteria at once.

---

### 2. User Reputation & Repeat Offender Tracking

**Score impact:** Usefulness +8pp, Business +5pp, Safety +3pp  
**Effort:** 4–5 hours  
**Risk:** Low — purely additive server-side tracking, no new external dependencies.  
**What to cut:** Can be simplified to per-user flag count if time is tight.

Currently the service tracks only recent message IDs per user (`server/src/service.ts:19`, `recent` map). It has no memory of past moderation actions. A scammer who was banned yesterday and rejoins today looks like a fresh user.

**What to build:** A `UserProfile` stored in the queue's persistence that tracks: total times flagged, total times actioned (ban/mute/ignore), last action and when, groups they've been seen in. Show a compact summary on the glasses card: "⚠ 3rd offense" or "New account · first flag." This feeds directly into the AI suggestion engine (feature #1) and also stands alone as glanceable context.

**Implementation plan:**
- `server/src/queue.ts`: Add `users: Map<string, UserProfile>` to `Persisted` and `ModQueue`
- `server/src/service.ts`: Update profiles on ingest and act
- `server/src/types.ts`: Add `UserProfile` type
- `glasses/src/render.ts`: Add a one-line reputation line to the card body
- `glasses/src/types.ts`: Add `repeatCount` to `FlaggedItem`

**Demo moment:** The glasses show "⚠ 3rd offense" above the message. The moderator knows instantly this isn't a borderline case.

---

### 3. Scam Wave Detection & Batch Triage

**Score impact:** Usefulness +10pp, Read & Write +8pp, Technical +3pp  
**Effort:** 5–7 hours  
**Risk:** Medium — clustering logic needs care to avoid false grouping; test thoroughly against the eval sets.  
**What to cut:** The clustering algorithm can start simple (exact URL match) and get fancier later.

Scam waves are the core use case the product is built for, yet the current queue treats every item as independent. When 5 accounts post the same drainer link within 30 seconds, the moderator has to press 5 times. The glasses should detect the cluster and offer batch action.

**What to build:** A `/queue/clusters` endpoint that groups pending items by similarity (same URL, same phishing domain, or high text similarity). When a cluster has ≥3 items, the glasses show "3 similar scams detected" with the option to ban all at once (double-press on the cluster card). Single items still flow through the normal card UI.

**Implementation plan:**
- `server/src/queue.ts`: Add `clusters(): FlaggedItem[][]` method that groups by extracted URL domain or Jaccard similarity on normalized text
- `server/src/app.ts`: Add `GET /queue/clusters` endpoint
- `glasses/src/machine.ts`: Add `cluster` phase, new gesture mapping for batch actions
- `glasses/src/render.ts`: Cluster card layout showing count + representative text

**Demo moment:** A scam wave hits. The glasses show "⚠ 5 similar scams · wallet-verify.xyz. Ban all 5?" One press clears the wave. This is the "acting fast" moment that wins the Read & Write criterion.

---

### 4. Real LLM Integration & Classifier Tuning

**Score impact:** Technical +8pp, Usefulness +3pp  
**Effort:** 3–4 hours  
**Risk:** Low — the `OpenAIRefiner` class exists and is tested with mocks (`server/test/all.test.ts`). Just needs a real API key and prompt engineering.  
**What to cut:** The LLM is optional by design (rules work offline). If API costs are a concern, test once, record results, and mention it in the submission. The demo can run rules-only.

The README honestly discloses "LLM path... has not been run against a real model." The held-out recall is 70% (7/10 scams flagged). A tuned LLM prompt could push this to 85%+ and close the gap on the "no keyword" scam messages that rules miss. For the technical execution score, removing the biggest disclosed caveat is high leverage.

**What to build:**
- Run the held-out set through a real LLM (GPT-4o-mini or Claude Haiku) with a tuned system prompt
- Measure precision/recall improvement
- Add the results to the README eval section
- Optionally: add a second LLM call for the suggestion engine (feature #1)

**Implementation plan:**
- `server/src/llm.ts`: Tune the system prompt with few-shot examples from the eval sets
- `server/test/eval.test.ts`: Add an LLM-assisted eval (skipped when no key, like the existing STT test pattern)
- `README.md`: Update eval results with LLM numbers

**Evidence to collect:** "Rules-only: 70% recall, 0% false positives on held-out. Rules + LLM: 85% recall, 0% false positives on held-out." That one line in the submission is worth several technical-execution points.

---

### 5. Multi-Group Moderation

**Score impact:** Business +6pp, Usefulness +5pp  
**Effort:** 5–7 hours  
**Risk:** Medium — changes the data model (items need a group context) and the glasses UI (need a group indicator/switcher).  
**What to cut:** If time is tight, keep single-group but add a `chatTitle` filter to stats so the API supports multi-group even if the glasses don't switch.

Professional moderators cover 3–10 groups. A single-group tool reads as a prototype; multi-group reads as a product. The current architecture almost supports it — `FlaggedItem` already has `chatId` and `chatTitle`. The queue's `next()` just needs an optional group filter.

**What to build:**
- `GET /queue/stats?chatId=X` for per-group stats
- `GET /queue/next?chatId=X` for per-group triage
- Glasses: a group selector (swipe left/right on empty state to switch groups, or a unified inbox with group badge)
- Per-group handled/pending counts on the glasses

**Implementation plan:**
- `server/src/queue.ts`: Add optional `chatId` filter to `next()`, `stats()`, and `clusters()`
- `server/src/app.ts`: Add query params to existing endpoints
- `glasses/src/machine.ts`: Add `groups` phase or integrate group switching into the card phase
- `glasses/src/render.ts`: Show group name more prominently on the card

**Demo moment:** The moderator switches between "Solana Degens" (12 pending) and "ETH Builders" (3 pending) with a swipe, clearing each group's queue in seconds.

---

### 6. Improved Glasses Display Layout

**Score impact:** UX +8pp, Usefulness +3pp  
**Effort:** 3–4 hours  
**Risk:** Low — pure rendering changes, well-tested by the existing `renderScreen` tests.  
**What to cut:** The current layout is functional; this is polish.

The current 576×288 layout (`glasses/src/render.ts:23-60`) splits into header (40px), body (190px), footer (48px). It works but doesn't use the canvas well. The risk badge `[!!!] HIGH` is text-based and noisy. The footer is a static cheat sheet that could be dynamic context.

**What to build:**
- Replace text badges with symbol-based indicators (e.g., `●●●` for high, `●●` for medium, `●` for low) that are more glanceable on monochrome green
- Dynamic footer: show the suggested action (from feature #1) or the gesture hint, never both
- Queue position indicator: "3 of 12" instead of just "12 pending"
- Better text fitting: measure character widths and wrap intelligently instead of the current 120-char hard truncation

**Implementation plan:**
- `glasses/src/render.ts`: Redesign `cardBody()` and badge rendering
- `glasses/src/machine.ts`: Add `position` to State (index in queue)
- `server/src/queue.ts`: Add `positionOf(id: string): number` method

**Demo moment:** The glasses show a clean, instantly readable card: three dots for risk, the message, the sender, and a one-line suggestion. No clutter. The judge thinks "I could actually read that."

---

### 7. Moderation Shift Stats

**Score impact:** Business +5pp, Technical +2pp  
**Effort:** 3–4 hours  
**Risk:** Low — additive endpoint, no glasses UI needed (stats live on a web dashboard or in the README).  
**What to cut:** The glasses don't need to show stats. A `GET /queue/stats/daily` endpoint plus a mention in the submission is enough.

For the Business Potential criterion, the product needs to show it works for teams, not just individuals. Shift stats — who handled what, when, queue velocity over time — make the case that Gavel is a tool you'd deploy across a moderation team.

**What to build:**
- `GET /queue/stats/daily?days=7` returning per-day handled counts, average response time, top moderators
- Optional: a simple HTML dashboard at `GET /` when the server runs (could reuse the glasses pairing page)

**Implementation plan:**
- `server/src/queue.ts`: Add timestamp tracking to resolved items, add `dailyStats(days: number)` method
- `server/src/app.ts`: Add stats endpoint
- Optional: `server/src/dashboard.ts` or a static HTML page

---

### 8. Appeal Flow (Defer to post-submission)

**Score impact:** Safety +4pp, Business +3pp  
**Effort:** 5–6 hours  
**Risk:** Medium — requires Telegram bot to DM banned users, adds complexity to the undo system.  
**What to cut:** This is the first feature to cut entirely if time runs short. It's important for real-world safety but hard to demo compellingly in 3 minutes.

When a user is banned, the bot sends them a DM: "You were banned from [group] for [reason]. If you believe this was a mistake, reply 'appeal' within 24 hours." Appeals go into a separate queue visible on the glasses. The moderator can review and unban with one gesture.

This directly addresses the safety criterion and the Telegram "quarantine" feature request. But the demo impact is low — appeal flows are inherently slow and hard to dramatize in a 3-minute video.

**Verdict:** Design it, document it in the submission as a planned feature, build it if everything above is done.

---

## What NOT to Build

These ideas are tempting but wrong for the build week:

- **Discord support:** Entirely different API surface (gateway intents, slash commands, different moderation primitives). Weeks of work. Mention as a future direction.
- **Ring-only operation mode:** The Even Hub API for haptic feedback may not exist or may be undocumented. The glasses already solve the "hands-free" problem. Don't bet the demo on an unverified API.
- **Real STT integration:** The Whisper path exists and is tested with mocks. Real STT adds latency, cost, and a network dependency that could fail during the demo. The mock voice path (`glasses/src/api.ts:151-158`) returns a canned phrase that always works — keep it for the demo.
- **OAuth / admin web dashboard:** Overengineered for a hackathon. The pairing code is simple and works.
- **Cross-group user reputation (global):** Privacy minefield. Keep reputation per-group.

---

## What Makes Gavel Stand Out

Most hackathon entries in the Messaging & News track will be chatbots or phone apps. Gavel's differentiators:

1. **Glasses-first, not glasses-also.** Every design decision — the one-item-at-a-time queue, the 5-gesture interface, the 60-second undo — is built for the G2's constraints. This isn't a phone app ported to glasses; it's a product that only makes sense on glasses.

2. **Human-in-the-loop by design.** "Never auto-moderate" (`CONTRACT.md:32`) is a safety principle, not a limitation. In an era of AI-everything, a tool that keeps the human in control while making them faster is the right pitch.

3. **Real problem, real urgency.** Crypto scam moderation is a genuine pain point with financial stakes. The demo can show actual scam patterns that judges will recognize.

4. **Clean architecture.** The API contract, state machine, and test coverage are unusually solid for a hackathon project. The codebase is small (~2000 lines) and well-organized. Judges who read the repo will notice.

The features above amplify these differentiators rather than diluting them. AI suggestions make the human faster without removing control. Batch triage makes the glasses handle the "scam wave" use case that phones can't. Multi-group makes it a professional tool.

---

## Feature Requests for Telegram / Even Hub APIs

The README already lists 5 good requests. Here they are, refined and reordered by impact on Gavel specifically:

### 1. Telegram: Account age and join date on User/ChatMember objects

**Why it matters for Gavel:** Account age is the single strongest scam signal (`server/src/classifier.ts:44-47` already boosts scores for accounts <7 days old) and bots cannot read it. The field exists in Telegram's database — it's shown in the official clients. Exposing it via the Bot API would improve every moderation bot, not just Gavel.

**Specific ask:** Add `account_created_date` (Unix timestamp) to the `User` object and `joined_date` to `ChatMember`. These should be visible when the bot has admin rights in the chat.

### 2. Even Hub: Background push notifications for plugin wake

**Why it matters for Gavel:** The core use case is "moderator is away from their phone but needs to know when a high-risk item arrives." Today the glasses app must be in the foreground. A push API that can wake the plugin and show a short glance alert ("⚠ High risk: Fake support in Solana Degens") would make Gavel truly always-on.

**Specific ask:** A `pushNotification` API that: (a) accepts a short text payload from an external server via webhook or SDK call, (b) displays it as a glance alert on the G2 regardless of which plugin is active, and (c) allows the user to tap to open the target plugin.

### 3. Telegram: Reversible "quarantine" moderation action

**Why it matters for Gavel:** Ban, mute, and delete are irreversible (deleted messages cannot be restored). Gavel's 60-second undo (`server/src/service.ts:78-88`) can unban a user but cannot restore deleted messages. A quarantine action that hides a message pending moderator review would make glasses triage safe by design — the moderator can quarantine first and decide later, without losing evidence.

**Specific ask:** A `quarantineMessage` API that hides a message from all non-admin users (similar to Telegram's existing "hide" for spam reports) with a corresponding `releaseMessage` to restore it. Quarantined messages should be visible to bot admins.

### 4. Even Hub: Continuous voice capture with partial STT results

**Why it matters for Gavel:** The current voice flow requires long-press → speak → release → wait for transcription → wait for intent parsing. A continuous stream with partial results would let the moderator see "ban and delete..." appear on screen as they speak, building confidence. It also enables the "smart defaults" feature to update live as the moderator speaks.

**Specific ask:** An audio capture API that streams PCM16 chunks to a developer-specified endpoint and accepts partial-text responses that the plugin can display in real time, replacing the current bounded `audioControl(true/false)` model.

### 5. Even Hub: Text layout metrics API

**Why it matters for Gavel:** The 576×288 canvas is tiny. The current rendering (`glasses/src/render.ts:14-16`) uses a hard 120-character truncation with no awareness of actual pixel width. A metrics API would let Gavel fit messages precisely, use proportional fonts effectively, and avoid wasted space.

**Specific ask:** A `measureText(text, fontParams)` call that returns the pixel width and wrapped line count for the given text on the G2 display, accounting for the active font, size, and weight.

---

## Demo Storyboard Improvements

The current script (`demo/DEMO_SCRIPT.md`) is functional but linear: it walks through each gesture one at a time. It doesn't build dramatic tension or show why glasses are better than a phone. Here's a restructured 3-minute arc:

### Revised Storyboard

| Time | Screen | Audio | Why it's better |
|---|---|---|---|
| 0:00–0:15 | **Phone screen recording** of a Telegram group. Messages scroll fast. A "Support Agent" posts a wallet drainer link. Someone types "is this real?" | "Crypto groups get hit by scam waves. Fake support, wallet drainers, impersonated admins. A single click can drain someone's wallet." | Opens with stakes, not product. Shows the problem viscerally. |
| 0:15–0:30 | **Split screen:** Phone showing the same group, moderator fumbling to unlock, find the message, tap the user, tap ban, tap delete. Glasses simulator beside it, showing the same message as a Gavel card. | "Moderating from a phone means unlock, scroll, tap, confirm. By the time you act, the damage is done." | Direct phone-vs-glasses comparison. The "why glasses" moment is visual, not narrated. |
| 0:30–0:50 | **Glasses simulator full screen.** Card shows: `●●● HIGH · 12 pending`, message text, `@support_fake · 3rd offense`, suggestion: `Suggested: Ban + delete last 10`. Moderator presses once. Toast: "Banned + deleted 10." | "Gavel shows one item at a time with a smart suggestion. This account has been flagged 3 times before. One press: banned, their last 10 messages deleted." | Shows AI suggestion + reputation in action. One press = fast. |
| 0:50–1:10 | **Scam wave hits.** Card changes to cluster view: `⚠ 4 similar scams · wallet-verify.xyz`. Same link posted by 4 accounts. Moderator presses. Toast: "Banned 4 accounts." Queue counter drops from 12 to 8. | "When a scam wave hits, Gavel groups identical scams. Four accounts, same drainer link — one press bans them all." | Batch triage is the "wow" moment. Shows the product handling real volume. |
| 1:10–1:30 | **Voice command.** Moderator long-presses on a medium-risk item. Mic indicator. Speaks: "mute for a day and delete their last 5." Glasses show the parsed intent live, then act. | "Long press for voice. Gavel parses the intent: mute for 24 hours, delete the last 5. No typing, no menus." | Voice is shown as a power-user feature, not the primary interaction. The live intent display addresses the "natural by voice" UX criterion. |
| 1:30–1:50 | **Undo.** Swipe up. Toast: "Undone." Queue counter goes back up. | "Wrong call? Swipe up within 60 seconds. The user is restored." | Safety feature shown quickly, not belabored. |
| 1:50–2:10 | **Multi-group switch.** Empty state shows group selector. Swipe to switch from "Solana Degens" (0 pending) to "ETH Builders" (5 pending). Card loads. | "Covering multiple groups? Switch with a swipe. Each group has its own queue and stats." | Professional use case. Makes it a tool, not a toy. |
| 2:10–2:35 | **Montage.** Fast cuts: classifier terminal output showing rules matching, the LLM prompt and response, the eval results (`14/14 scams flagged, 0 false positives`), the test suite passing (35/35). | "Under the hood: 18 rules catch obvious scams offline. An optional LLM sharpens the borderline cases. Rules alone catch 70% with zero false positives. With the LLM, 85%." | Technical execution evidence. Shows the code works, not just the demo. |
| 2:35–3:00 | **Wide shot.** Person wearing G2 glasses, walking outside, phone in pocket. Glasses simulator inset showing a new high-risk card arriving. They glance, press the ring, keep walking. Title card: `Gavel · Moderate at a glance · github.com/Savage27z/Gavel` | "Gavel turns your glasses into a moderation inbox. Read, decide, act — without touching your phone. Built for the Heads Up hackathon." | Ends on the emotional hook: freedom. The moderator is outside, away from their desk, still protecting their community. |

### Key improvements over the current script:

1. **Opens with the problem, not the product.** The current script spends 0:15 on setup narration. The revised script drops the viewer straight into a scam-in-progress.
2. **Shows the phone-vs-glasses contrast visually.** The split screen at 0:15–0:30 makes the "why glasses" argument without a single word of narration.
3. **Demonstrates AI suggestions and batch triage.** These are the features that win the Read & Write criterion. The current script shows only manual one-at-a-time actions.
4. **Shows multi-group.** Makes the product credible for professional use.
5. **Technical evidence montage.** The current script has a quick cut of the terminal at 2:30. The revised script gives it 25 seconds with specific numbers — judges who read code will care about this.
6. **Ends on freedom, not a repo link.** The closing shot of someone walking outside, moderating from their glasses, is the emotional argument for why this product exists.

### Demo logistics:

- **Pre-record the phone segments** (0:00–0:30) as screen recordings. Don't rely on live phone casting.
- **Pre-seed the queue** with the specific items the script references. The `POST /dev/seed` seeds are good but don't include a cluster scenario — add 3–4 items with the same fake URL for the batch triage moment.
- **Record the glasses simulator** at its native resolution. Crop to the 576×288 canvas area for close-ups.
- **Have a backup recording** of the entire flow using `VITE_MOCK=1` mode, which uses canned data and never touches the server. If anything breaks during the live recording, cut to the mock version.

---

## Build Week Schedule (Nov 23–29)

| Day | Focus | Features |
|---|---|---|
| Sat 23 | Foundation | Set up real LLM key, run eval, tune prompt (#4). Add `UserProfile` tracking to queue (#2). |
| Sun 24 | Smart defaults | Build `/queue/:id/suggest` endpoint + LLM suggestion prompt (#1). Wire into glasses state machine and render. |
| Mon 25 | Batch triage | Implement URL clustering in queue (#3). Add cluster phase to glasses machine. Test with seeded cluster data. |
| Tue 26 | Multi-group | Add `chatId` filters to API (#5). Build group switcher in glasses UI. |
| Wed 27 | Display polish | Redesign card layout, badges, dynamic footer (#6). Test all phases on simulator. |
| Thu 28 | Stats + demo prep | Build daily stats endpoint (#7). Record demo video with revised storyboard. Update README and submission text. |
| Fri 29 | Buffer + submit | Fix anything that broke. Final demo video edit. Submit. |

---

## Bottom Line

The single highest-leverage decision for the build week is whether to add AI-powered smart defaults. It touches three judging criteria at once (Usefulness, Read & Write, UX), it's 6–8 hours of work on top of an already-existing LLM integration path, and it transforms the demo from "here are the gestures" into "here's why this is smarter than your phone." Build that first. Everything else amplifies it.

The second call is whether to pre-record the demo video or attempt a live capture. Pre-record. The stakes are too high for a live Telegram API hiccup or simulator crash. Record each segment separately, edit for pacing, and keep a fully mock-driven backup.

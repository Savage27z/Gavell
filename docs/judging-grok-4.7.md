# Gavel judging notes

Panel: Mei (Even Realities platform engineer), Jonas (TVM Ventures), Ada (Telegram community-tool founder). Read as a DoraHacks submission for Heads Up, Messaging & News, plus the Telegram prize. Evidence is the repo at `/workspace/modqueue`, the live server on `:8787`, and the Even Hub simulator on `:9898`. Tests were run. Nothing was seeded and no queue action was left applied.

Today is 18 Nov 2026. The hackathon rule is to build during the event and say what existed before 23 Nov. `README.md:75-79` is still a TODO. The whole product is already on `main` (four commits, newest `b9971e8`). Submitting this snapshot as hackathon-built, with that section blank, fails the disclosure rule. Scores below are about the product. The blank disclosure is a separate compliance miss, not a hidden bonus.

## What actually runs

Server health is ok. Pairing works: no header gets 401, `x-pairing-code: demo` gets through. `PAIRING_CODE` is set and 4 characters. `TELEGRAM_BOT_TOKEN`, `LLM_API_KEY`, and `STT_API_KEY` are unset on the process. `POST /voice/transcribe` returns `501 {"error":"stt not configured"}`. Queue stats at review time: `{"pending":24,"handled":0}`. `GET /queue/next` returned a `demo: true` seed, not a classified Telegram message. 24 pending is the 12-row seed list applied twice. `POST /dev/seed` appends with no idempotency key (`server/src/app.ts:77-96`).

The one live glasses frame captured while the app was still driving the display (`~/.capy/work/reports/shots/gavel-card.png`, 576×288):

`[!!!] HIGH   24 pending` / `@mod_helpdesk_ in Solana Degens` / the 12-word seed quote, wrapped onto two lines / `> Asks for seed phrase` / footer `Press ban | 2x ignore | Dn skip | Up undo | Hold voice`, one line, fully on screen.

That reason string is copied from `server/src/seed.ts:16`, not produced by `classify()`. The frame the judge sees in this demo is a fixture.

After a Vite reconnect in the simulator (console ids 124-136), `createStartUpPageContainer` returned `1` (`invalid`). `glasses/src/main.ts:125` throws `Startup page failed: 1` and never registers `onEvenHubEvent` or hides the phone form. A later `down` gesture was delivered (console id 137, `eventType: 2`) and the framebuffer hash did not change. Webview (`gavel-webview.png`) is the unpaired HTML form, because `form.hidden` is set only after a successful page create (`main.ts:143`). A reload bricks the demo until the simulator process is restarted. That is a live-demo failure mode, observed, not hypothetical.

`cd server && npx vitest run`: 22 passed. `cd glasses && npx vitest run`: 13 passed. No test file mentions `OpenAIRefiner` or `WhisperTranscriber`. `README.md:73` says the LLM path is covered by mocked unit tests. It is not.

## Scores

| Criterion | Weight | Mei | Jonas | Ada | Mean |
|---|---:|---:|---:|---:|---:|
| Usefulness on G2 | 30% | 5 | 4 | 5 | 4.7 |
| Read and write | 25% | 6 | 5 | 6 | 5.7 |
| Technical execution | 20% | 6 | 5 | 6 | 5.7 |
| UX, display and voice | 15% | 6 | 6 | 6 | 6.0 |
| Business and safety | 10% | 6 | 3 | 5 | 4.7 |
| **Weighted** | | **5.7** | **4.7** | **5.6** | **5.3** |

Panel weighted total: **5.3 / 10**. Not a track winner on this evidence. A shortlist score for this hackathon starts around 7, and only if the core loop is on camera.

### Usefulness on G2 (30%) — mean 4.7

**Mei, 5.** The moment is real: a mod is walking, a scam lands, the decision is one glance and one press. The gesture map matches the hardware (`CONTRACT.md:37`, `glasses/src/gestures.ts:4-11`). The captured card is glanceable. Then the platform constraints eat the product. Even Hub is one app, no background alert. They know this; feature request 3 asks for wake. They also did not build the thing that works inside that constraint. `glasses/src` has no poll, no WebSocket, no `setInterval`. The only timer is the toast (`main.ts:83`). On `empty`, the footer says swipe down to refresh (`render.ts:51`). A high-risk item that arrives while you are looking at the current card, or at "Queue clear", does not appear until you ask. "Seconds before someone loses their wallet" (`DEMO_SCRIPT.md:7`) is a push job. This app is a pull inbox. `glasses/app.json:13-14` whitelists only `http://localhost:8787`. A phone running this build cannot reach a server on another machine. Simulator-only.

**Jonas, 4.** Crypto scam waves are a real pain. Glasses are not the distribution. A Telegram push to the mod, with one inline button, is faster than "remember to have Gavel in the foreground." The hardware gate (own a G2, keep this app open) makes the everyday moment a demo script, not a habit. I would not wear this to moderate.

**Ada, 5.** I have lost members to a fake-support message in under a minute. I want a queue. I do not want it on a display that stays quiet until I go looking. Rose and Combot already ping me. If Gavel cannot beat a bot DM on time-to-first-look, the glasses are a costume.

### Read and write (25%) — mean 5.7

**Mei, 6.** This is the part that matches the rubric. Press bans, double press ignores, swipe down skips, swipe up undoes, long press is a short phrase (`machine.ts:105-121`). The phrases in the tests are the right length: "ban and delete their last 10", "mute for a day" (`server/test/all.test.ts:49-64`). No dictation of a paragraph. That is the criterion. Two cuts. Voice does not run: live transcribe is 501, and `voiceIntent` acts immediately with no confirm (`machine.ts:204`). A mishear is a ban. And the write that matters, Telegram, is skipped for every item in the running queue (`service.ts:56`, `!item.demo`). I cannot score a write path I cannot see fire.

**Jonas, 5.** One press is the pitch, and the pitch is implemented in a state machine with tests. I still have not seen a phone confirm a ban. The demo script's backup plan is `POST /dev/seed` and a recording (`DEMO_SCRIPT.md:18`). That is a tell. Seeded bans are local bookkeeping.

**Ada, 6.** Ban, mute, delete-last-N, undo in 60 seconds is the actual mod toolbox, not a toy "flag" button. I would change the default. Press should delete the message or mute, not ban. Ban plus delete is not undoable as a pair: undo unbans (`service.ts:83`) and the README admits the text is gone (`README.md:62`). Voice parsing is sloppy for a mouth next to a ban button. `parseIntent("no")` is ignore (`intent.ts:29`). `parseIntent("not a scam")` is null. `parseIntent("ignore and delete their last 5")` drops the delete (`intent.ts:44`). `parseIntent("boot them")` is a ban. I would not put that parser on a live group.

### Technical execution (20%) — mean 5.7

**Mei, 6.** For a hackathon this is clean. Contract in `CONTRACT.md`, Fastify, a real reducer, timing-safe pairing (`app.ts:23-28`), demo items cannot reach Telegram, 35 tests green. Then the end-to-end claim fails. Telegram, LLM, and STT are all off on the process that is supposed to be the demo. `bot.catch(() => {})` (`index.ts:40`) swallows the errors you would need when it is on. Undo tokens and the "last N message ids" map are memory-only (`service.ts:19-20`); a restart forgets both, and `deleteRecent` can only delete ids seen since boot (`service.ts:59-60`). `accountAgeDays` is never passed from the bot (`index.ts:31-38`), so the new-account boost is dead. Reload bricks startup, as above. `app.json` cannot leave localhost.

**Jonas, 5.** I fund things that have touched the outside world. Three integrations are typed and unrun. The honest part is the eval. The dishonest sentence is the one about LLM tests. Those are different, and the second one costs trust.

**Ada, 6.** I read the classifier. Dev set 14/14 scams, 0 false positives, which the README admits was tuned on that set (`README.md:73`). Holdout, scored here with `classify()`: 7/10 scams, 0/10 false positives. Matches the test floor (`eval.test.ts:24-28` allows 70% recall and 1 false positive). The misses:

- Holdout 1, score 0.15, "Urgent: Binance security team… message our agent @bn_help_desk". "Urgent" hits. "message our agent" does not hit the DM/support rule.
- Holdout 6, score 0.25, "dm me and i send u 50 usdt". Under the 0.35 flag line (`service.ts:9`).
- Holdout 10, score **0**, "Send me 0.05 BTC and I will send you back 0.5 BTC in 1 hour". This is the scam. `classifier.ts:16` requires `send` immediately followed by a number, so "Send me 0.05" misses. Same hole on line 14.

`README.md:73` says misses are "phrased without any rule keyword." Holdout 10 is send, BTC, and back. That sentence is false. The same paragraph says the LLM pass is what catches them. `OpenAIRefiner.minScore` is 0.1 (`llm.ts:18`) and `service.ts:36` returns before `refine()` when the score is under that. Holdout 10 never reaches the model. When a message does, the model is averaged with the rules (`llm.ts:49`), so a confident "not a scam" cannot clear a high rule score, and a confident "scam" is diluted. The LLM has not been run against a real model. Rules-only, this is a keyword net with a published 30% holdout miss rate, including the most famous scam shape in crypto chats.

### UX, display and voice (15%) — mean 6.0

**Mei, 6.** The captured frame is the best thing in the submission. Monochrome, no color cheating, `[!!!] HIGH` reads as severity, the quote wraps, the reason is one line, the footer fits 576. That is actual G2 layout work, not a phone UI shrunk. Problems I would file: the bottom half of the 288 is empty; there is no age, and age is the fact ("8s ago" vs "4m ago"); the footer is a manual, so the primary verb never gets a line of its own; voice cannot be judged because STT is off and the page boot died before I could hold a long press on a live handler. The listening copy in `render.ts:56` is fine. I did not see it.

**Jonas, 6.** I would put that screenshot in a deck. I would not put the voice beat in the video. It will 501 on stage, and the script spends 30 seconds on it (`DEMO_SCRIPT.md:13`).

**Ada, 6.** I can decide from that card. I want the heard phrase on screen with press-to-confirm, not an immediate ban. "Hold voice" in the footer is jargon. A first-time mod on glasses will press because the footer says press bans, and that is the dangerous default, which at least is labeled.

### Business and safety (10%) — mean 4.7

**Mei, 6.** No auto-moderation is enforced, not just claimed: the bot only classifies on ingest, and Telegram is called only from `act()` (`service.ts:52-70`). 60-second undo, synthetic `.example` domains, no secrets in git, pairing compare is constant-time. Safety notes do not say that an LLM key ships member text to a third party. Default code in `.env.example` is `demo`, and `index.ts:22` falls back to `demo` whenever `NODE_ENV` is not production. One shared code is god mode for every group the bot admins. One press deletes text Telegram will not give back.

**Jonas, 3.** No buyer in the repo. Volunteer mods do not pay. Professional mods already pay Rose, Combot, Shieldy. The intersection of "owns a G2" and "mods a crypto Telegram" is not a company. The glasses client is a hackathon skin on a bot. There is no multi-tenant auth, no audit log, no billing, no web console. I would not take a meeting on this as a business. I would remember the founder if the next thing is a mod tool that is not hardware-gated.

**Ada, 5.** I would not install this in a group I care about. 30% of holdout scams stay in chat, so members still get drained, and a mis-tap bans someone and destroys the message I would need to show them. No per-mod identity, no audit log, no confirm. The safety instinct (human in the loop, undo, test-group warning at `README.md:63`) is the right instinct. It is not yet a tool I would hand another mod. As a business it is a feature request to an existing bot, which is a fine hackathon outcome and a bad company.

## Why it loses

1. **The job is a push, the app is a pull.** No foreground poll, no wake, and the platform cannot background-notify. The scam arrives while the mod is in any other app, which is the only way Even Hub works. The product misses the minute it claims to save.
2. **The stage demo is not the system in the pitch.** Running process has Telegram off, LLM off, STT 501. The queue is a doubled seed fixture with `demo: true`, so bans never hit Telegram (`service.ts:56`). A webview reload throws `Startup page failed: 1` and freezes the glasses frame. There is no demo video in the repo, only a storyboard.
3. **The classifier story does not survive contact with the holdout file.** 7/10, and "Send me 0.05 BTC… back 0.5 BTC" scores 0. The README says those misses have no keywords and that mocked LLM tests exist. Both claims are wrong. The Nov 23 disclosure is a TODO on a repo that already exists on Nov 18.

## Why it would win a round

1. **The gesture grammar is the right product.** Press, double press, down, up, hold-to-phrase. It is implemented as a reducer, tested, and it matches how a G2 is actually used. Most messaging hacks will be a phone chat pasted onto glasses. This one is not.
2. **The card is a real glance.** Risk, count, sender, wrapped quote, one-line reason, footer that fits 576×288 in green on black. I saw it. That frame is worth more than the architecture diagram.
3. **The safety posture is adult, and the writing around it is specific.** No auto-mod is in the code. Undo exists. Demo items cannot touch Telegram. The five feature requests (continuous voice, text metrics, wake, account age, a reversible quarantine) are the kind a platform team can file. Quarantine instead of ban-and-delete is the correct product insight, and they already know their own undo cannot restore text.

## Track winner?

No.

Against the five plausible neighbors, on this track (Messaging & News, Telegram prize available):

| Entry | Call vs Gavel |
|---|---|
| Inbox triage with a one-tap send | Loses to it. Pull is the right shape for inbox, and a drafted reply is a better "read and write" demo if it actually sends. Gavel's push problem does not apply to mail you open on purpose. |
| Telegram reply assistant | Loses to it if it sends a real message from a short phrase. Same prize, broader user, same glasses constraints, fewer irreversible side effects. Gavel wins only if that assistant is a reader with a fake compose box. |
| Meeting brief | Beats it on action, loses on how often the moment happens. A beautiful brief could still take the track on usefulness and display. I would not hand the track to a brief over Gavel if both are equally real; I would hand it to the brief if Gavel's video is the seed fixture. |
| Trading confirm | Beats it on this track. Trading confirm is a worse messaging fit, the money rule cages it, and a wrong confirm is a worse failure than a wrong ignore. Gavel's write path is more in-bounds. |
| Polymarket ticker | Beats it. A ticker fails the 25% criterion outright. Display craft would have to be exceptional to overcome a read-only glance. |

I would not give Gavel the track. I would not give it the Telegram prize either, unless the reply assistant cannot actually send and Gavel's video shows a human-posted message disappearing after a press. Neither is in this repo.

## What would move the score

One thing, in this order:

**Show a real test-group ban from the glasses, on camera, and make the card update by itself.** Post from a human account (the README already knows a poster bot will not be delivered to the mod bot, `README.md:57`). Press. Phone shows banned and deleted. Swipe up. Phone shows unbanned, and the voiceover says the text is gone. While that is recording, a second scam arrives and the glasses replace the card without a swipe. That is a `setInterval` plus `GET /queue/next`, or a websocket. It is the difference between a fixture and a tool. That single change is worth about a point on usefulness and a point on technical execution, which is roughly +0.5 weighted, and it is the difference between "middle" and "I will argue for it in the room."

Next, not instead: do not let press or a voice parse ban without a confirm line. Show `BAN @name? Press to confirm` or make press delete-only and hold the ban for the voice phrase. Cut the voice beat from the video until STT is on. Fix holdout 10, because a judge who opens that file will. Replace the Nov 23 TODO with an honest list, even if the honest list is "the whole repo existed before the event" or "nothing did, this was rebuilt." A blank section reads as a dodge.

Do not spend the remaining hours on a web dashboard, more rules, or an LLM key. The LLM gate cannot see a score of 0, and averaging cannot clear a false positive. A key in `.env` will not survive a question about it.

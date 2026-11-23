# Gavel — Even Realities G2 UX, Voice & Even Hub SDK Review (`gemini-4-argon`)

**Target**: `/workspace/modqueue` (`Savage27z/Gavel`)  
**Role**: G2 UX, Voice Flow & Even Hub SDK Reviewer  
**Hardware / SDK Baseline**: Even Realities G2 (`576×288` 4-bit monochrome green micro-LED, single firmware LVGL proportional font, temple/R1 gestures, 4-mic 16 kHz mono PCM array, `@evenrealities/even_hub_sdk@^0.0.16`, `@evenrealities/evenhub-simulator@^0.9.5`)  
**Hackathon Rubric Weights**: Usefulness on G2 (30%) · Read & Write Speed (25%) · Technical Execution (20%) · UX for Display & Voice (15%) · Business Potential & Safety (10%)

---

## Executive Summary: Top Blockers to Winning

1. **First-time pairing hangs forever on `Loading...`, and wrong pairing codes permanently brick the UI (`glasses/src/machine.ts:93-98`, `glasses/src/main.ts:61-66, 56, 130`)** — Submitting the pairing form on first launch (without `?code=demo` in the URL) transitions `state.phase` to `"loading"` and emits `{ type: "savePairing", code }`, which saves the code and returns **without ever triggering `fetchNext`**. Because `phase === "loading"` ignores all gestures (`machine.ts:109-111`), the glasses freeze on `GAVEL / Loading...`. Worse, if a user enters a mistyped code, a `401` throws `ApiError("Wrong pairing code", 401)` while the phone form stays hidden (`form.hidden = true`) and the dead `{ type: "unpair" }` message (`machine.ts:32, 99-101`) is never dispatched anywhere in the codebase.
2. **Any WebView reload crashes `boot()` with `[unhandledrejection] Startup page failed: 1` (`glasses/src/main.ts:105-113`)** — Confirmed live in the simulator console (`GET :9898/api/console`, entries `#130` and `#136`). `createStartUpPageContainer` is only valid **once** per plugin session (`https://hub.evenrealities.com/docs/build/page-lifecycle`). On any page reload, Vite HMR update, or URL navigation, `createStartUpPageContainer` returns `1` (`StartUpPageCreateResult.invalid`) and line 113 throws before registering `bridge.onEvenHubEvent` (line 115) or the `#pair-form` listener (line 124), leaving the glasses display frozen and unresponsive to input.
3. **`gestures.ts` conflates `sysEvent` with `textEvent` and defaults `eventType: undefined` to `CLICK_EVENT` = immediate BAN (`glasses/src/gestures.ts:12-16`)** — Confirmed in simulator console entry `#18` (`{"jsonData":{"eventSource":1},"sysEvent":{"eventSource":1}}`). Per Even Hub docs (`/docs/build/device-apis#handling-events`), only `textEvent` normalizes `0` (`CLICK_EVENT`) to `undefined`; `sysEvent` carries system/lifecycle/long-press events. Because `toGesture` evaluates `const source = event.textEvent ?? event.sysEvent ?? event.listEvent` and maps `source.eventType ?? OsEventTypeList.CLICK_EVENT` to `"press"`, any `sysEvent` lacking an `eventType` triggers an immediate **Ban + message deletion**.
4. **Guaranteed Even Hub QA rejection & muscle-memory collision: `doublePress` is bound to `ignore` instead of `shutDownPageContainer(1)` (`glasses/src/machine.ts:89-90`, `main.ts`)** — Even Hub QA guidelines (`/docs/ship/app-submission#exit-lifecycle`) explicitly state: *"Root-page double-tap calls `bridge.shutDownPageContainer(1)` - the system exit confirmation dialog... Apps that exit silently or do nothing on double-tap are rejected."* `shutDownPageContainer` is never called anywhere in Gavel. A user who double-taps to exit the app while viewing a card silently resolves the highest-risk scam in their queue as `ignore`.
5. **Voice flow has zero confirmation, swallows its own transcript display (`voiceHeard`), and bans users on negated speech like *"don't ban"* (`glasses/src/main.ts:95-96`, `server/src/intent.ts:26-45`)** — `main.ts:95` dispatches `voiceHeard` and immediately awaits `api.intent()` on line 96 (~1 ms regex route), overwriting the transcript with `"Working..."` before the glasses or human eye can read it. Meanwhile, `parseIntent` checks `isBan` first with no negation check (`"do not ban, keep it"` → **Ban**; `"remove from queue"` → **Ban** because `remove` is in `isBan`; `"skip"` → permanently resolves as **Ignore** instead of skipping).
6. **1-tap destructive Ban on all risk tiers + irreversible Telegram message deletion (`glasses/src/machine.ts:86-88`, `server/src/service.ts:55-67`)** — Single tap (`CLICK_EVENT`, the easiest accidental temple gesture) executes `ban` + `deleteMessage` immediately even on `MEDIUM`/`LOW` items like `seed.ts:23` (`"hey guys, can someone dm me? my wallet won't connect to the dapp, pls help"`, reason `"Asks to DM (maybe benign)"`). Even if the moderator swipes up to undo 1 second later, Telegram cannot restore a deleted message—and a slow double-tap intended to `ignore` fires two `CLICK_EVENT`s and bans the innocent user.

---

## Part 1: Even Hub SDK & Hardware Compliance Audit

Checked against `@evenrealities/even_hub_sdk@0.0.16` (`glasses/node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts`) and `https://hub.evenrealities.com/docs`.

### 1.1 Startup Page Lifecycle Crash on Reload (P0 — Technical Execution 20%)
- **Evidence**: `glasses/src/main.ts:105-113` & simulator `/api/console` entries `#130`, `#136`:
  ```
  130 error [unhandledrejection] Startup page failed: 1
  ```
- **Mechanism**: `bridge.createStartUpPageContainer(...)` is called unconditionally on every page load, and line 113 executes:
  ```ts
  if (created !== StartUpPageCreateResult.success) throw new Error(`Startup page failed: ${created}`);
  ```
  Per `/docs/build/page-lifecycle`, `createStartUpPageContainer` is valid **exactly once** when the plugin boots. If the WebView reloads (HMR, URL change, Android WebView recovery, or form submit), the host returns `StartUpPageCreateResult.invalid` (`1`). Throwing at line 113 aborts `boot()` before `bridge.onEvenHubEvent` (line 115) and `form.addEventListener("submit", ...)` (line 124) are registered.
- **Fix**: Wrap container initialization so that when `created !== StartUpPageCreateResult.success`, it falls back to `await bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum: 3, textObject: [...] }))`, and register DOM listeners before awaiting bridge calls.

### 1.2 Phantom Click / Accidental Ban from `sysEvent` Fallback (P0 — Technical Execution 20% & Safety 10%)
- **Evidence**: `glasses/src/gestures.ts:12-16` & simulator `/api/console` entry `#18`:
  ```
  18 log [EvenAppBridge] EvenHub event: {"jsonData":{"eventSource":1},"sysEvent":{"eventSource":1}}
  ```
- **Mechanism**:
  ```ts
  export function toGesture(event: EvenHubEvent): Gesture | null {
    const source = event.textEvent ?? event.sysEvent ?? event.listEvent;
    if (!source) return null;
    return BY_TYPE[source.eventType ?? OsEventTypeList.CLICK_EVENT] ?? null;
  }
  ```
  Per `/docs/build/device-apis#event-routing` and `index.d.ts:942-1005`:
  - `CLICK_EVENT (0)`, `SCROLL_TOP_EVENT (1)`, `SCROLL_BOTTOM_EVENT (2)`, and `DOUBLE_CLICK_EVENT (3)` route to `event.textEvent` (because container `BODY` has `isEventCapture: 1`). Only on `textEvent`/`listEvent` does protobuf omit `0` (`CLICK_EVENT`) as `undefined`.
  - `event.sysEvent` carries `LONG_PRESS_EVENT (9)`, `LONG_PRESS_RELEASE_EVENT (10)`, `FOREGROUND_ENTER_EVENT (4)`, `FOREGROUND_EXIT_EVENT (5)`, `ABNORMAL_EXIT_EVENT (6)`, `SYSTEM_EXIT_EVENT (7)`, `IMU_DATA_REPORT (8)`, or bare source-Notification packets (`{ eventSource: 1 }`).
  - Defaulting `sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT` turns any `sysEvent` with an omitted/unrecognized `eventType` into `"press"`, which immediately **bans the current user**.
- **Fix**: Route `event.textEvent` and `event.sysEvent` separately:
  ```ts
  export function toGesture(event: EvenHubEvent): Gesture | null {
    if (event.textEvent) {
      return BY_TYPE[event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT] ?? null;
    }
    if (event.sysEvent?.eventType !== undefined) {
      return BY_TYPE[event.sysEvent.eventType] ?? null;
    }
    return null;
  }
  ```

### 1.3 Missing `shutDownPageContainer(1)` & Root Double-Tap Violation (P0 — SDK / Store QA Compliance)
- **Evidence**: `glasses/src/main.ts` (no import or call to `shutDownPageContainer`), `glasses/src/machine.ts:89-90` (`case "doublePress": return act(state, { action: "ignore" })`).
- **Mechanism**: Even Hub's submission rubric (`/docs/ship/app-submission#exit-lifecycle`, `/docs/test/beta-testing#shutdownpagecontainer-1-system-exit-dialog`) mandates that root-page double-tap invoke `bridge.shutDownPageContainer(1)` (or open an in-app menu containing an Exit item that calls `shutDownPageContainer(1)`), and warns that apps doing nothing on root double-tap are auto-rejected.
  - In Gavel, double-tap on `empty`, `pairing`, `loading`, and `error` screens is a **silent no-op**.
  - On `card`, double-tap is mapped to **`ignore`**, meaning a moderator using standard G2 muscle memory to exit the app will accidentally mark the active scam item as safe.
  - Furthermore, per `/docs/build/device-apis#long-press`, *"The OS claims tap then long press for its own menu."* Gavel never registers a `menuObject` (`MenuContainerProperty`, `index.d.ts:520-544`) or handles `event.menuItemClickEvent` (`index.d.ts:1049`).

### 1.4 Microphone Control (`audioControl`) Race, Unchecked Permission Denial, and Stuck Open Mic (P1 — Technical Execution & Voice UX)
- **Evidence**: `glasses/src/main.ts:86-100, 115-122`, `glasses/src/machine.ts:157-163`.
- **Mechanism**:
  1. **Unchecked `boolean` return**: `await bridge.audioControl(true, AudioInputSource.Glasses)` (`main.ts:88`) returns `Promise<boolean>` (`index.d.ts`, `/docs/build/device-apis#audio`). When the user denies `g2-microphone` permission (tested in Beta QA Check #3) or BLE audio fails to open, `audioControl` resolves to `false` without throwing. Gavel still displays `LISTENING` and records 0 bytes until release.
  2. **Empty PCM `400` error**: If the user releases long-press before the first 100 ms PCM frame (`3200 bytes`) arrives (`chunks.length === 0`), `toBase64(pcm)` returns `""`. `POST /voice/transcribe { audio: "" }` hits `if (!req.body?.audio) return reply.code(400)` (`server/src/app.ts:67`), which `HttpClient` (`glasses/src/api.ts:34`) turns into `DONE / Server error 400`.
  3. **Unserialized `audioControl(true)` vs `audioControl(false)`**: `dispatch()` fires `void run(step.effect)` without awaiting prior effects (`main.ts:49`). A rapid long-press + release calls `bridge.audioControl(false)` while `bridge.audioControl(true)` is still in flight over BLE, leaving the G2 4-mic array open after `stopRecording` finishes.
  4. **No escape or timeout in `listening` phase**: In `machine.ts:157-163`, `listening` only transitions on `longRelease` (and only if `state.item` is truthy). If `LONG_PRESS_RELEASE_EVENT` is dropped over BLE or pre-empted by the OS contextual menu (`FOREGROUND_ENTER_EVENT = 4` / `FOREGROUND_EXIT_EVENT = 5`), the app stays stuck on `LISTENING` forever with the hardware microphone streaming continuously.

### 1.5 Locked-Phone / Background Lifecycle & Network Whitelist Gaps (P1 — Technical Execution & Usefulness)
- **Evidence**: `glasses/src/main.ts:20-23, 62-63`, `glasses/app.json:8-15`.
- **Mechanism**:
  1. **No foreground wake or polling**: Per `/docs/build/background-lifecycle`, when the phone locks or switches apps and returns (`OsEventTypeList.FOREGROUND_ENTER_EVENT = 4`), or while sitting on `phase: "empty"` (`Queue clear`), Gavel never polls `/queue/next` or listens for `FOREGROUND_ENTER_EVENT`. A moderator wearing G2 glasses sees `Queue clear` indefinitely while new scams pile up on the server unless they manually swipe down (`render.ts:47`).
  2. **`window.localStorage` instead of `bridge.getLocalStorage` / `bridge.setLocalStorage`**: `main.ts:21-22, 62-63` uses browser `localStorage` instead of the SDK's host-persisted `bridge.getLocalStorage` / `bridge.setLocalStorage` (`index.d.ts:12-15`).
  3. **`app.json` whitelist only allows `http://localhost:8787`**: On a real phone running the Even Realities App WebView, `localhost` resolves to the phone itself, not the Gavel backend server (`/docs/build/networking`). Any LAN IP or HTTPS backend configured via `VITE_API_URL` will be blocked by the Even App native permission gate unless added to `app.json`.

---

## Part 2: On-Glasses UX & 576×288 Monochrome Display Review

### 2.1 Information Hierarchy & the Under-3-Second Moderator Decision
A moderator glancing at a 576×288 monochrome green HUD during a scam wave needs to answer three questions in under 3 seconds:
1. **Why was this flagged, and how confident is the classifier?** (`risk`, `score`, `reason`)
2. **Who sent it, in which group, and is it a burst/bot attack?** (`@username` vs anonymous numeric ID, `chatTitle`, recent message count, age)
3. **What is the malicious payload (link / trigger phrase), and what will my tap do?**

**What Gavel currently renders (`glasses/src/render.ts:16-38`, verified via simulator screenshots `current_glasses.png`, `g1.png`, `s4.png`):**
```text
[!!!] HIGH   24 pending

@support_helpdesk_77 in Crypto Builders
"Hi! I'm from Wallet Support. Your wallet is at risk, DM me now and
verify your seed phrase at wallet-verify.xyz to avoi…"
> Fake support + wallet link


Press ban | 2x ignore | Dn skip | Up undo | Hold voice
```

**Hierarchy flaws observed on the 576×288 simulator canvas:**
- **Zero brightness hierarchy (`textColor` unused)**: Every container (`HEADER`, `BODY`, `FOOTER`) omits `textColor`, defaulting to maximum brightness `4` (`index.d.ts:440`). The 54-character static legend (`Press ban | 2x ignore | Dn skip | Up undo | Hold voice`) burns at the exact same brightness (`4`) as `[!!!] HIGH` and the scam text. Using `textColor: 2` (dim green) on `FOOTER` and `borderWidth: 1, borderColor: 6` on `BODY` immediately separates content from chrome on the 4-bit display.
- **Reason (`> Fake support + wallet link`) is buried at the bottom of `BODY`**: Because `reason` is appended *after* `item.text` (`render.ts:19`), its vertical position jumps up and down depending on whether `item.text` wraps across 1, 2, or 3 lines. Putting the classifier verdict at the top of the card (`[!!!] HIGH 96% · Fake support + wallet link`) gives the moderator the "why" in the very first eye fixation.
- **Missing high-signal metadata already available on the server**:
  - `item.score` (`0.96` vs `0.45`) and `item.flaggedAt` (e.g. `12s ago` vs `18m ago`) are already in `FlaggedItem` (`glasses/src/types.ts:13,15`) but never rendered (`render.ts:16-38`).
  - `ModService.recent` (`server/src/service.ts:20, 30-33`) already tracks how many recent messages that user has posted in that chat (up to 50), which is the exact number `deleteRecent` deletes! Exposing `userRecentCount` on `FlaggedItem` (e.g. `8 msgs`) tells the moderator at a glance when a spammer is flooding the chat and needs `"ban and delete their last 10"`.

### 2.2 Text Length, Truncation & Wrapping on 576×288 (Simulator Screenshot Evidence)
- **Premature 120-char truncation leaves ~45% of `BODY` empty (`glasses/src/render.ts:10`, `main.ts:109`)**:
  - In `main.ts:109`, `BODY` is allocated `yPosition: 44, width: 576, height: 190`.
  - In `g1.png` (`@support_helpdesk_77 in Crypto Builders`), the proportional LVGL font renders ~58–62 characters per line. `BODY_CHARS = 120` truncates `item.text` after just **2 lines** (`"...verify your seed phrase at wallet-verify.xyz to avoi…"`), using only ~96 px of the 190 px container and leaving a **~94 px blank black gap** above the footer!
  - Because `CONTRACT.md:11` allows `item.text` up to 400 characters, scammers who pad messages with 120 characters of polite greeting before dropping a drainer link have their link completely hidden by `truncate(item.text, 120)`, even though 3 more lines fit comfortably on screen (and `BODY` has `isEventCapture: 1`, which supports native firmware text scrolling if needed).
- **Mid-URL line wrapping (`s4.png`)**:
  - In `s4.png` (`user 502 in Crypto Builders`), `"Double your ETH in 24h guaranteed. Send 0.1 ETH get 0.2 back. t.me/doubler_bot"` wraps across lines right after `t.`:
    ```text
    "Double your ETH in 24h guaranteed. Send 0.1 ETH get 0.2 back. t.
    me/doubler_bot"
    ```
  - Splitting URLs across lines slows down domain inspection.
- **Unfiltered Emojis & Mathematical Unicode (`render.ts:12-15`)**:
  - Even G2's firmware LVGL font does **not** support emojis (`/docs/reference/faq#display-rendering`: *"Can I render emoji? No."*) or mathematical bold/italic Unicode characters (`𝐀𝐈𝐑𝐃𝐑𝐎𝐏`, `𝐒𝐮𝐩𝐩𝐨𝐫𝐭`), rendering placeholder boxes or dropping glyphs (`simulator README v0.7.0`).
  - Calling `.normalize("NFKD")` and stripping unsupported emoji ranges in `render.ts` (and in `server/src/classifier.ts`) both cleans up on-glasses rendering and closes a trivial regex-evasion vector.

---

## Part 3: Destructive One-Tap Safety & Undo Review

### 3.1 Single-Press = Immediate Permanent Ban Across All Risk Levels (`glasses/src/machine.ts:86-88`)
- **The hazard**: On `phase: "card"`, `press` (`OsEventTypeList.CLICK_EVENT`) unconditionally dispatches `act(state, { action: "ban" })`.
  - On the G2 temple touchpad, a single tap is the most common accidental input when adjusting the glasses or waking attention.
  - Worse, `doublePress` is mapped to `ignore` (`machine.ts:89-90`). If a moderator tries to double-tap to **ignore** a benign message (such as `seed.ts:23`: `@newbie2024` asking *"hey guys, can someone dm me? my wallet won't connect to the dapp, pls help"*, `risk: "medium"`, `score: 0.45`, `reason: "Asks to DM (maybe benign)"`) and their second tap falls slightly outside the firmware double-tap window, the glasses register a single `CLICK_EVENT`—**immediately banning the innocent user and permanently deleting their message**.
- **Why Undo does NOT make 1-tap Ban safe (`server/src/service.ts:64-66, 75-84`)**:
  - As disclosed in `README.md:57`, Telegram's Bot API (`deleteMessage`) **cannot restore deleted messages**. When `service.act()` runs on line 65 (`await this.tg.deleteMessage(...)`), the user's message is destroyed immediately. Swiping up 1 second later unbans the user (`unbanChatMember`), but their message is gone forever.
- **Concrete High-Impact Fix (Zero extra taps required for HIGH risk)**:
  1. **Optimistic 2.5s Commit Grace Window (True Undo)**: Hold the actual Telegram API call (`banChatMember` + `deleteMessage`) during the 2.2s–3.0s on-glasses `toast` countdown (or on the server for 3 seconds before flushing to Telegram). If the moderator swipes up during the toast (`< 3s`), cancel the pending job before `deleteMessage` ever hits Telegram! After 3s, commit to Telegram while keeping the 60s `unbanChatMember` token active.
  2. **Risk-Smart Default Action (Rubric: Read & Write 25% — "smart defaults")**:
     - For `HIGH` risk (`score >= 0.65`): Single press = **Ban + delete**.
     - For `MEDIUM` / `LOW` risk (`score < 0.65`, borderline cases): Single press should either default to **Mute 1h** / **Ignore**, or require a 2-press confirm (`Press again to Ban @user`), while `Hold voice` or contextual menu gives full access to Ban/Mute/Ignore.

### 3.2 Five Specific Undo Bugs (`glasses/src/machine.ts`, `render.ts`, `api.ts`, `server/src/telegram.ts`)
1. **Duplicate `"Swipe up to undo"` on the Toast screen** (verified in simulator screenshot `s2.png` / `s_ban.png`):
   - `machine.ts:131` sets `state.message = "Banned. Swipe up to undo"`.
   - `render.ts:41-43` sets `body: state.message` AND `footer: state.undoToken ? "Swipe up to undo" : ""`.
   - Result on glass (`s2.png`): `"Swipe up to undo"` is printed twice on a 3-line screen, while **the banned username and chat title are completely missing**.
2. **Voice failures show `DONE` in the header and leak stale `Swipe up to undo` in the footer** (verified in `s_voice.png`, `machine.ts:169-174`, `render.ts:39-44`):
   - `voiceFailed` transitions to `phase: "toast"` with `afterToast: "stay"`, so `renderScreen` renders header **`DONE`** above body **`Did not understand`**!
   - If `state.undoToken` is non-null from an earlier card, `render.ts:43` also renders `Swipe up to undo` at the bottom of the `voiceFailed` toast!
3. **`Ignore` triggers a 2.2-second `DONE / Ignored. Swipe up to undo` toast (`machine.ts:89-90, 125-134`)**:
   - Dismissing a false positive forces the moderator to stare at a `DONE / Ignored` toast for 2.2 seconds before the next scam loads, slowing down high-volume triage.
4. **Expired undo token (`410 Gone`) crashes into the `OFFLINE` screen (`server/src/app.ts:55`, `glasses/src/api.ts:34`, `machine.ts:102`)**:
   - After 60 seconds, `POST /queue/undo` returns HTTP `410`. `HttpClient.request` throws `ApiError("Server error 410", 410)`, which transitions the state machine to `phase: "error"` (`OFFLINE / Server error 410 / Press to retry`) and **never clears `state.undoToken`**, so every future `swipeUp` repeats the 410 error.
5. **`unmuteChatMember` grants elevated permissions (`server/src/telegram.ts:26-39`)**:
   - Undoing a mute calls `restrictChatMember` with `can_send_polls: true`, `can_send_documents: true`, `can_add_web_page_previews: true`, etc., overriding stricter group-wide default permissions.

---

## Part 4: Empty, Error, Loading & Pairing States

| State | Current Screen (`render.ts`) | Critical UX / State Machine Defect |
|---|---|---|
| **`pairing`** | `GAVEL` / `Open this app on your phone and enter the pairing code.` / `Waiting for pairing...` | **P0 Hang (`machine.ts:93-98`, `main.ts:61-66`)**: Submitting `#pair-form` dispatches `{ type: "paired", code }`, which sets `phase: "loading"` and runs `savePairing`—**never calling `fetchNext`**. The glasses hang on `Loading...` forever. |
| **`error` (401/403)** | `OFFLINE` / `Wrong pairing code` / `Press to retry` | **P0 Lockout (`api.ts:33`, `main.ts:130`, `machine.ts:32`)**: Header says `OFFLINE` even when the server returned `401 Wrong pairing code`. On the phone, `form.hidden = true` hides the input box, and `{ type: "unpair" }` (`machine.ts:99`) is dead code never called anywhere. Pressing on the glasses just re-sends the bad code forever. |
| **`empty`** | `GAVEL` / `Queue clear` / `Up undo \| Dn refresh` | **Stale display**: No background polling timer (e.g. every 5–10s) and no `FOREGROUND_ENTER_EVENT` refresh. Does not show `handled` count from `GET /queue/stats` (`types.ts:26`), leaving the moderator unsure if the bot is active. |
| **`loading`** | `GAVEL` / `Loading...` / `""` | **Flash of loading text**: Every `swipeDown` (skip) or post-toast transition replaces the entire card with `GAVEL / Loading...` before fetching, causing unnecessary visual flashing on localhost/LAN where responses take <30 ms. |

---

## Part 5: Voice Flow & Intent Phrasing Review

### 5.1 `voiceHeard` Is Overwritten in ~1 Millisecond & Never Confirmed (`glasses/src/main.ts:95-96`)
Look at `main.ts:94-97`:
```ts
const text = await api.transcribe(pcm);
if (!text.trim()) throw new ApiError("Did not hear that", 0);
dispatch({ type: "voiceHeard", text });
dispatch({ type: "voiceIntent", request: await api.intent(text, effect.itemId) });
```
- While `api.transcribe(pcm)` runs (500–2000 ms), the user sees `VOICE / Thinking...`.
- Once `transcribe` resolves, `dispatch({ type: "voiceHeard", text })` sets `state.message = '"..."'`.
- Immediately on the next line, `api.intent(text, effect.itemId)` calls `POST /voice/intent`, which runs synchronous regexes (`server/src/intent.ts`) in **~1 ms** (or 0 ms in `MockClient`) and immediately dispatches `voiceIntent` → `act()` → `phase: "busy", message: "Working..."`!
- **Result**: The moderator **never sees what Whisper transcribed**, and has **zero chance to confirm or cancel** before a destructive batch action (`deleteRecent: 50`) executes on Telegram.

### 5.2 Dangerous Phrasing Bugs in `parseIntent` (`server/src/intent.ts:26-45`)
1. **Negation blindness (`server/src/intent.ts:28-39`)**:
   - `isBan = /\b(ban|kick|remove|block|nuke|boot)\b/.test(text)` is checked first with no negation check.
   - Saying **`"do not ban"`**, **`"don't ban, ignore"`**, or **`"not a scam, don't remove"`** matches `\bban\b` / `\bremove\b` and **immediately bans the user**.
2. **`"remove"` and `"delete"` ambiguity (`server/src/intent.ts:28, 33-37`)**:
   - Saying **`"remove from queue"`** or **`"remove flag"`** matches `\bremove\b` in `isBan` → **bans the user**.
   - Saying **`"delete this message"`** (without `"ban"` or `"mute"`) fails `if (!isBan && !isMute && !isIgnore) return null` → **`422 Did not understand`**.
   - Saying **`"ban and delete their messages"`** (without a number or the word `"all"`) captures `"messages"` as `(\w+)` in `del`, fails `parseNumber("messages")`, and sets `deleteRecent = undefined` (deleting only 1 message instead of their recent messages).
3. **`"skip"` permanently resolves as `"ignore"` (`server/src/intent.ts:30`)**:
   - `isIgnore = /\b(ignore|skip|dismiss|leave|keep|safe|fine|allow|not spam|no)\b/.test(text)`.
   - Spoken `"skip"` or `"next"` executes `POST /queue/:id/action { action: "ignore" }`, which **permanently removes the item from the queue** (`service.ts:69`) instead of skipping it (`GET /queue/next?skip=...`).
4. **Spoken number gaps (`server/src/intent.ts:3-6, 13-24`)**:
   - `words` only maps `1..10, 15, 20, 30, 50`. Spoken phrases like `"mute for forty-five minutes"`, `"mute for twelve hours"`, `"mute for two hours"` (if hyphenated `"twenty-four hours"` → matches `"four hours"` = 240 min instead of 1440 min!), or `"half an hour"` fail or misparse.
5. **Context lost during `listening` (`s_listen.png`, `render.ts:50`)**:
   - Holding the temple touchpad replaces the entire screen with `LISTENING / Say: "ban and delete their last 10" or "mute for a day" / Release to send`, hiding `@username`, `chatTitle`, and `risk` while the moderator is speaking.

---

## Part 6: Concrete Screen Redesigns (Exact 576×288 Text Mockups & Container Specs)

### Container Architecture Upgrade (`createStartUpPageContainer` / `rebuildPageContainer`)
Use the Even Hub SDK `0.0.14+` visual affordances (`textColor` brightness `0..4`, `borderWidth`, `borderColor`, `paddingLength`, and `menuObject` contextual menu) across 3 text containers on the `576×288` canvas:
- **Container 1 (`HEADER`)**: `xPosition: 0, yPosition: 0, width: 576, height: 36, borderWidth: 0, textColor: 4, isEventCapture: 0`
- **Container 2 (`BODY`)**: `xPosition: 0, yPosition: 38, width: 576, height: 210, borderWidth: 1, borderColor: 5, borderRadius: 4, paddingLength: 6, textColor: 4, isEventCapture: 1` (gives 5 full lines / ~240 chars of message capacity + visual card frame)
- **Container 3 (`FOOTER`)**: `xPosition: 0, yPosition: 254, width: 576, height: 34, borderWidth: 0, textColor: 2, isEventCapture: 0` (dimmed brightness `textColor: 2` so the gesture bar never competes with the scam alert)
- **Contextual Menu (`menuObject`)**:
  ```ts
  menuObject: {
    menuItems: [
      { itemID: 1, itemName: "Mute 24h" },
      { itemID: 2, itemName: "Ban + Del 10" },
      { itemID: 3, itemName: "Ignore (Safe)" },
      { itemID: 4, itemName: "Unpair Server" },
    ],
  }
  ```

---

### Mockup 1: High-Risk Scam Card (`phase: "card"`, `risk: "high"`)
**Changes**: Verdict + confidence score + queue position on Line 1 (`HEADER`). Sender + group + burst count + age on Body Line 1, reason/link callout on Body Line 2, up to 220 chars of normalized message text across Lines 3–5. Dimmed footer (`textColor: 2`) with clear gesture labels.

```text
┌──────────────────────────────────────────────────────────┐
│ ▲ HIGH 96% · Fake support + wallet link          [1/24]  │ <- HEADER (h:36, textColor:4)
├──────────────────────────────────────────────────────────┤
│ @support_agent_sol · Solana Degens · 4 msgs · 12s ago    │ <- BODY (h:210, border:1,
│ > Link: phantom-validate.xyz                             │    borderColor:5, padding:6,
│ "Hello, I'm from Phantom Support. Your wallet has a      │    textColor:4, capture:1)
│ sync error. DM me now to validate your wallet:           │
│ phantom-validate.xyz"                                    │
├──────────────────────────────────────────────────────────┤
│ Tap: Ban+Del │ ↓: Skip │ ↑: Safe │ Hold: Voice │ 2x: Exit│ <- FOOTER (h:34, textColor:2)
└──────────────────────────────────────────────────────────┘
```
*(Note: Mapping `Swipe Up` on a card to `Ignore / Safe`—or keeping `Swipe Up` for Undo when an undo token is active—frees `Double Press (2x)` to call `bridge.shutDownPageContainer(1)` as required by Even Hub QA!)*

---

### Mockup 2: Medium / Borderline Card (`phase: "card"`, `risk: "medium"`) — Safe Default
**Changes**: For `MEDIUM`/`LOW` items (`score < 0.65`), single-tap defaults to **Skip / Safe** or **2-Tap Armed Ban** instead of instant permanent Ban + Delete, preventing false-positive bans on legitimate users asking for help.

```text
┌──────────────────────────────────────────────────────────┐
│ ◆ MED 45% · Asks to DM (maybe benign)            [7/24]  │ <- HEADER (textColor:4)
├──────────────────────────────────────────────────────────┤
│ @newbie2024 · DeFi Yield Club · 1 msg · 2m ago           │ <- BODY (border:1, textColor:4)
│ "hey guys, can someone dm me? my wallet won't connect    │
│ to the dapp, pls help"                                   │
│                                                          │
│ [!] Borderline: Tap arms Ban · ↓ Skips · ↑ Marks Safe    │
├──────────────────────────────────────────────────────────┤
│ Tap: Arm Ban │ ↓: Skip │ ↑: Safe │ Hold: Voice │ 2x: Exit│ <- FOOTER (textColor:2)
└──────────────────────────────────────────────────────────┘
```

---

### Mockup 3: Voice Push-to-Talk & 1.5s Parsed Intent Confirmation (`phase: "listening"` → `"confirmVoice"`)
**Changes**: Keep target `@username` and `risk` visible in the header while listening. After STT + `/voice/intent`, display the **parsed action + transcript for 1.5s** (`Tap: Execute now | ↓: Cancel`) instead of overwriting `voiceHeard` in 1 ms.

**While holding temple touchpad (`phase: "listening"`):**
```text
┌──────────────────────────────────────────────────────────┐
│ ● REC · @support_agent_sol [HIGH] in Solana Degens       │ <- HEADER (textColor:4)
├──────────────────────────────────────────────────────────┤
│ Speak command now...                                     │ <- BODY (border:1, textColor:4)
│   • "ban and delete last 10"                             │
│   • "mute for 2 hours"                                   │
│   • "mark safe" / "skip"                                 │
├──────────────────────────────────────────────────────────┤
│ Release temple to transcribe │ ↓: Cancel recording       │ <- FOOTER (textColor:2)
└──────────────────────────────────────────────────────────┘
```

**After release (`phase: "voiceHeard"` / 1.5s auto-confirm preview):**
```text
┌──────────────────────────────────────────────────────────┐
│ VOICE READY · @support_agent_sol                  [2s]   │ <- HEADER (textColor:4)
├──────────────────────────────────────────────────────────┤
│ Heard: "ban and delete their last 10"                    │ <- BODY (border:1, textColor:4)
│                                                          │
│ > Action: BAN USER + DELETE LAST 10 MESSAGES             │
│ > Group:  Solana Degens                                  │
├──────────────────────────────────────────────────────────┤
│ Tap: Confirm now (auto in 2s) │ ↓ or ↑: Cancel           │ <- FOOTER (textColor:2)
└──────────────────────────────────────────────────────────┘
```

---

### Mockup 4: Action Toast with Deferred Commit & Specific Target (`phase: "toast"`)
**Changes**: Eliminates the duplicate `"Swipe up to undo"` line (`s2.png`), names the exact `@username` and group, and delays the irreversible Telegram `deleteMessage` call until the 2.5s toast completes so swiping up during the toast preserves the original message.

```text
┌──────────────────────────────────────────────────────────┐
│ BANNED · Solana Degens                      23 remaining │ <- HEADER (textColor:4)
├──────────────────────────────────────────────────────────┤
│ > Banned @support_agent_sol + deleted 1 message          │ <- BODY (border:1, textColor:4)
│                                                          │
│ Undo window: 60s (Swipe ↑ now to cancel before delete)   │
├──────────────────────────────────────────────────────────┤
│ ↑: Undo Ban (@support_agent_sol) │ ↓ or Tap: Next card   │ <- FOOTER (textColor:2)
└──────────────────────────────────────────────────────────┘
```

---

### Mockup 5: Voice / Action Failure Toast (`phase: "voiceFailed"` — Distinct from `DONE`)
**Changes**: Never show `DONE` in the header when voice fails (`s_voice.png`), and never leak `Swipe up to undo` into the footer.

```text
┌──────────────────────────────────────────────────────────┐
│ [!] VOICE NOT UNDERSTOOD · @support_agent_sol            │ <- HEADER (textColor:4)
├──────────────────────────────────────────────────────────┤
│ Heard: "what is the weather"                             │ <- BODY (border:1, textColor:4)
│ Could not match a moderation action.                     │
│ Try: "ban", "ban and delete last 10", "mute 1 day"       │
├──────────────────────────────────────────────────────────┤
│ Hold: Try voice again │ Tap: Return to card              │ <- FOOTER (textColor:2)
└──────────────────────────────────────────────────────────┘
```

---

### Mockup 6: Error / Auth Failure with On-Glasses Unpair Escape (`phase: "error"`)
**Changes**: Distinguishes `PAIRING ERROR (401)` from `OFFLINE`, un-hides the phone pairing form on `401/403`, and wires `Swipe Up` (or contextual menu item #4) to `{ type: "unpair" }` so a user is never locked out.

```text
┌──────────────────────────────────────────────────────────┐
│ [!] PAIRING ERROR (401)                                  │ <- HEADER (textColor:4)
├──────────────────────────────────────────────────────────┤
│ Server rejected pairing code.                            │ <- BODY (border:1, textColor:4)
│ Re-enter the code on your phone (form unlocked).         │
├──────────────────────────────────────────────────────────┤
│ Tap: Retry │ ↑: Reset pairing code │ 2x: Exit            │ <- FOOTER (textColor:2)
└──────────────────────────────────────────────────────────┘
```

---

## Part 7: Prioritized Action Plan to Win the Hackathon

1. **[P0 — 5 min fix] Chain `fetchNext` after `savePairing` and unlock `#pair-form` on 401 (`glasses/src/main.ts:61-66`, `api.ts:33`)**:
   - In `main.ts:61-66`, after setting `client = effect.code ? clientFor(effect.code) : null`, immediately run `if (client) await run({ type: "fetchNext", skipped: [] });`.
   - When `ApiError.status === 401 || 403`, dispatch `{ type: "unpair" }` (or show `#pair-form`) so a typo in the pairing code does not brick the app.
2. **[P0 — 5 min fix] Fallback to `rebuildPageContainer` on reload (`glasses/src/main.ts:105-113`)**:
   - If `created !== StartUpPageCreateResult.success`, call `await bridge.rebuildPageContainer(...)` instead of throwing an unhandled error that kills event listeners.
3. **[P0 — 5 min fix] Separate `textEvent` vs `sysEvent` in `toGesture` (`glasses/src/gestures.ts:12-16`)**:
   - Only apply `?? OsEventTypeList.CLICK_EVENT` to `event.textEvent`, never to `event.sysEvent`.
4. **[P0 — 10 min fix] Fix Toast duplicate text, `DONE` header on voice error, and invisible `voiceHeard` (`glasses/src/render.ts:39-44`, `machine.ts:131, 166-174`, `main.ts:95-96`)**:
   - Remove `. Swipe up to undo` from `machine.ts:131` (since `render.ts:43` already puts it in `footer`), include `@username` in the toast body, and give `voiceFailed` an `ERROR` / `VOICE FAILED` header instead of `DONE`.
5. **[P1 — 15 min fix] Harden `parseIntent` against negations & `"skip"` vs `"ignore"`, and increase `BODY_CHARS` from `120` to `220` (`server/src/intent.ts:26-45`, `glasses/src/render.ts:10`)**:
   - Reject negated ban/mute phrases (`/\b(don'?t|do\s+not|never|no)\s+(ban|kick|remove|mute)\b/i`), separate `"skip"`/`"next"` from `"ignore"`, and use the full 5-line `BODY` container height with `textColor: 2` on `FOOTER`.
6. **[P1 — 15 min fix] Add `shutDownPageContainer(1)` exit path & `FOREGROUND_ENTER_EVENT` / empty-state polling (`glasses/src/main.ts`)**:
   - Satisfies Even Hub QA review requirements and makes the glasses genuinely hands-free when waiting for new scam waves.

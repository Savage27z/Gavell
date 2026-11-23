# 3-minute demo storyboard

Setup before recording: test group with the bot as admin, the server running with Telegram on (and LLM and STT keys set if you show them), the simulator open on the glasses app, a phone or window showing the Telegram test group, and a second Telegram account to post from. Bots cannot post to other bots, so scams must come from a human account. Rehearse once; the scam texts are in `demo/scam-messages.json`.

| Time | Screen | Voice line |
|---|---|---|
| 0:00-0:15 | Telegram test group beside the simulator showing "Queue clear" | "Crypto communities get scam waves. Moderators have seconds before someone loses a wallet." |
| 0:15-0:35 | Post one fake-support scam from the second account. The glasses show a HIGH card with reason, sender and text. Point at the footer: the suggested action | "Gavel puts the most urgent flagged message on the glasses with a suggested action. Nothing is ever moderated automatically." |
| 0:35-1:00 | Press. The Telegram view shows the message deleted and the user muted for 24 hours. Swipe up: the user can post again | "One press mutes and deletes. Wrong call? One swipe undoes it within a minute." |
| 1:00-1:50 | Post the same scam from 3 or 4 accounts (or use `POST /dev/seed`, which includes a 4-account wave, and say so). The card shows WAVE x4. Press once: all are cleared. Swipe up: all restored | "When the same scam hits from several accounts, Gavel groups it as a wave. One press clears the wave and one swipe undoes it." |
| 1:50-2:15 | Post a message with no scam keywords that the LLM flags, such as "Send me 0.05 BTC and I will send you back 0.5 BTC". Show it queued. Then double press on a harmless item to ignore it | "An LLM reviews every message, so scams with no keywords still get flagged. Harmless items are one double press away from gone." |
| 2:15-2:40 | Long press, say "mute for a day", show the confirm screen, press to confirm. Only show this if STT is on and you tested it just before | "Voice is a short phrase. It shows what it heard and waits for your press." |
| 2:40-3:00 | Empty queue with the shift summary, then a title card with the repo | "Read, decide, act, without touching your phone. Tested in the simulator and a real Telegram group." |

## Say this honestly in the video or description
- It was run in the Even Hub simulator and a Telegram test group, not on real glasses.
- Seeded demo items never touch Telegram. Say so if you use them.

## Backup plan
If Telegram is slow, use `POST /dev/seed` for the wave and show the Telegram result from an earlier recording.

## Gesture cheat sheet
Press run the suggested action, double press ignore, swipe down skip, swipe up undo, long press voice.

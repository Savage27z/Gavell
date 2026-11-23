# 3-minute demo storyboard

Setup before recording: test group with the bot as admin, server running, simulator open on the glasses app, queue seeded (`POST /dev/seed` or the posting script). Keep a phone view of the Telegram test group beside the simulator.

| Time | Screen | Voice line |
|---|---|---|
| 0:00-0:15 | Phone showing a busy Telegram crypto group, scam messages flying in | "Every crypto community gets scam waves. Moderators have seconds before someone loses their wallet." |
| 0:15-0:35 | Title card, then the simulator showing the empty queue with "0 pending" | "Gavel turns your Even G2 glasses into a moderation inbox. Nothing is ever moderated automatically." |
| 0:35-1:00 | Post the "fake support" message from a test account. The queue shows a HIGH item: reason "Fake support + wallet link", sender, text | "A fake support message lands. The glasses show risk, reason and who sent it, in one glance." |
| 1:00-1:20 | Press gesture in the simulator. Phone shows the message deleted and user muted for 24 hours. Counter drops | "One press: mute and delete. Undo is one swipe away." |
| 1:20-1:40 | Swipe up. Phone shows the user restored | "Wrong call? Swipe up within sixty seconds and it is undone." |
| 1:40-2:00 | Swipe down to a medium item, then double press | "Borderline item, not a scam. Double press ignores it. Swipe down skips." |
| 2:00-2:30 | Next HIGH item (drainer link). Long press, mic indicator, say the command. The glasses show the parsed command; press to confirm. Result: mute or ban with the last 10 messages deleted | "Long press and talk: 'ban and delete their last ten'." |
| 2:30-2:50 | Quick cut of the queue clearing; terminal showing the classifier running offline with no LLM key | "Rules run offline. An optional LLM sharpens borderline cases. We checked it on 25 labelled messages." |
| 2:50-3:00 | Title card with repo and feature requests | "Gavel: read, decide, act, without touching your phone." |

## Backup plan
If Telegram is slow, use `POST /dev/seed` to fill the queue and show the Telegram result from a recording.

## Gesture cheat sheet
Press mute and delete, double press ignore, swipe down next, swipe up undo, long press voice.

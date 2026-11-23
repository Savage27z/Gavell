import { describe, expect, it } from "vitest";
import { initialState, reduce, type State } from "./machine";
import { renderScreen, truncate } from "./render";
import type { FlaggedItem } from "./types";

const item: FlaggedItem = {
  id: "a",
  chatId: 1,
  chatTitle: "Chat",
  userId: 7,
  username: "spam",
  text: "DM me for a free wallet",
  messageId: 1,
  risk: "high",
  score: 0.9,
  reason: "Fake support",
  flaggedAt: "2026-01-01T00:00:00Z",
  offenses: 1,
  waveSize: 1,
  suggested: { action: "mute", muteMinutes: 1440, deleteRecent: 1 },
  ownSuggested: { action: "mute", muteMinutes: 1440, deleteRecent: 1 },
};

const card = (): State => ({ ...initialState("c"), phase: "card", item, pending: 3 });

describe("machine", () => {
  it("starts in pairing without a code and loading with one", () => {
    expect(initialState(null).phase).toBe("pairing");
    expect(initialState("c").phase).toBe("loading");
  });

  it("pairing saves the code and loads the queue", () => {
    const step = reduce(initialState(null), { type: "paired", code: "123" });
    expect(step.state.phase).toBe("loading");
    expect(step.effect).toEqual({ type: "savePairing", code: "123" });
  });

  it("loaded with no item shows empty state", () => {
    const step = reduce(initialState("c"), { type: "loaded", item: null, pending: 0 });
    expect(step.state.phase).toBe("empty");
    expect(renderScreen(step.state).body).toBe("Queue clear");
  });

  it("press mutes and deletes, double press ignores", () => {
    expect(reduce(card(), { type: "gesture", gesture: "press" }).effect).toEqual({
      type: "act",
      itemId: "a",
      request: { action: "mute", muteMinutes: 1440, deleteRecent: 1 },
    });
    expect(reduce(card(), { type: "gesture", gesture: "doublePress" }).effect).toMatchObject({
      request: { action: "ignore" },
    });
  });

  it("swipe down skips the current item", () => {
    const step = reduce(card(), { type: "gesture", gesture: "swipeDown" });
    expect(step.effect).toEqual({ type: "fetchNext", skipped: ["a"] });
  });

  it("action result shows undo toast, then loads next", () => {
    const busy = reduce(card(), { type: "gesture", gesture: "press" }).state;
    const toast = reduce(busy, { type: "acted", request: { action: "ban" }, undoToken: "u1" });
    expect(renderScreen(toast.state).body).toBe("Banned. Swipe up to undo");
    expect(reduce(toast.state, { type: "toastDone" }).effect.type).toBe("fetchNext");
  });

  it("swipe up during toast undoes the last action", () => {
    const busy = reduce(card(), { type: "gesture", gesture: "press" }).state;
    const toast = reduce(busy, { type: "acted", request: { action: "ban" }, undoToken: "u1" }).state;
    expect(reduce(toast, { type: "gesture", gesture: "swipeUp" }).effect).toEqual({ type: "undo", token: "u1" });
  });

  it("swipe up without undo token does nothing", () => {
    expect(reduce(card(), { type: "gesture", gesture: "swipeUp" }).effect.type).toBe("none");
  });

  it("long press records, release transcribes, intent waits for confirmation", () => {
    const listening = reduce(card(), { type: "gesture", gesture: "longPress" });
    expect(listening.effect.type).toBe("startRecording");
    const released = reduce(listening.state, { type: "gesture", gesture: "longRelease" });
    expect(released.effect).toEqual({ type: "stopRecording", itemId: "a" });
    const asked = reduce(released.state, { type: "voiceIntent", request: { action: "ban", deleteRecent: 10 } });
    expect(asked.state.phase).toBe("confirm");
    expect(asked.effect.type).toBe("none");
    expect(renderScreen(asked.state).body).toContain("Banned + deleted 10");
    const confirmed = reduce(asked.state, { type: "gesture", gesture: "press" });
    expect(confirmed.effect).toMatchObject({ type: "act", itemId: "a", request: { action: "ban", deleteRecent: 10 } });
  });

  it("press executes the server's suggested action and the card shows it", () => {
    const repeat = { ...item, offenses: 3, suggested: { action: "ban" as const, deleteRecent: 10 } };
    const state = { ...card(), item: repeat };
    expect(reduce(state, { type: "gesture", gesture: "press" }).effect).toMatchObject({ request: { action: "ban", deleteRecent: 10 } });
    const screen = renderScreen(state);
    expect(screen.footer).toContain("Press ban+del10");
    expect(screen.body).toContain("#3 offense");
  });

  it("NEW HIGH alert fires when more high items arrive while viewing a high card, and clears on load", () => {
    const viewing = reduce({ ...initialState("c"), phase: "loading" }, { type: "loaded", item, pending: 3, high: 1 }).state;
    expect(viewing.knownHigh).toBe(1);
    const same = reduce(viewing, { type: "polled", item, pending: 3, high: 1 }).state;
    expect(same.alert).toBe(false);
    const more = reduce(viewing, { type: "polled", item, pending: 4, high: 2 }).state;
    expect(more.alert).toBe(true);
    expect(renderScreen(more).header).toContain("NEW HIGH");
    expect(more.item?.id).toBe("a");
    expect(reduce({ ...more, phase: "loading" }, { type: "loaded", item, pending: 4, high: 2 }).state.alert).toBe(false);
  });

  it("double press ignores the whole wave and labels it", () => {
    const wave = { ...item, waveSize: 4 };
    const state = { ...card(), item: wave };
    expect(reduce(state, { type: "gesture", gesture: "doublePress" }).effect).toMatchObject({ type: "act", request: { action: "ignore" }, wave: true });
    expect(renderScreen(state).footer).toContain("2x ignore x4");
    expect(reduce(card(), { type: "gesture", gesture: "doublePress" }).effect).not.toHaveProperty("wave");
  });

  it("a wave card says when it acts more gently than the lead item alone", () => {
    const wave = { ...item, waveSize: 4, ownSuggested: { action: "ban" as const, deleteRecent: 10 } };
    const screen = renderScreen({ ...card(), item: wave });
    expect(screen.body).toContain("This one alone: ban+del10");
    expect(screen.footer).toContain("Press mute 1d+del x4");
    const same = renderScreen({ ...card(), item: { ...item, waveSize: 4 } });
    expect(same.body).not.toContain("This one alone");
  });

  it("swipe down cancels a pending voice command", () => {
    const asked = reduce(card(), { type: "voiceIntent", request: { action: "ban" } });
    const confirm = { ...asked.state, phase: "confirm" as const, request: { action: "ban" as const } };
    const cancelled = reduce(confirm, { type: "gesture", gesture: "swipeDown" });
    expect(cancelled.state.phase).toBe("card");
    expect(cancelled.effect.type).toBe("none");
  });

  it("tick refreshes an empty queue and polls on a card, but never swaps the card", () => {
    expect(reduce({ ...initialState("c"), phase: "empty" }, { type: "tick" }).effect).toMatchObject({ type: "fetchNext" });
    expect(reduce(card(), { type: "tick" }).effect).toEqual({ type: "poll" });
    const other = { ...item, id: "b", risk: "high" as const };
    const polled = reduce(card(), { type: "polled", item: other, pending: 9 });
    expect(polled.state.item?.id).toBe("a");
    expect(polled.state.pending).toBe(9);
  });

  it("tick retries after an error so the glasses recover on their own", () => {
    const failed = reduce(card(), { type: "failed", message: "Offline. Press to retry" });
    expect(reduce(failed.state, { type: "tick" }).effect).toMatchObject({ type: "fetchNext" });
  });

  it("ticks are ignored while an action is in flight", () => {
    const busy = { ...card(), phase: "busy" as const };
    expect(reduce(busy, { type: "tick" }).effect.type).toBe("none");
  });

  it("voice failure returns to the card after the toast", () => {
    const released = reduce(reduce(card(), { type: "gesture", gesture: "longPress" }).state, { type: "gesture", gesture: "longRelease" });
    const failed = reduce(released.state, { type: "voiceFailed", message: "Did not understand" });
    expect(reduce(failed.state, { type: "toastDone" }).state.phase).toBe("card");
  });

  it("errors show offline state and press retries", () => {
    const failed = reduce(card(), { type: "failed", message: "Offline. Press to retry" });
    expect(renderScreen(failed.state).header).toBe("OFFLINE");
    expect(reduce(failed.state, { type: "gesture", gesture: "press" }).effect.type).toBe("fetchNext");
  });

  it("card render has badge, username, reason and pending count", () => {
    const screen = renderScreen(card());
    expect(screen.header).toContain("HIGH");
    expect(screen.header).toContain("3 pending");
    expect(screen.body).toContain("@spam");
    expect(screen.body).toContain("Fake support");
  });

  it("truncates long text", () => {
    expect(truncate("x".repeat(300), 50)).toHaveLength(50);
  });

  describe("wave", () => {
    const wave = (): State => ({ ...card(), item: { ...item, waveSize: 4 } });

    it("shows count in header and footer", () => {
      const screen = renderScreen(wave());
      expect(screen.header).toContain("WAVE x4");
      expect(screen.footer).toContain("Press mute 1d+del x4");
      expect(renderScreen(card()).header).not.toContain("WAVE");
    });

    it("press applies the suggestion to the whole wave and undo covers all tokens", () => {
      const step = reduce(wave(), { type: "gesture", gesture: "press" });
      expect(step.effect).toEqual({ type: "act", itemId: "a", request: item.suggested, wave: true });
      const toast = reduce(step.state, { type: "acted", request: item.suggested, undoToken: "u1", undoTokens: ["u1", "u2", "u3", "u4"], applied: 4, failed: 0 }).state;
      expect(toast.message).toBe("Muted 4 users. Swipe up to undo");
      expect(reduce(toast, { type: "gesture", gesture: "swipeUp" }).effect).toEqual({ type: "undo", token: "u1", tokens: ["u1", "u2", "u3", "u4"] });
    });

    it("reports partial failures", () => {
      const busy = reduce(wave(), { type: "gesture", gesture: "press" }).state;
      const toast = reduce(busy, { type: "acted", request: item.suggested, undoToken: "u1", undoTokens: ["u1", "u2", "u3"], applied: 3, failed: 1 }).state;
      expect(toast.message).toBe("Muted 3 users, 1 failed. Swipe up to undo");
    });
  });

  describe("new high alert", () => {
    const medium = { ...item, risk: "medium" as const };
    const fresh = { ...item, id: "b" };
    const viewing = (): State => ({ ...card(), item: medium });

    it("flags a new high item without swapping the card", () => {
      const step = reduce(viewing(), { type: "polled", item: fresh, pending: 5 });
      expect(step.state.alert).toBe(true);
      expect(step.state.item).toBe(medium);
      expect(renderScreen(step.state).header).toContain("NEW HIGH - Dn to view");
    });

    it("does not alert when the card is already high, the item is the same, or the item is not high", () => {
      expect(reduce(card(), { type: "polled", item: fresh, pending: 5 }).state.alert).toBe(false);
      expect(reduce(viewing(), { type: "polled", item: medium, pending: 5 }).state.alert).toBe(false);
      expect(reduce(viewing(), { type: "polled", item: { ...fresh, risk: "medium" }, pending: 5 }).state.alert).toBe(false);
      expect(reduce(viewing(), { type: "polled", item: null, pending: 0 }).state.alert).toBe(false);
    });

    it("swipe down skips the current id and clears the alert once the new item loads", () => {
      const alerted = reduce(viewing(), { type: "polled", item: fresh, pending: 5 }).state;
      const down = reduce(alerted, { type: "gesture", gesture: "swipeDown" });
      expect(down.effect).toEqual({ type: "fetchNext", skipped: ["a"] });
      expect(reduce(down.state, { type: "loaded", item: fresh, pending: 5 }).state.alert).toBe(false);
    });
  });

  describe("shift summary", () => {
    it("empty screen shows the shift counts when something was handled", () => {
      const shift = { handled: 14, muted: 9, banned: 3, ignored: 2 };
      const state = reduce(initialState("c"), { type: "loaded", item: null, pending: 0, shift }).state;
      expect(renderScreen(state).body).toBe("Queue clear\nShift: 14 handled 9 mute 3 ban 2 ignore");
    });
  });
});

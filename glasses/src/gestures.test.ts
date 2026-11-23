import { OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";
import { describe, expect, it } from "vitest";
import { STARTUP_QUIET_MS, toGesture } from "./gestures";

const ev = (value: unknown) => value as EvenHubEvent;
const LATE = STARTUP_QUIET_MS + 1;

describe("toGesture", () => {
  it("treats a text event without a type as a press", () => {
    expect(toGesture(ev({ textEvent: {} }), 0)).toBe("press");
  });

  it("ignores a typeless system event during startup", () => {
    expect(toGesture(ev({ sysEvent: { eventSource: 1 } }), 100)).toBeNull();
  });

  it("treats a typeless system event with a source as a press once running (simulator click)", () => {
    expect(toGesture(ev({ sysEvent: { eventSource: 1 } }), LATE)).toBe("press");
  });

  it("ignores a system event with neither type nor source", () => {
    expect(toGesture(ev({ sysEvent: {} }), LATE)).toBeNull();
  });

  it("maps explicit system long press events", () => {
    expect(toGesture(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT } }), 0)).toBe("longPress");
    expect(toGesture(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT } }), 0)).toBe("longRelease");
  });

  it("maps scroll events", () => {
    expect(toGesture(ev({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }), 0)).toBe("swipeDown");
    expect(toGesture(ev({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } }), 0)).toBe("swipeUp");
  });
});

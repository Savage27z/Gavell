import { OsEventTypeList, type EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { Gesture } from "./machine";

const BY_TYPE: Partial<Record<OsEventTypeList, Gesture>> = {
  [OsEventTypeList.CLICK_EVENT]: "press",
  [OsEventTypeList.DOUBLE_CLICK_EVENT]: "doublePress",
  [OsEventTypeList.SCROLL_TOP_EVENT]: "swipeUp",
  [OsEventTypeList.SCROLL_BOTTOM_EVENT]: "swipeDown",
  [OsEventTypeList.LONG_PRESS_EVENT]: "longPress",
  [OsEventTypeList.LONG_PRESS_RELEASE_EVENT]: "longRelease",
};

export const STARTUP_QUIET_MS = 1500;

export function toGesture(event: EvenHubEvent, msSinceBoot: number): Gesture | null {
  if (event.textEvent) return BY_TYPE[event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT] ?? null;
  const source = event.sysEvent ?? event.listEvent;
  if (!source) return null;
  if (source.eventType !== undefined) return BY_TYPE[source.eventType] ?? null;
  if (event.sysEvent?.eventSource !== undefined && msSinceBoot > STARTUP_QUIET_MS) return "press";
  return null;
}

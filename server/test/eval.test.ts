import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "../src/classifier.js";

const load = <T>(name: string): T[] => JSON.parse(readFileSync(new URL(`../../demo/${name}`, import.meta.url), "utf8"));

function score(rows: { scam: boolean; text: string }[]) {
  const flagged = rows.map((r) => ({ scam: r.scam, hit: classify(r.text).score >= 0.35 }));
  const scams = flagged.filter((r) => r.scam);
  return {
    recall: scams.filter((r) => r.hit).length / scams.length,
    falsePositives: flagged.filter((r) => !r.scam && r.hit).length,
  };
}

describe("rules classifier on labelled sets", () => {
  it("dev set", () => {
    const rows = load<{ expectedRisk: string; text: string }>("scam-messages.json").map((m) => ({ scam: m.expectedRisk !== "low", text: m.text }));
    const { recall, falsePositives } = score(rows);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(falsePositives).toBe(0);
  });

  it("held-out set", () => {
    const { recall, falsePositives } = score(load<{ scam: boolean; text: string }>("holdout-messages.json"));
    expect(recall).toBeGreaterThanOrEqual(0.7);
    expect(falsePositives).toBeLessThanOrEqual(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { OpenAIRefiner } from "../src/llm.js";

const base = { score: 0.2, risk: "low" as const, reason: "Contains link" };
const reply = (content: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => ({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }) })) as unknown as typeof fetch;
const refiner = (fetchFn: typeof fetch) => new OpenAIRefiner("key", "https://llm.example/v1", "m", fetchFn);

describe("OpenAIRefiner", () => {
  it("averages the model score with the rules score and uses its reason", async () => {
    const out = await refiner(reply({ score: 0.9, reason: "Fake airdrop" })).refine("claim now", base);
    expect(out).toEqual({ score: 0.55, risk: "medium", reason: "Fake airdrop" });
  });

  it("lifts a keyword-free scam above the flag threshold", async () => {
    const out = await refiner(reply({ score: 1, reason: "Send-and-receive scam" })).refine("send me 0.05 BTC", { score: 0, risk: "low", reason: "Looks fine" });
    expect(out.score).toBe(0.5);
    expect(out.risk).toBe("medium");
  });

  it("keeps the rules verdict when the API errors", async () => {
    expect(await refiner(reply({}, false)).refine("x", base)).toEqual(base);
    expect(await refiner(vi.fn().mockRejectedValue(new Error("net")) as unknown as typeof fetch).refine("x", base)).toEqual(base);
  });

  it("keeps the rules verdict on malformed or out-of-range output", async () => {
    expect(await refiner(reply("not json")).refine("x", base)).toEqual(base);
    expect(await refiner(reply({ score: 7, reason: "r" })).refine("x", base)).toEqual(base);
    expect(await refiner(reply({ reason: "r" })).refine("x", base)).toEqual(base);
  });

  it("truncates the reason to 60 chars and the sent text to 400", async () => {
    const fetchFn = reply({ score: 0.8, reason: "r".repeat(200) });
    const out = await refiner(fetchFn).refine("a".repeat(900), base);
    expect(out.reason).toHaveLength(60);
    const body = JSON.parse((vi.mocked(fetchFn).mock.calls[0]![1] as { body: string }).body);
    expect(body.messages[1].content).toHaveLength(400);
  });

  it("sends the key as a bearer token and never puts it in the body", async () => {
    const fetchFn = reply({ score: 0.5, reason: "r" });
    await refiner(fetchFn).refine("x", base);
    const init = vi.mocked(fetchFn).mock.calls[0]![1] as { headers: Record<string, string>; body: string };
    expect(init.headers.authorization).toBe("Bearer key");
    expect(init.body).not.toContain("key");
  });
});

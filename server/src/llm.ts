import type { Verdict } from "./types.js";
import { riskFromScore } from "./classifier.js";

export interface Refiner {
  readonly minScore: number;
  refine(text: string, base: Verdict): Promise<Verdict>;
}

export class NoopRefiner implements Refiner {
  readonly minScore = 0.35;

  async refine(_text: string, base: Verdict): Promise<Verdict> {
    return base;
  }
}

export class OpenAIRefiner implements Refiner {
  readonly minScore = 0.1;

  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async refine(text: string, base: Verdict): Promise<Verdict> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'You moderate crypto Telegram groups. Rate whether the message is a scam/spam. Reply JSON only: {"score":0..1,"reason":"<=50 chars"}.',
            },
            { role: "user", content: text.slice(0, 400) },
          ],
        }),
      });
      if (!res.ok) return base;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as { score?: number; reason?: string };
      if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 1) return base;
      const score = Math.round(((base.score + parsed.score) / 2) * 100) / 100;
      const reason = typeof parsed.reason === "string" && parsed.reason ? parsed.reason.slice(0, 60) : base.reason;
      return { score, risk: riskFromScore(score), reason };
    } catch {
      return base;
    }
  }
}

import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { parseIntent } from "./intent.js";
import { seeds } from "./seed.js";
import type { ModService } from "./service.js";
import type { Transcriber } from "./stt.js";
import type { Action } from "./types.js";

export interface AppOptions {
  service: ModService;
  pairingCode: string;
  transcriber: Transcriber | null;
  production: boolean;
}

const actions: Action[] = ["ban", "mute", "ignore"];

export function buildApp({ service, pairingCode, transcriber, production }: AppOptions) {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  app.register(cors, { origin: true, allowedHeaders: ["content-type", "x-pairing-code"] });

  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS" || req.url === "/health") return;
    const sent = Buffer.from(String(req.headers["x-pairing-code"] ?? ""));
    const expected = Buffer.from(pairingCode);
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return reply.code(401).send({ error: "bad pairing code" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Querystring: { skip?: string } }>("/queue/next", async (req, reply) => {
    const item = service.queue.next(req.query.skip ? req.query.skip.split(",") : []);
    return item ?? reply.code(204).send();
  });

  app.get("/queue/stats", async () => ({ ...service.queue.stats(), ...service.queue.shiftStats(), high: service.queue.pendingHigh() }));

  app.get<{ Querystring: { limit?: string } }>("/audit", async (req) => service.queue.auditLog(Number(req.query.limit) || 50));

  app.post<{ Params: { id: string }; Body: { action?: Action; deleteRecent?: number; muteMinutes?: number; wave?: boolean } }>(
    "/queue/:id/action",
    async (req, reply) => {
      const { action, deleteRecent, muteMinutes, wave } = req.body ?? {};
      if (!action || !actions.includes(action)) return reply.code(400).send({ error: "invalid action" });
      const request = { action, deleteRecent, muteMinutes };
      try {
        if (wave) {
          const result = await service.actWave(req.params.id, request);
          if (!result) return reply.code(404).send({ error: "not found" });
          const { undoTokens, failed } = result;
          if (!undoTokens.length) return reply.code(502).send({ error: "telegram failed", ok: false, applied: 0, failed });
          return { ok: failed === 0, applied: undoTokens.length, failed, undoToken: undoTokens[0], undoTokens };
        }
        const result = await service.act(req.params.id, request);
        if (!result) return reply.code(404).send({ error: "not found" });
        return { ok: true, undoToken: result.undoToken };
      } catch (err) {
        return reply.code(502).send({ error: "telegram failed", detail: err instanceof Error ? err.message : "unknown" });
      }
    },
  );

  app.post<{ Body: { undoToken?: string; undoTokens?: string[] } }>("/queue/undo", async (req, reply) => {
    const tokens = req.body?.undoTokens ?? (req.body?.undoToken ? [req.body.undoToken] : []);
    let ok = false;
    try {
      ok = tokens.length ? await service.undoMany(tokens) : false;
    } catch {
      return reply.code(502).send({ error: "telegram failed, try again" });
    }
    if (!ok) return reply.code(410).send({ error: "undo expired or unknown" });
    return { ok: true };
  });

  app.post<{ Body: { text?: string; itemId?: string } }>("/voice/intent", async (req, reply) => {
    const intent = parseIntent(req.body?.text ?? "");
    if (!intent) return reply.code(422).send({ error: "could not understand" });
    return intent;
  });

  app.post<{ Body: { audio?: string } }>("/voice/transcribe", async (req, reply) => {
    if (!transcriber) return reply.code(501).send({ error: "stt not configured" });
    if (!req.body?.audio) return reply.code(400).send({ error: "audio required" });
    try {
      const text = await transcriber.transcribe(Buffer.from(req.body.audio, "base64"));
      return { text };
    } catch {
      return reply.code(502).send({ error: "stt failed" });
    }
  });

  if (!production) {
    app.post("/dev/seed", async () => {
      const base = Date.now();
      seeds.forEach((s, i) =>
        service.queue.add({
          chatId: -1001000000000 - [...new Set(seeds.map((x) => x.chatTitle))].indexOf(s.chatTitle),
          chatTitle: s.chatTitle,
          userId: 7000 + i,
          username: s.username,
          text: s.text,
          messageId: 100 + i,
          offenses: s.offenses,
          risk: s.risk,
          score: s.score,
          reason: s.reason,
          flaggedAt: new Date(base - (seeds.length - i) * 60_000).toISOString(),
          demo: true,
        }),
      );
      return { added: seeds.length };
    });
  }

  return app;
}

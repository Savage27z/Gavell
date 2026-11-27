import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { parseIntent } from "./intent.js";
import { seeds } from "./seed.js";
import type { ModService } from "./service.js";
import type { Transcriber } from "./stt.js";
import type { Action } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    moderator: string;
  }
}

export interface AppOptions {
  service: ModService;
  pairingCode: string;
  /** Extra pairing codes, one per named moderator: { code: "Maya" }. */
  moderators?: Record<string, string>;
  transcriber: Transcriber | null;
  production: boolean;
  raidTest?: () => Promise<void>;
  twiml?: () => string;
}

const actions: Action[] = ["ban", "mute", "ignore"];

export function buildApp({ service, pairingCode, moderators = {}, transcriber, production, raidTest, twiml }: AppOptions) {
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  app.register(cors, { origin: true, allowedHeaders: ["content-type", "x-pairing-code"] });

  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS" || req.url === "/health" || req.url.split("?")[0] === "/twiml/raid") return;
    const viewPath = req.url.split("?")[0] === "/raids/view";
    const sent = Buffer.from(String(req.headers["x-pairing-code"] ?? (viewPath ? (req.query as { code?: string } | undefined)?.code : "") ?? ""));
    const codes: [string, string][] = [[pairingCode, "moderator"], ...Object.entries(moderators)];
    const hit = codes.find(([code]) => {
      const expected = Buffer.from(code);
      return sent.length === expected.length && timingSafeEqual(sent, expected);
    });
    if (!hit) return reply.code(401).send({ error: "bad pairing code" });
    req.moderator = hit[1];
  });

  app.get("/health", async () => ({ ok: true }));

  const gone = (id: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const by = service.handledBy(id);
    return by ? reply.code(409).send({ error: "already handled", by }) : reply.code(404).send({ error: "not found" });
  };

  const sayRaid = async (_req: unknown, reply: { type: (t: string) => { send: (b: string) => unknown } }) => reply.type("text/xml").send(twiml ? twiml() : "<Response></Response>");
  app.get("/twiml/raid", sayRaid);
  app.post("/twiml/raid", sayRaid);

  app.get<{ Querystring: { skip?: string } }>("/queue/next", async (req, reply) => {
    const away = service.touch(req.moderator);
    const skip = [...(req.query.skip ? req.query.skip.split(",") : []), ...service.lockedByOthers(req.moderator)];
    const item = service.queue.next(skip);
    if (!item) return reply.code(204).send();
    const viewedBy = service.viewedBy(item.id, req.moderator);
    service.markViewing(item.id, req.moderator);
    const nightUndo = service.nightUndo(item.id);
    return { ...item, ...(viewedBy ? { viewedBy } : {}), ...(away ? { away } : {}), ...(nightUndo ? { nightUndo } : {}) };
  });

  app.get("/queue/stats", async () => ({ ...service.queue.stats(), ...service.queue.shiftStats(), high: service.queue.pendingHigh() }));

  app.get("/moderators", async () => service.queue.moderatorStats());

  app.get("/raids", async () => service.queue.raidList().map((r) => ({ id: r.id, chatTitle: r.chatTitle, startedAt: r.startedAt, accounts: r.members.length, sample: r.sample })));

  app.get("/raids/view", async (_req, reply) => {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const blocks = service.queue.raidList().map((r) => {
      const t = service.queue.raidTimeline(r.id)!;
      const rows = t.events.map((e) => "<li><time>" + esc(e.at.slice(11, 19)) + "</time> " + esc(e.event) + (e.responseSec !== undefined ? " <i>(" + e.responseSec + "s after flagged)</i>" : "") + "</li>").join("");
      return "<section><h2>" + esc(t.chatTitle) + " - " + t.outcome.accounts + " accounts, " + t.outcome.handled + " handled, " + t.outcome.open + " open</h2><p>" + esc(t.sample) + "</p><ol>" + rows + "</ol></section>";
    });
    return reply.type("text/html").send("<!doctype html><meta charset=utf-8><title>Gavel raids</title><style>body{font:15px system-ui;max-width:720px;margin:2rem auto;padding:0 1rem}time{color:#7a4fd6;font-family:monospace}li{margin:.3rem 0}</style><h1>Raid replay</h1>" + (blocks.join("") || "<p>No raids recorded yet.</p>"));
  });

  app.get<{ Params: { id: string } }>("/raids/:id", async (req, reply) => service.queue.raidTimeline(req.params.id) ?? reply.code(404).send({ error: "not found" }));

  app.get<{ Querystring: { limit?: string } }>("/audit", async (req) => service.queue.auditLog(Number(req.query.limit) || 50));

  app.post<{ Params: { id: string }; Body: { action?: Action; deleteRecent?: number; muteMinutes?: number; wave?: boolean } }>(
    "/queue/:id/action",
    async (req, reply) => {
      const { action, deleteRecent, muteMinutes, wave } = req.body ?? {};
      if (!action || !actions.includes(action)) return reply.code(400).send({ error: "invalid action" });
      const request = { action, deleteRecent, muteMinutes };
      service.touch(req.moderator);
      try {
        if (wave) {
          const result = await service.actWave(req.params.id, request, req.moderator);
          if (!result) return gone(req.params.id, reply);
          const { undoTokens, failed } = result;
          if (!undoTokens.length) return reply.code(502).send({ error: "telegram failed", ok: false, applied: 0, failed });
          return { ok: failed === 0, applied: undoTokens.length, failed, undoToken: undoTokens[0], undoTokens };
        }
        const result = await service.act(req.params.id, request, req.moderator);
        if (!result) return gone(req.params.id, reply);
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
    app.post("/dev/raid-test", async (_req, reply) => {
      if (!raidTest) return reply.code(501).send({ error: "no alerter" });
      await raidTest();
      return { sent: true };
    });
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

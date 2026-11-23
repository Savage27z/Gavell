import { Bot } from "grammy";
import { buildApp } from "./app.js";
import { NoopRefiner, OpenAIRefiner } from "./llm.js";
import { ModQueue } from "./queue.js";
import { ModService } from "./service.js";
import { WhisperTranscriber } from "./stt.js";
import { GrammyGateway } from "./telegram.js";

const env = process.env;
if (env.NODE_ENV === "production" && !env.PAIRING_CODE) throw new Error("PAIRING_CODE is required in production");
const bot = env.TELEGRAM_BOT_TOKEN ? new Bot(env.TELEGRAM_BOT_TOKEN) : null;
const refiner = env.LLM_API_KEY
  ? new OpenAIRefiner(env.LLM_API_KEY, env.LLM_BASE_URL ?? "https://api.openai.com/v1", env.LLM_MODEL ?? "gpt-4o-mini")
  : new NoopRefiner();
const transcriber = env.STT_API_KEY
  ? new WhisperTranscriber(env.STT_API_KEY, env.STT_BASE_URL ?? "https://api.openai.com/v1", env.STT_MODEL ?? "whisper-1")
  : null;

const service = new ModService(new ModQueue(env.DATA_FILE ?? "data/queue.json"), bot ? new GrammyGateway(bot) : null, refiner);
const app = buildApp({
  service,
  pairingCode: env.PAIRING_CODE ?? "demo",
  transcriber,
  production: env.NODE_ENV === "production",
});

if (bot) {
  bot.on("message:text", async (ctx) => {
    const chat = ctx.chat;
    if (chat.type === "private" || !ctx.from || ctx.from.is_bot) return;
    await service.ingest({
      chatId: chat.id,
      chatTitle: chat.title,
      userId: ctx.from.id,
      username: ctx.from.username ?? null,
      text: ctx.message.text,
      messageId: ctx.message.message_id,
    });
  });
  bot.catch(() => {});
  void bot.start({ allowed_updates: ["message"] });
}

await app.listen({ port: Number(env.PORT ?? 8787), host: "0.0.0.0" });
console.log(`Gavel server on :${env.PORT ?? 8787} (telegram ${bot ? "on" : "off"}, llm ${env.LLM_API_KEY ? "on" : "off"}, stt ${transcriber ? "on" : "off"})`);

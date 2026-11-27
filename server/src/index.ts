import { Bot } from "grammy";
import { CompositeAlerter, OnCallRegistry, RaidWatcher, TelegramDmAlerter, TwilioCaller, type Alerter } from "./alert.js";
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

const onCall = new OnCallRegistry(env.ONCALL_FILE ?? (env.DATA_FILE ? env.DATA_FILE.replace(/[^/]*$/, "oncall.json") : "data/oncall.json"));
const parts: Alerter[] = [];
if (bot) parts.push(new TelegramDmAlerter((id, text) => bot.api.sendMessage(id, text), onCall));
let caller: TwilioCaller | undefined;
const phones = (env.ONCALL_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM && phones.length) {
  caller = new TwilioCaller(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM, phones, env.PUBLIC_URL);
  parts.push(caller);
}
const alerter = new CompositeAlerter(parts);
const watcher = new RaidWatcher(alerter, Number(env.RAID_THRESHOLD ?? 3));

const service = new ModService(new ModQueue(env.DATA_FILE ?? "data/queue.json"), bot ? new GrammyGateway(bot) : null, refiner, Date.now, watcher);
const app = buildApp({
  service,
  pairingCode: env.PAIRING_CODE ?? "demo",
  transcriber,
  production: env.NODE_ENV === "production",
  twiml: () => caller?.twiml() ?? "<Response></Response>",
  raidTest: () => alerter.notify({ chatId: 0, chatTitle: "Demo group", accounts: 4, sample: "Claim your free ARB airdrop", test: true }),
});

if (bot) {
  bot.command("oncall", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    onCall.add(ctx.from.id);
    await ctx.reply("You are on call. I will message you when 3 or more accounts post the same scam. I never act on my own. Send /off to stop.");
  });
  bot.command("off", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    await ctx.reply(onCall.remove(ctx.from.id) ? "Okay, you are off call." : "You were not on call.");
  });
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

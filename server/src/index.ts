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
const watcher = new RaidWatcher(alerter, Number(env.RAID_THRESHOLD ?? 2));

const service = new ModService(new ModQueue(env.DATA_FILE ?? "data/queue.json"), bot ? new GrammyGateway(bot) : null, refiner, Date.now, watcher);
const moderators = Object.fromEntries(
  (env.MODERATORS ?? "")
    .split(",")
    .map((pair) => pair.split(":").map((x) => x.trim()))
    .filter((p): p is [string, string] => p.length === 2 && Boolean(p[0]) && Boolean(p[1]))
    .map(([name, code]) => [code, name]),
);
const app = buildApp({
  service,
  pairingCode: env.PAIRING_CODE ?? "demo",
  moderators,
  transcriber,
  production: env.NODE_ENV === "production",
  twiml: () => caller?.twiml() ?? "<Response></Response>",
  raidTest: () => alerter.notify({ chatId: 0, chatTitle: "Demo group", accounts: 4, sample: "Claim your free ARB airdrop", test: true }),
});

if (bot) {
  for (const raw of (env.MODERATED_CHATS ?? "").split(",").map((c) => c.trim()).filter(Boolean)) {
    void bot.api.getChat(Number(raw)).then((c) => service.noteChat(c.id, "title" in c && c.title ? c.title : raw)).catch(() => {});
  }
  bot.command("oncall", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    onCall.add(ctx.from.id);
    await ctx.reply("You are on call. I will message you when 2 or more accounts post the same scam. I never act on my own. Send /off to stop.");
  });
  bot.command("off", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    await ctx.reply(onCall.remove(ctx.from.id) ? "Okay, you are off call." : "You were not on call.");
  });
  bot.command("night", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const arg = ctx.match.trim().toLowerCase();
    if (arg !== "on" && arg !== "off") {
      await ctx.reply("Night mode is off by default. /night on turns it on for the groups where you are an admin. /night off turns it off. When on, and only while no moderator has opened Gavel for 10 minutes, 3 or more accounts posting the same high-risk scam are muted for 60 minutes and their posts deleted. Never bans. You can restore them from Gavel.");
      return;
    }
    const titles = await service.setNight(ctx.from.id, arg === "on");
    await ctx.reply(titles.length ? "Night mode " + arg + " for: " + titles.join(", ") + "." : "I found no group where you are an admin.");
  });
  bot.on("message:new_chat_members", async (ctx) => {
    for (const m of ctx.message.new_chat_members) if (!m.is_bot) service.noteJoin(ctx.chat.id, m.id);
  });
  bot.on("chat_member", async (ctx) => {
    const u = ctx.chatMember;
    if (["left", "kicked"].includes(u.old_chat_member.status) && u.new_chat_member.status === "member") service.noteJoin(ctx.chat.id, u.new_chat_member.user.id);
  });
  bot.on("message:text", async (ctx) => {
    const chat = ctx.chat;
    if (!ctx.from || ctx.from.is_bot) return;
    if (chat.type === "private") {
      if (ctx.message.text.startsWith("/")) return;
      const origin = ctx.message.forward_origin;
      if (!origin) {
        await ctx.reply("Forward me a scam DM and I will send it to the moderators. Never share your seed phrase. Admins never DM first.");
        return;
      }
      const sender =
        origin.type === "user"
          ? { userId: origin.sender_user.id, username: origin.sender_user.username ?? null, name: origin.sender_user.first_name }
          : origin.type === "hidden_user"
            ? { name: origin.sender_user_name }
            : { name: origin.type === "channel" || origin.type === "chat" ? origin.type : undefined };
      const result = await service.report({ reporterId: ctx.from.id, text: ctx.message.text, sender });
      await ctx.reply(
        result.status === "queued"
          ? "Thanks, sent to the mods. Never share your seed phrase. Admins never DM first."
          : result.reason === "not-member"
            ? "I can only take reports from members of a group I moderate."
            : result.reason === "rate-limit"
              ? "That is a lot of reports at once. Please wait a few minutes."
              : "I could not read any text in that message.",
      );
      return;
    }
    service.noteChat(chat.id, chat.title);
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
  void bot.start({ allowed_updates: ["message", "chat_member"] });
}

await app.listen({ port: Number(env.PORT ?? 8787), host: "0.0.0.0" });
console.log(`Gavel server on :${env.PORT ?? 8787} (telegram ${bot ? "on" : "off"}, llm ${env.LLM_API_KEY ? "on" : "off"}, stt ${transcriber ? "on" : "off"})`);

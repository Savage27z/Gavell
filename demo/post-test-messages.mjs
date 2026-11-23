import { readFile } from "node:fs/promises";

const token = process.env.POSTER_BOT_TOKEN;
const chatId = process.env.TEST_CHAT_ID;
const delayMs = Number(process.env.DELAY_MS ?? 1500);
const only = process.env.ONLY_RISK;
const dryRun = process.argv.includes("--dry-run");

if (!dryRun && (!token || !chatId)) {
  console.error("Set POSTER_BOT_TOKEN and TEST_CHAT_ID (or pass --dry-run).");
  process.exit(1);
}

const file = new URL("./scam-messages.json", import.meta.url);
const all = JSON.parse(await readFile(file, "utf8"));
const messages = only ? all.filter((m) => m.expectedRisk === only) : all;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const m of messages) {
  if (dryRun) {
    console.log(`#${m.id} [${m.expectedRisk}] ${m.type}: ${m.text}`);
    continue;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: m.text, disable_web_page_preview: true }),
  });
  const body = await res.json();
  if (!body.ok) {
    console.error(`#${m.id} failed: ${body.description}`);
    if (body.parameters?.retry_after) await sleep(body.parameters.retry_after * 1000);
    continue;
  }
  console.log(`#${m.id} posted (message_id ${body.result.message_id})`);
  await sleep(delayMs);
}

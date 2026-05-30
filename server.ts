import "dotenv/config";
import { promises as fs } from "node:fs";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import input from "input";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH ?? "";
const session = new StringSession(process.env.TG_SESSION ?? "");

const watchChatIds = new Set(
  (process.env.WATCH_CHAT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const notifyBotToken = process.env.NOTIFY_BOT_TOKEN ?? "";
const myChatId = process.env.MY_CHAT_ID ?? "";

const keywords = (process.env.KEYWORDS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

async function notify(text: string) {
  const response = await fetch(
    `https://api.telegram.org/bot${notifyBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: myChatId,
        text,
        disable_web_page_preview: false,
      }),
    },
  );

  if (!response.ok) {
    console.error("Notify failed:", await response.text());
  }
}

async function persistSession(value: string) {
  if (!value || process.env.TG_SESSION === value) return;
  const envPath = ".env";
  let contents = "";
  try {
    contents = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }
  const next = /^TG_SESSION=.*$/m.test(contents)
    ? contents.replace(/^TG_SESSION=.*$/m, `TG_SESSION=${value}`)
    : `${contents.trimEnd()}\nTG_SESSION=${value}\n`;
  await fs.writeFile(envPath, next);
  console.log("TG_SESSION saved to .env");
}

function buildLink(event: any): string | undefined {
  const message = event.message;
  if (message?.peerId?.className !== "PeerChannel") return undefined;
  const chat = event.chat;
  if (chat?.username) return `https://t.me/${chat.username}/${message.id}`;
  const channelId = message.peerId.channelId.toString();
  return `https://t.me/c/${channelId}/${message.id}`;
}

function formatSender(event: any): string {
  const sender = event.message?.sender;
  if (!sender) return "unknown";
  if (sender.username) return `@${sender.username}`;
  const name = [sender.firstName, sender.lastName].filter(Boolean).join(" ");
  return name || sender.id?.toString() || "unknown";
}

await client.start({
  phoneNumber: async () => input.text("Phone: "),
  password: async () => input.text("2FA password: "),
  phoneCode: async () => input.text("Code: "),
  onError: (error) => console.error(error),
});

await persistSession(client.session.save() as unknown as string);

console.log("Groups & channels:");
for (const dialog of await client.getDialogs({ limit: 200 })) {
  if (!dialog.isGroup && !dialog.isChannel) continue;
  console.log(`  ${dialog.id?.toString().padEnd(16)} ${dialog.title ?? ""}`);
}

client.addEventHandler(async (event) => {
  const message = event.message;
  const text = message.message;
  if (!text) return;

  const chatId = event.chatId?.toString() ?? "";
  if (watchChatIds.size > 0 && !watchChatIds.has(chatId)) return;

  const lower = text.toLowerCase();
  const matched = keywords.filter((keyword) => lower.includes(keyword));
  if (matched.length === 0) return;

  const chatTitle = (event.chat as any)?.title ?? chatId;
  const sender = formatSender(event);
  const link = buildLink(event);

  const lines = [
    `🔔 ${matched.join(", ")}`,
    `${chatTitle} — ${sender}`,
    "",
    text,
  ];
  if (link) lines.push("", link);

  await notify(lines.join("\n"));
}, new NewMessage({}));

console.log("Watcher started.");

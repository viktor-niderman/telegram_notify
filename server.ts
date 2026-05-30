import "dotenv/config";
import { promises as fs } from "node:fs";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
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

const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 30_000);

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

const chatCache = new Map<string, { title: string; username?: string }>();

// Per-chat set of message IDs we've already processed. Shared between the
// real-time event handler and the polling loop so we never notify twice.
const seenIds = new Map<string, Set<number>>();
const initializedChats = new Set<string>();

function markSeen(chatId: string, messageId: number): boolean {
  let set = seenIds.get(chatId);
  if (!set) {
    set = new Set();
    seenIds.set(chatId, set);
  }
  if (set.has(messageId)) return false;
  set.add(messageId);
  if (set.size > 500) {
    const trimmed = [...set].slice(-500);
    set.clear();
    for (const id of trimmed) set.add(id);
  }
  return true;
}

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
    console.error(
      `[notify] failed status=${response.status}:`,
      await response.text(),
    );
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

function markedChatId(peer: any): string {
  if (!peer) return "";
  switch (peer.className) {
    case "PeerChannel":
      return `-100${peer.channelId.toString()}`;
    case "PeerChat":
      return `-${peer.chatId.toString()}`;
    case "PeerUser":
      return peer.userId.toString();
    default:
      return "";
  }
}

function buildLink(peer: any, messageId: number): string | undefined {
  if (peer?.className !== "PeerChannel") return undefined;
  const channelId = peer.channelId.toString();
  const cached = chatCache.get(`-100${channelId}`);
  if (cached?.username) return `https://t.me/${cached.username}/${messageId}`;
  return `https://t.me/c/${channelId}/${messageId}`;
}

function formatSender(sender: any): string {
  if (!sender) return "unknown";
  if (sender.username) return `@${sender.username}`;
  const name = [sender.firstName, sender.lastName].filter(Boolean).join(" ");
  return name || sender.id?.toString() || "unknown";
}

function preview(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function processMessage(
  message: any,
  chatId: string,
  source: "live" | "poll",
) {
  if (!message || message.className === "MessageEmpty") return;
  const text: string = message.message ?? "";
  if (!text) return;

  if (!markSeen(chatId, message.id)) return;

  if (watchChatIds.size > 0 && !watchChatIds.has(chatId)) return;

  const lower = text.toLowerCase();
  const matched = keywords.filter((keyword) => lower.includes(keyword));
  const chatTitle = chatCache.get(chatId)?.title ?? "(unknown)";

  console.log(
    `[${source}] chat=${chatId} "${chatTitle}" id=${message.id} text="${preview(text)}" matched=[${matched.join(", ") || "-"}]`,
  );
  if (matched.length === 0) return;

  let sender = "unknown";
  if (message.fromId) {
    try {
      const entity = await client.getEntity(message.fromId);
      sender = formatSender(entity);
    } catch {}
  }

  const link = buildLink(message.peerId, message.id);
  const lines = [
    `🔔 ${matched.join(", ")}`,
    `${chatTitle} — ${sender}`,
    "",
    text,
  ];
  if (link) lines.push("", link);

  console.log(`[notify] sending to chat_id=${myChatId} link=${link ?? "-"}`);
  await notify(lines.join("\n"));
  console.log(`[notify] sent`);
}

async function pollChat(chatId: string) {
  let entity;
  try {
    entity = await client.getInputEntity(chatId);
  } catch (error) {
    console.error(`[poll] cannot resolve chat=${chatId}:`, error);
    return;
  }

  let messages: any[];
  try {
    messages = await client.getMessages(entity, { limit: 30 });
  } catch (error) {
    console.error(`[poll] getMessages chat=${chatId} failed:`, error);
    return;
  }

  const isFirstPoll = !initializedChats.has(chatId);

  // Messages are returned newest-first; process oldest-first so logs read naturally.
  for (const message of [...messages].reverse()) {
    if (isFirstPoll) {
      // On first poll we just record IDs so we don't spam old history.
      markSeen(chatId, message.id);
      continue;
    }
    await processMessage(message, chatId, "poll");
  }

  if (isFirstPoll) {
    initializedChats.add(chatId);
    console.log(
      `[poll] chat=${chatId} initialized with ${messages.length} recent messages (no notifications sent for history)`,
    );
  }
}

async function pollAllWatchedChats() {
  if (watchChatIds.size === 0) return;
  for (const chatId of watchChatIds) {
    try {
      await pollChat(chatId);
    } catch (error) {
      console.error(`[poll] chat=${chatId} unexpected:`, error);
    }
  }
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
  const id = dialog.id?.toString() ?? "";
  const entity = dialog.entity as any;
  chatCache.set(id, {
    title: dialog.title ?? "",
    username: entity?.username,
  });
  console.log(`  ${id.padEnd(16)} ${dialog.title ?? ""}`);
}

setInterval(() => {
  console.log(`[heartbeat] connected=${client.connected}`);
}, 60_000);

// Real-time path (still useful when channel pts is in sync).
client.addEventHandler(async (update: any) => {
  if (
    update?.className !== "UpdateNewChannelMessage" &&
    update?.className !== "UpdateNewMessage"
  ) {
    return;
  }
  const message = update.message;
  const chatId = markedChatId(message?.peerId);
  try {
    await processMessage(message, chatId, "live");
  } catch (error) {
    console.error("[live] handler error:", error);
  }
});

// Polling path: works around the gramjs bug where channel updates can be
// silently dropped when the per-channel pts gets out of sync.
console.log(`Starting polling loop every ${pollIntervalMs}ms`);
await pollAllWatchedChats();
setInterval(() => {
  pollAllWatchedChats().catch((error) =>
    console.error("[poll] cycle error:", error),
  );
}, pollIntervalMs);

console.log(
  `Watcher started. watch=${
    watchChatIds.size ? [...watchChatIds].join(",") : "(all, live only)"
  } keywords=[${keywords.join(", ")}]`,
);

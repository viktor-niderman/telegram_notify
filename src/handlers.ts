import type { TelegramClient } from "telegram";
import {
  keywords,
  myChatId,
  notifyBotToken,
  watchChatIds,
} from "./config.js";
import {
  computeHash,
  hasHash,
  hasMessage,
  recordHash,
  recordMessage,
} from "./db.js";
import {
  buildLink,
  chatCache,
  formatSender,
  getSenderKey,
} from "./telegram-utils.js";

const initializedChats = new Set<string>();

async function sendNotification(text: string) {
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
      `[notify] failed status=${response.status}: ${await response.text()}`,
    );
  }
}

export async function processMessage(
  client: TelegramClient,
  message: any,
  chatId: string,
) {
  if (!message || message.className === "MessageEmpty") return;
  const text: string = message.message ?? "";
  if (!text) return;

  if (hasMessage(chatId, message.id)) return;
  if (watchChatIds.size > 0 && !watchChatIds.has(chatId)) return;

  const lower = text.toLowerCase();
  const matched = keywords.filter((keyword) => lower.includes(keyword));
  if (matched.length === 0) return;

  const senderKey = getSenderKey(message);
  const hash = computeHash(senderKey, text);

  if (hasHash(hash)) {
    recordMessage(chatId, message.id);
    return;
  }

  let senderLabel = "unknown";
  if (message.fromId) {
    try {
      const entity = await client.getEntity(message.fromId);
      senderLabel = formatSender(entity);
    } catch {}
  }

  const chatTitle = chatCache.get(chatId)?.title ?? chatId;
  const link = buildLink(message.peerId, message.id);

  const lines = [
    `🔔 ${matched.join(", ")}`,
    `${chatTitle} — ${senderLabel}`,
    "",
    text,
  ];
  if (link) lines.push("", link);

  await sendNotification(lines.join("\n"));
  recordMessage(chatId, message.id);
  recordHash(hash, senderKey);

  console.log(
    `[notify] "${chatTitle}" [${matched.join(", ")}] from ${senderLabel}`,
  );
}

async function pollChat(client: TelegramClient, chatId: string) {
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

  for (const message of [...messages].reverse()) {
    if (isFirstPoll) {
      recordMessage(chatId, message.id);
      const text = message.message ?? "";
      if (text) {
        const senderKey = getSenderKey(message);
        recordHash(computeHash(senderKey, text), senderKey);
      }
      continue;
    }
    await processMessage(client, message, chatId);
  }

  if (isFirstPoll) {
    initializedChats.add(chatId);
    const title = chatCache.get(chatId)?.title ?? chatId;
    console.log(
      `[poll] "${title}" initialized (${messages.length} history items recorded)`,
    );
  }
}

export async function pollAllWatchedChats(client: TelegramClient) {
  if (watchChatIds.size === 0) return;
  for (const chatId of watchChatIds) {
    try {
      await pollChat(client, chatId);
    } catch (error) {
      console.error(`[poll] chat=${chatId} unexpected:`, error);
    }
  }
}

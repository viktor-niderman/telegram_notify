import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

import {
  apiHash,
  apiId,
  keywords,
  pollIntervalMs,
  sessionString,
  watchChatIds,
} from "./src/config.js";
import { cleanupOldRows } from "./src/db.js";
import {
  chatCache,
  markedChatId,
  persistSession,
} from "./src/telegram-utils.js";
import { pollAllWatchedChats, processMessage } from "./src/handlers.js";

const session = new StringSession(sessionString);
const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

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

cleanupOldRows();
setInterval(cleanupOldRows, 24 * 60 * 60 * 1000);

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
    await processMessage(client, message, chatId);
  } catch (error) {
    console.error("[live] handler error:", error);
  }
});

await pollAllWatchedChats(client);
setInterval(() => {
  pollAllWatchedChats(client).catch((error) =>
    console.error("[poll] cycle error:", error),
  );
}, pollIntervalMs);

console.log(
  `Watcher started. watch=${
    watchChatIds.size ? [...watchChatIds].join(",") : "(all)"
  } keywords=[${keywords.join(", ")}]`,
);

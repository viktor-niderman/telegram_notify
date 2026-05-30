import "dotenv/config";

export const apiId = Number(process.env.TG_API_ID);
export const apiHash = process.env.TG_API_HASH ?? "";
export const sessionString = process.env.TG_SESSION ?? "";

export const watchChatIds = new Set(
  (process.env.WATCH_CHAT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export const notifyBotToken = process.env.NOTIFY_BOT_TOKEN ?? "";
export const myChatId = process.env.MY_CHAT_ID ?? "";

export const keywords = (process.env.KEYWORDS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 30_000);
export const dbPath = process.env.DB_PATH ?? "notifications.db";
export const retentionDays = Number(process.env.RETENTION_DAYS ?? 60);

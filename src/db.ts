import crypto from "node:crypto";
import Database from "better-sqlite3";
import { dbPath, retentionDays } from "./config.js";

const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS notified_messages (
    chat_id     TEXT    NOT NULL,
    message_id  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (chat_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_notified_messages_created_at
    ON notified_messages(created_at);

  CREATE TABLE IF NOT EXISTS notified_hashes (
    hash        TEXT    NOT NULL PRIMARY KEY,
    sender_id   TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notified_hashes_created_at
    ON notified_hashes(created_at);
`);

const stmtHasMessage = db.prepare(
  "SELECT 1 FROM notified_messages WHERE chat_id = ? AND message_id = ?",
);
const stmtInsertMessage = db.prepare(
  "INSERT OR IGNORE INTO notified_messages (chat_id, message_id, created_at) VALUES (?, ?, ?)",
);
const stmtHasHash = db.prepare(
  "SELECT 1 FROM notified_hashes WHERE hash = ?",
);
const stmtInsertHash = db.prepare(
  "INSERT OR IGNORE INTO notified_hashes (hash, sender_id, created_at) VALUES (?, ?, ?)",
);
const stmtCleanupMessages = db.prepare(
  "DELETE FROM notified_messages WHERE created_at < ?",
);
const stmtCleanupHashes = db.prepare(
  "DELETE FROM notified_hashes WHERE created_at < ?",
);

export function hasMessage(chatId: string, messageId: number): boolean {
  return !!stmtHasMessage.get(chatId, messageId);
}

export function hasHash(hash: string): boolean {
  return !!stmtHasHash.get(hash);
}

export function recordMessage(chatId: string, messageId: number) {
  stmtInsertMessage.run(chatId, messageId, Date.now());
}

export function recordHash(hash: string, senderId: string) {
  stmtInsertHash.run(hash, senderId, Date.now());
}

export function cleanupOldRows() {
  const cutoff = Date.now() - retentionMs;
  const m = stmtCleanupMessages.run(cutoff);
  const h = stmtCleanupHashes.run(cutoff);
  if (m.changes || h.changes) {
    console.log(
      `[cleanup] removed ${m.changes} messages, ${h.changes} hashes older than ${retentionDays}d`,
    );
  }
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function computeHash(senderId: string, text: string): string {
  return crypto
    .createHash("sha256")
    .update(`${senderId}\x00${normalizeText(text)}`)
    .digest("hex");
}

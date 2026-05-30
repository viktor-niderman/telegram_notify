# telegram_notify

Watch one or more Telegram groups/channels for messages matching a list of keywords, and forward matches to yourself via a notification bot.

The watcher signs in as a Telegram **user** (MTProto) so it can read messages in groups where you are a member. A separate **bot** is used only for delivering notifications to your private chat.

## Requirements

- Node.js 18.18+
- A Telegram account that is a member of the groups you want to monitor
- Telegram API credentials (`api_id`, `api_hash`) — get them at https://my.telegram.org → API development tools
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your own numeric chat ID (start a chat with the bot, then GET `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id`)

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
| --- | --- |
| `TG_API_ID` | API ID from my.telegram.org |
| `TG_API_HASH` | API hash from my.telegram.org |
| `TG_SESSION` | Leave empty on first run; the app saves it automatically after login |
| `WATCH_CHAT_IDS` | Comma-separated chat IDs to watch. Leave empty to watch every dialog |
| `NOTIFY_BOT_TOKEN` | Bot token from BotFather |
| `MY_CHAT_ID` | Your numeric chat ID where notifications are delivered |
| `KEYWORDS` | Comma-separated keywords (case-insensitive substring match) |
| `POLL_INTERVAL_MS` | How often watched chats are polled. Default `30000` (30 s) |
| `DB_PATH` | SQLite file path for dedup state. Default `notifications.db` |
| `RETENTION_DAYS` | How many days to keep dedup rows before pruning. Default `60` |

## First run

```bash
npm start
```

You will be prompted for your phone number, login code, and (if enabled) 2FA password. After successful login:

1. The string session is written back to `.env` as `TG_SESSION=…` so you won't have to log in again.
2. The app prints all your groups and channels with their IDs, e.g.:

   ```
   Groups & channels:
     -1001234567890   Astronomy chat
     -1009876543210   Optics marketplace
   ```

3. Copy the IDs you want to monitor into `WATCH_CHAT_IDS` (comma-separated), set `KEYWORDS`, and restart:

   ```bash
   npm start
   ```

## Notification format

```
🔔 canon, celestron
Optics marketplace — @someuser

Selling Celestron NexStar 8SE, lightly used…

https://t.me/c/9876543210/4521
```

The link points to the original message (works for supergroups and channels you are a member of).

## How it monitors

For each `WATCH_CHAT_IDS` entry the watcher uses **two paths**:

1. **Real-time** — `addEventHandler` on the user session. Reacts instantly when a `UpdateNewChannelMessage` arrives.
2. **Polling** — every `POLL_INTERVAL_MS` it calls `client.getMessages(chat, { limit: 30 })` and processes anything new.

The polling path exists because gramjs 2.26.22 does not auto-recover from per-channel pts drift — busy supergroups occasionally stop receiving push updates and the only reliable fix is to poll.

## Deduplication

A SQLite file (`DB_PATH`, default `notifications.db`) stores two tables that both paths consult before sending a notification:

- `notified_messages (chat_id, message_id, created_at)` — survives restarts; the same physical message will never trigger a second notification.
- `notified_hashes (hash, sender_id, created_at)` — hash is `sha256(senderId \x00 normalizedText)` where normalization lowercases the text and collapses whitespace. If the same sender posts the same content again (even in another chat), it is skipped.

On the first poll of a chat after startup, every recent message (~30) is recorded silently — no notifications for backlog. Rows older than `RETENTION_DAYS` (default 60) are pruned at startup and once every 24 hours.

## Running under PM2

Once you have logged in interactively (so `TG_SESSION` is filled in `.env`), you can keep the watcher running under [PM2](https://pm2.keymetrics.io/):

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 logs telegram_notify          # follow output
pm2 restart telegram_notify
pm2 save && pm2 startup           # auto-start on reboot
```

The first run cannot be under PM2 because Telegram prompts for your phone code via stdin — do `npm start` once interactively, then switch to PM2.

## Notes

- Matching is a case-insensitive substring match — `канон` will match inside `сканировать`. Tune `KEYWORDS` accordingly, or extend `server.ts` with word-boundary regex if needed.
- Message edits and pre-startup history are not scanned.
- `npm run dev` reloads on file changes.

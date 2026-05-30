import { promises as fs } from "node:fs";

export interface ChatInfo {
  title: string;
  username?: string;
}

export const chatCache = new Map<string, ChatInfo>();

export function markedChatId(peer: any): string {
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

export function buildLink(peer: any, messageId: number): string | undefined {
  if (peer?.className !== "PeerChannel") return undefined;
  const channelId = peer.channelId.toString();
  const cached = chatCache.get(`-100${channelId}`);
  if (cached?.username) return `https://t.me/${cached.username}/${messageId}`;
  return `https://t.me/c/${channelId}/${messageId}`;
}

export function formatSender(sender: any): string {
  if (!sender) return "unknown";
  if (sender.username) return `@${sender.username}`;
  const name = [sender.firstName, sender.lastName].filter(Boolean).join(" ");
  return name || sender.id?.toString() || "unknown";
}

export function getSenderKey(message: any): string {
  const from = message?.fromId;
  if (!from) {
    return `chat:${markedChatId(message?.peerId)}`;
  }
  switch (from.className) {
    case "PeerUser":
      return `u:${from.userId.toString()}`;
    case "PeerChannel":
      return `c:${from.channelId.toString()}`;
    case "PeerChat":
      return `g:${from.chatId.toString()}`;
    default:
      return "unknown";
  }
}

export async function persistSession(value: string) {
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
}

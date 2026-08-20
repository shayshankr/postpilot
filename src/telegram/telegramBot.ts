import { config } from "../config";
import { getPostsAwaitingMetrics } from "../db/posts";
import { recordManualMetrics } from "../analytics/collector";

const API_BASE = "https://api.telegram.org";

function postUrl(urn: string | null): string {
  return urn ? `https://www.linkedin.com/feed/update/${urn}/` : "(no link)";
}

async function sendMessage(text: string): Promise<void> {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    console.log("[telegram] not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing), skipping send");
    return;
  }
  const res = await fetch(`${API_BASE}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) {
    console.error("[telegram] sendMessage failed:", res.status, await res.text().catch(() => ""));
  }
}

/**
 * Sends one daily message listing every posted post that's old enough to have real
 * impression numbers but has no metrics recorded yet. A no-op (sends nothing) when the
 * queue is empty, so this never nags with a blank check-in.
 */
export async function sendDailyMetricsNudge(): Promise<void> {
  const pending = getPostsAwaitingMetrics(config.metricsNudgeMinAgeHours);
  if (pending.length === 0) {
    console.log("[telegram] no posts awaiting metrics, skipping nudge");
    return;
  }

  const lines = pending.map((p) => {
    const excerpt = p.content.slice(0, 80).replace(/\s+/g, " ").trim();
    return `#${p.id} [${p.pillar}]\n"${excerpt}..."\n${postUrl(p.linkedinPostUrn)}`;
  });

  const text =
    `📊 Metrics check-in — ${pending.length} post(s) need numbers.\n\n` +
    lines.join("\n\n") +
    `\n\nReply with one line per post: id, impressions, likes, comments, reposts (only impressions is required, rest default to 0).\n` +
    `Example:\n${pending[0].id} 240 5 2 0` +
    (pending.length > 1 ? `\n${pending[1] ? pending[1].id : pending[0].id} 90 1 0 0` : "") +
    `\n\nSkip any you don't have, they'll just get asked again tomorrow.`;

  await sendMessage(text);
}

interface ParsedLine {
  postId: number;
  impressions: number;
  likes: number;
  comments: number;
  reposts: number;
}

function parseReplyLines(text: string): ParsedLine[] {
  const results: ParsedLine[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Accepts "12 240 5 2 0", "#12 240", "12: 240 5 2 0" etc.
    const match = line.match(/^#?(\d+)[:\s]+(\d+)(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+(\d+))?/);
    if (!match) continue;
    results.push({
      postId: Number(match[1]),
      impressions: Number(match[2]),
      likes: match[3] ? Number(match[3]) : 0,
      comments: match[4] ? Number(match[4]) : 0,
      reposts: match[5] ? Number(match[5]) : 0,
    });
  }
  return results;
}

/**
 * Handles an incoming Telegram message. Only messages from the configured chat_id are
 * trusted — anything else is silently ignored so a random person who somehow messages
 * the bot can't inject fake metrics.
 */
export async function handleIncomingMessage(fromChatId: string | number, text: string): Promise<void> {
  if (!config.telegram.chatId || String(fromChatId) !== String(config.telegram.chatId)) {
    console.log(`[telegram] ignoring message from unrecognized chat_id ${fromChatId}`);
    return;
  }

  const parsed = parseReplyLines(text);
  if (parsed.length === 0) {
    await sendMessage("Didn't recognize that format. One line per post: `id impressions likes comments reposts` — e.g. `12 240 5 2 0`.");
    return;
  }

  const confirmed: string[] = [];
  for (const p of parsed) {
    recordManualMetrics(p.postId, {
      impressions: p.impressions,
      likes: p.likes,
      comments: p.comments,
      reposts: p.reposts,
    });
    confirmed.push(`#${p.postId}: ${p.impressions} impressions, ${p.likes} likes, ${p.comments} comments, ${p.reposts} reposts — saved.`);
  }
  await sendMessage(`✅ Recorded:\n${confirmed.join("\n")}`);
}

import { listPosts } from "../db/posts";
import { getLatestMetricsForPost } from "../db/metrics";
import { PostRecord } from "../types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function postCard(p: PostRecord, extra?: string): string {
  return `
    <div class="card">
      <div class="card-meta">
        <span class="pillar">${escapeHtml(p.pillar)}</span>
        <span class="time">${formatDate(p.scheduledFor)}</span>
        ${extra ?? ""}
      </div>
      <div class="content">${escapeHtml(p.content)}</div>
    </div>`;
}

export function renderDashboard(): string {
  const scheduled = listPosts("scheduled").sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const posted = listPosts("posted");
  const failed = listPosts("failed");

  const scheduledHtml = scheduled.length
    ? scheduled.map((p) => postCard(p)).join("\n")
    : `<p class="empty">Nothing queued right now.</p>`;

  const postedHtml = posted.length
    ? posted
        .map((p) => {
          const m = getLatestMetricsForPost(p.id);
          const scoreText = m?.score != null ? `score ${m.score.toFixed(0)}` : "no metrics yet";
          const urnText = p.linkedinPostUrn ? ` · <code>${escapeHtml(p.linkedinPostUrn)}</code>` : "";
          return postCard(
            { ...p, scheduledFor: p.postedAt ?? p.scheduledFor },
            `<span class="score">${scoreText}${urnText}</span>`
          );
        })
        .join("\n")
    : `<p class="empty">Nothing posted yet.</p>`;

  const failedHtml = failed.length
    ? failed
        .map((p) => postCard(p, `<span class="fail">${escapeHtml(p.failureReason ?? "unknown error")}</span>`))
        .join("\n")
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>PostPilot</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; background: #f7f7f5; color: #1a1a1a; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; margin-top: 40px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  .card { background: #fff; border: 1px solid #e2e2e0; border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
  .card-meta { display: flex; gap: 10px; align-items: center; font-size: 12px; color: #888; margin-bottom: 8px; flex-wrap: wrap; }
  .pillar { background: #eef1ff; color: #3b4fcc; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
  .time { color: #555; }
  .score { color: #0a7a3e; }
  .fail { color: #c0392b; }
  code { background: #f0f0ee; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  .content { white-space: pre-wrap; line-height: 1.5; font-size: 14px; }
  .empty { color: #888; font-size: 14px; }
  a.refresh { font-size: 12px; color: #3b4fcc; text-decoration: none; }
</style>
</head>
<body>
  <h1>PostPilot</h1>
  <a class="refresh" href="/dashboard">refresh</a>

  <h2>Scheduled (${scheduled.length})</h2>
  ${scheduledHtml}

  ${failed.length ? `<h2>Failed (${failed.length})</h2>${failedHtml}` : ""}

  <h2>Posted (${posted.length})</h2>
  ${postedHtml}
</body>
</html>`;
}

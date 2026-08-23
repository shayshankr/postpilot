import { listPosts } from "../db/posts";
import { getLatestMetricsForPost } from "../db/metrics";
import { getTokenExpiryStatus } from "../db/tokens";
import { config } from "../config";
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

function postCard(p: PostRecord, displayTime: string | null, extra: string, actions: string): string {
  return `
    <div class="card">
      <div class="card-meta">
        <span class="pillar">${escapeHtml(p.pillar)}</span>
        <span class="time">${formatDate(displayTime)}</span>
        ${extra}
      </div>
      <div class="content">${escapeHtml(p.content)}</div>
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </div>`;
}

function skipForm(id: number): string {
  return `<form method="post" action="/dashboard/posts/${id}/skip" onsubmit="return confirm('Skip this post? It will not be published.')">
    <button type="submit" class="btn btn-skip">Skip</button>
  </form>`;
}

function metricsForm(id: number): string {
  return `<form method="post" action="/dashboard/posts/${id}/metrics" class="metrics-form">
    <input type="number" name="impressions" placeholder="Impressions" min="0">
    <input type="number" name="likes" placeholder="Likes" min="0">
    <input type="number" name="comments" placeholder="Comments" min="0">
    <input type="number" name="reposts" placeholder="Reposts" min="0">
    <button type="submit" class="btn btn-save">Save metrics</button>
  </form>`;
}

export function renderDashboard(): string {
  const scheduled = listPosts("scheduled").sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const posted = listPosts("posted");
  const failed = listPosts("failed");
  const skipped = listPosts("skipped");
  const tokenStatus = getTokenExpiryStatus();

  const tokenBanner = !tokenStatus
    ? `<div class="banner banner-warn">No LinkedIn account connected. <a href="/auth/linkedin">Connect one</a> or nothing will post.</div>`
    : tokenStatus.warning
    ? `<div class="banner banner-warn">${escapeHtml(tokenStatus.warning)}</div>`
    : "";

  const scheduledHtml = scheduled.length
    ? scheduled.map((p) => postCard(p, p.scheduledFor, "", skipForm(p.id))).join("\n")
    : `<p class="empty">Nothing queued right now.</p>`;

  const postedHtml = posted.length
    ? posted
        .map((p) => {
          const m = getLatestMetricsForPost(p.id);
          const scoreText = m?.score != null ? `score ${m.score.toFixed(0)} (${m.source})` : "no metrics yet";
          const urnText = p.linkedinPostUrn ? ` · <code>${escapeHtml(p.linkedinPostUrn)}</code>` : "";
          return postCard(p, p.postedAt, `<span class="score">${scoreText}${urnText}</span>`, metricsForm(p.id));
        })
        .join("\n")
    : `<p class="empty">Nothing posted yet.</p>`;

  const failedHtml = failed.length
    ? failed.map((p) => postCard(p, p.scheduledFor, `<span class="fail">${escapeHtml(p.failureReason ?? "unknown error")}</span>`, "")).join("\n")
    : "";

  const skippedHtml = skipped.length
    ? skipped.map((p) => postCard(p, p.scheduledFor, "", "")).join("\n")
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
  .banner { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin: 14px 0; }
  .banner-warn { background: #fff4e5; border: 1px solid #f0c36d; color: #7a4a00; }
  .banner-warn a { color: #7a4a00; font-weight: 600; }
  .banner-paused { background: #fdeaea; border: 1px solid #e6a3a3; color: #8a1f1f; font-weight: 600; }
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
  .actions { margin-top: 10px; padding-top: 10px; border-top: 1px solid #f0f0ee; }
  .btn { font-size: 12px; padding: 5px 10px; border-radius: 5px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
  .btn:hover { background: #f4f4f2; }
  .btn-skip { color: #c0392b; border-color: #e6b0aa; }
  .btn-save { color: #0a7a3e; border-color: #a3d9b8; }
  .metrics-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .metrics-form input { width: 90px; padding: 4px 6px; font-size: 12px; border: 1px solid #ccc; border-radius: 4px; }
</style>
</head>
<body>
  <h1>PostPilot</h1>
  <a class="refresh" href="/dashboard">refresh</a>

  ${config.postingPaused ? `<div class="banner banner-paused">⏸ Posting is paused (POSTING_PAUSED=true). Nothing will be generated or published until this is turned back off.</div>` : ""}
  ${tokenBanner}

  <h2>Scheduled (${scheduled.length})</h2>
  ${scheduledHtml}

  ${failed.length ? `<h2>Failed (${failed.length})</h2>${failedHtml}` : ""}

  <h2>Posted (${posted.length})</h2>
  ${postedHtml}

  ${skipped.length ? `<h2>Skipped (${skipped.length})</h2>${skippedHtml}` : ""}
</body>
</html>`;
}

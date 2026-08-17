import { linkedinAdapter } from "../linkedin/linkedinAdapter";
import { getLinkedInToken } from "../db/tokens";
import { getAllPosted } from "../db/posts";
import { recordMetrics, getLatestMetricsForPost } from "../db/metrics";
import { computeScore } from "./scorer";

/**
 * Attempts an API-based metrics pull for every posted post that has none yet.
 * Currently always a no-op in practice (linkedinAdapter.fetchMetrics returns null —
 * see the comment there for why), but kept so a future Marketing Developer Platform
 * partnership can be wired in without changing anything else in this file.
 */
export async function collectApiMetrics() {
  const token = getLinkedInToken();
  if (!token) return;

  const posts = getAllPosted();
  for (const post of posts) {
    if (!post.linkedinPostUrn) continue;
    if (getLatestMetricsForPost(post.id)?.source === "api") continue;

    const fetched = await linkedinAdapter.fetchMetrics(token.accessToken, post.linkedinPostUrn);
    if (!fetched) continue;

    recordMetrics({
      postId: post.id,
      ...fetched,
      score: computeScore(fetched),
      source: "api",
    });
  }
}

/** Called by the dashboard API when the user pastes in numbers from the LinkedIn app. */
export function recordManualMetrics(postId: number, m: {
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  reposts?: number | null;
  clicks?: number | null;
}) {
  recordMetrics({
    postId,
    impressions: m.impressions ?? null,
    likes: m.likes ?? null,
    comments: m.comments ?? null,
    reposts: m.reposts ?? null,
    clicks: m.clicks ?? null,
    score: computeScore(m),
    source: "manual",
  });
}

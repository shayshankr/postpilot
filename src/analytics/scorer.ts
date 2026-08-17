/**
 * Composite 0-100 "performance score" from whatever engagement numbers are available.
 * LinkedIn's standard API doesn't expose personal-post analytics (see linkedinAdapter.ts),
 * so numbers usually arrive via manual entry rather than a live pull. Weighted toward
 * comments/reposts over passive likes since those are the stronger signal of a post
 * actually landing. Missing fields count as 0, not as unknown.
 */
export function computeScore(m: {
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  reposts?: number | null;
  clicks?: number | null;
}): number {
  const impressions = m.impressions ?? 0;
  const likes = m.likes ?? 0;
  const comments = m.comments ?? 0;
  const reposts = m.reposts ?? 0;
  const clicks = m.clicks ?? 0;

  const weightedEngagement = likes * 1 + comments * 4 + reposts * 6 + clicks * 2;

  if (impressions > 0) {
    // Engagement rate scaled to a 0-100 band; >=8% engagement rate maxes out.
    const rate = weightedEngagement / impressions;
    return Math.max(0, Math.min(100, (rate / 0.08) * 100));
  }

  // No impressions data: fall back to a raw-count curve so posts are still comparable.
  return Math.max(0, Math.min(100, Math.log2(weightedEngagement + 1) * 15));
}

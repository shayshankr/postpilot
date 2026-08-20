import { config } from "../config";
import { getPillarAverageScores } from "../db/metrics";
import { getRecentPillars } from "../db/posts";

// How many of the most-recently-created posts count as "just used" for anti-clustering
// purposes. 2 means: don't pick the same pillar as either of the last two slots unless
// there's genuinely no other option (e.g. only one pillar configured).
const ANTI_CLUSTER_WINDOW = 2;

/**
 * Picks the next content pillar to write about. Weighted toward pillars that have
 * historically scored well, but always keeps every pillar in rotation (exploration)
 * so the brain doesn't collapse onto one topic and starve the others of data.
 *
 * Also avoids clustering: a pillar used in either of the last ANTI_CLUSTER_WINDOW
 * posts is excluded from this pick when at least one other pillar is still eligible.
 * This is what stops a queue from ending up with e.g. three "career journey" posts
 * back to back purely by chance.
 */
export function pickNextPillar(): string {
  const pillars = config.contentPillars;
  const recentlyUsed = new Set(getRecentPillars(ANTI_CLUSTER_WINDOW));
  const eligible = pillars.filter((p) => !recentlyUsed.has(p));
  const pool = eligible.length > 0 ? eligible : pillars;

  const scores = getPillarAverageScores();

  if (scores.length === 0) {
    // No performance data yet: round-robin by simple rotation within the eligible pool.
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const scoreMap = new Map(scores.map((s) => [s.pillar, s.avgScore]));
  const weights = pool.map((p) => {
    const avg = scoreMap.get(p);
    // Unscored pillars get a moderate default weight so they keep getting tried.
    return avg === undefined ? 50 : Math.max(5, avg);
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

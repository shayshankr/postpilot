import { config } from "../config";
import { getPillarAverageScores } from "../db/metrics";

/**
 * Picks the next content pillar to write about. Weighted toward pillars that have
 * historically scored well, but always keeps every pillar in rotation (exploration)
 * so the brain doesn't collapse onto one topic and starve the others of data.
 */
export function pickNextPillar(): string {
  const pillars = config.contentPillars;
  const scores = getPillarAverageScores();

  if (scores.length === 0) {
    // No performance data yet: round-robin by simple rotation.
    return pillars[Math.floor(Math.random() * pillars.length)];
  }

  const scoreMap = new Map(scores.map((s) => [s.pillar, s.avgScore]));
  const weights = pillars.map((p) => {
    const avg = scoreMap.get(p);
    // Unscored pillars get a moderate default weight so they keep getting tried.
    return avg === undefined ? 50 : Math.max(5, avg);
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pillars.length; i++) {
    r -= weights[i];
    if (r <= 0) return pillars[i];
  }
  return pillars[pillars.length - 1];
}

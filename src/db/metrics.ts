import { db } from "./client";
import { PostMetrics } from "../types";

function rowToMetrics(row: any): PostMetrics {
  return {
    postId: row.post_id,
    capturedAt: row.captured_at,
    impressions: row.impressions,
    likes: row.likes,
    comments: row.comments,
    reposts: row.reposts,
    clicks: row.clicks,
    score: row.score,
    source: row.source,
  };
}

export function recordMetrics(m: {
  postId: number;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  clicks: number | null;
  score: number | null;
  source: "api" | "manual" | "estimated";
}) {
  db.prepare(
    `INSERT INTO post_metrics (post_id, impressions, likes, comments, reposts, clicks, score, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(m.postId, m.impressions, m.likes, m.comments, m.reposts, m.clicks, m.score, m.source);
}

export function getLatestMetricsForPost(postId: number): PostMetrics | undefined {
  const row = db
    .prepare(`SELECT * FROM post_metrics WHERE post_id = ? ORDER BY captured_at DESC LIMIT 1`)
    .get(postId);
  return row ? rowToMetrics(row) : undefined;
}

export function getTopPerformingPosts(limit = 5): Array<{ postId: number; content: string; pillar: string; score: number }> {
  const rows = db
    .prepare(
      `SELECT p.id as postId, p.content, p.pillar, m.score
       FROM posts p
       JOIN post_metrics m ON m.post_id = p.id
       WHERE m.score IS NOT NULL
       AND m.captured_at = (SELECT MAX(captured_at) FROM post_metrics WHERE post_id = p.id)
       ORDER BY m.score DESC
       LIMIT ?`
    )
    .all(limit) as any[];
  return rows;
}

export function getPillarAverageScores(): Array<{ pillar: string; avgScore: number; count: number }> {
  const rows = db
    .prepare(
      `SELECT p.pillar, AVG(m.score) as avgScore, COUNT(*) as count
       FROM posts p
       JOIN post_metrics m ON m.post_id = p.id
       WHERE m.score IS NOT NULL
       AND m.captured_at = (SELECT MAX(captured_at) FROM post_metrics WHERE post_id = p.id)
       GROUP BY p.pillar
       ORDER BY avgScore DESC`
    )
    .all() as any[];
  return rows;
}

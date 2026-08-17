import { db } from "./client";
import { PostRecord, PostStatus } from "../types";

function rowToPost(row: any): PostRecord {
  return {
    id: row.id,
    pillar: row.pillar,
    content: row.content,
    status: row.status,
    scheduledFor: row.scheduled_for,
    postedAt: row.posted_at,
    linkedinPostUrn: row.linkedin_post_urn,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export function createPost(params: { pillar: string; content: string; scheduledFor: string }): PostRecord {
  const stmt = db.prepare(
    `INSERT INTO posts (pillar, content, status, scheduled_for) VALUES (?, ?, 'scheduled', ?)`
  );
  const info = stmt.run(params.pillar, params.content, params.scheduledFor);
  return getPost(Number(info.lastInsertRowid))!;
}

export function getPost(id: number): PostRecord | undefined {
  const row = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
  return row ? rowToPost(row) : undefined;
}

export function countUpcomingScheduled(): number {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM posts WHERE status = 'scheduled' AND scheduled_for > datetime('now')`)
    .get() as any;
  return row.c;
}

export function getUpcomingScheduledTimes(): Set<string> {
  const rows = db
    .prepare(`SELECT scheduled_for FROM posts WHERE status = 'scheduled' AND scheduled_for > datetime('now')`)
    .all() as any[];
  return new Set(rows.map((r) => r.scheduled_for));
}

export function reschedulePost(id: number, newScheduledForIso: string) {
  db.prepare(`UPDATE posts SET scheduled_for = ? WHERE id = ?`).run(newScheduledForIso, id);
}

/** Only allowed on posts still in 'scheduled' status — a posted post's content is already live. */
export function updateScheduledPostContent(id: number, content: string): boolean {
  const info = db.prepare(`UPDATE posts SET content = ? WHERE id = ? AND status = 'scheduled'`).run(content, id);
  return info.changes > 0;
}

export function getDuePosts(nowIso: string): PostRecord[] {
  const rows = db
    .prepare(`SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for ASC`)
    .all(nowIso);
  return rows.map(rowToPost);
}

export function markPosted(id: number, urn: string, postedAtIso: string) {
  db.prepare(
    `UPDATE posts SET status = 'posted', linkedin_post_urn = ?, posted_at = ? WHERE id = ?`
  ).run(urn, postedAtIso, id);
}

export function markFailed(id: number, reason: string) {
  db.prepare(`UPDATE posts SET status = 'failed', failure_reason = ? WHERE id = ?`).run(reason, id);
}

export function getPostedInRange(startIso: string, endIso: string): PostRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM posts WHERE status = 'posted' AND posted_at >= ? AND posted_at < ? ORDER BY posted_at ASC`
    )
    .all(startIso, endIso);
  return rows.map(rowToPost);
}

export function getAllPosted(): PostRecord[] {
  const rows = db.prepare(`SELECT * FROM posts WHERE status = 'posted' ORDER BY posted_at DESC`).all();
  return rows.map(rowToPost);
}

export function getRecentPostsForContext(limit = 15): PostRecord[] {
  const rows = db
    .prepare(`SELECT * FROM posts WHERE status IN ('posted','scheduled') ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
  return rows.map(rowToPost);
}

export function listPosts(status?: PostStatus): PostRecord[] {
  const rows = status
    ? db.prepare(`SELECT * FROM posts WHERE status = ? ORDER BY scheduled_for DESC`).all(status)
    : db.prepare(`SELECT * FROM posts ORDER BY scheduled_for DESC LIMIT 100`).all();
  return rows.map(rowToPost);
}

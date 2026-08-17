import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.reportsDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pillar TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT NOT NULL,
  posted_at TEXT,
  linkedin_post_urn TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  impressions INTEGER,
  likes INTEGER,
  comments INTEGER,
  reposts INTEGER,
  clicks INTEGER,
  score REAL,
  source TEXT NOT NULL DEFAULT 'estimated'
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT NOT NULL,
  member_urn TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_for ON posts(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_metrics_post_id ON post_metrics(post_id);
`);

// Lightweight migration: add retry_count if this DB predates it. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so check pragma table_info first.
const postsColumns = db.prepare(`PRAGMA table_info(posts)`).all() as Array<{ name: string }>;
if (!postsColumns.some((c) => c.name === "retry_count")) {
  db.exec(`ALTER TABLE posts ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
}

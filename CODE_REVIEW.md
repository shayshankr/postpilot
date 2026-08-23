# Code review — 2026-08-18

A self-review pass against normal engineering standards (correctness, input validation, security hygiene, consistency) — not a review against any Eko-specific policy; this is a personal project unaffiliated with any employer's internal standards. Every source file was read fresh against the actual deployed state rather than from memory, since the codebase had drifted from earlier context (a Telegram metrics-nudge feature, prompt tuning, and a content-pillar fix had been added in between).

## Method

1. Listed every file under `src/` and read each one in full.
2. For each file, checked: does user input get validated before use; are DB writes protected against bad references; is error handling honest (fails loudly) vs silent; is behavior consistent with the rest of the codebase (e.g. does config access go through one place).
3. Anything found got triaged into "fix now" (a real bug, cheap to fix, safe to verify) vs "track, don't fix now" (a real gap, but a design decision or bigger scope than a review pass — e.g. adding auth).
4. Fixes were smoke-tested against a throwaway local SQLite database before being considered done, not just compiled.
5. Built (`npm run build`), committed, pushed, and redeployed.

## Findings and fixes

### 1. No foreign-key enforcement + no post-existence check before recording metrics

**File:** `src/db/client.ts`, `src/analytics/collector.ts`

`post_metrics.post_id` is declared `REFERENCES posts(id)` in the schema, but SQLite does not enforce foreign keys unless `PRAGMA foreign_keys = ON` is set explicitly — it wasn't. Combined with `recordManualMetrics` never checking the post actually existed, a typo'd post ID silently created an orphaned `post_metrics` row and reported success to the caller. This mattered most for the Telegram metrics-nudge flow, where a human free-types `id impressions likes comments reposts` lines by hand — a transposed digit would have looked like it worked and then vanished (never surfaced anywhere, since every downstream query joins `post_metrics` back to `posts`).

**Fix:**
- `db.pragma("foreign_keys = ON")` added as a second line of defense at the schema level.
- `recordManualMetrics` now checks `getPost(postId)` first and returns `false` (recording nothing) if it doesn't exist, instead of a boolean-less void return.
- All three callers updated to handle the new return value: the JSON API (`POST /api/posts/:id/metrics`) now returns `404` for an unknown ID instead of a false `{ ok: true }`; the Telegram bot now replies with which specific IDs weren't saved, instead of a blanket "✅ Recorded" that included silently-dropped lines.

**Verified:** smoke-tested directly (not just via the API) — `recordManualMetrics` against a real post ID returns `true` and a row is written; against a nonexistent ID it returns `false` and nothing is written. See the "Verification" section below for the exact commands.

### 2. Telegram webhook route degrades to unsafe when unconfigured

**File:** `src/server/index.ts`

The route was registered as `app.post(\`/telegram/webhook/${config.telegram.botToken}\`, ...)`. If `TELEGRAM_BOT_TOKEN` is unset (empty string), this silently becomes the route `POST /telegram/webhook/` — no secret component in the path at all. It was only saved from real exposure because `handleIncomingMessage` separately checks `chat_id` against `TELEGRAM_CHAT_ID`, which would also be unset in the same scenario — two blank configs happening to cancel each other out is not something to rely on intentionally.

**Fix:** the route is now only registered at all when `config.telegram.botToken` is truthy (`if (config.telegram.botToken) { app.post(...) }`). No token configured means no route exists, full stop.

### 3. Inconsistent input coercion between the two metrics-entry paths

**File:** `src/server/index.ts`

The dashboard's `<form>`-based metrics endpoint coerced `req.body` string values to numbers before use; the JSON API endpoint (`POST /api/posts/:id/metrics`) didn't, passing whatever the client sent straight into `computeScore`'s arithmetic — a malformed JSON payload (e.g. a string where a number was expected) would silently produce `NaN` scores rather than a clear error.

**Fix:** extracted a single `toNumOrNull()` helper and applied it identically at both call sites.

### 4. `POSTING_PAUSED` undocumented in `.env.example`

Added in the previous session's "stop all posting" change but never added to the example env file — every other setting is documented there. Added.

### 5. `CONTENT_MODEL` read directly from `process.env` in two files, bypassing `config.ts`

**Files:** `src/content/generator.ts`, `src/reports/dailyReport.ts`

Every other environment variable in the codebase is read once, in `config.ts`, and consumed from the `config` object elsewhere — this is the one setting that had two separate `process.env.CONTENT_MODEL || "claude-opus-5"` fallback expressions instead. Not a bug (both fallbacks agreed), but a real consistency gap: if the default model ever needs to change, there were two places to update instead of one, and `grep -rn process.env src/` didn't reliably find every config-like read.

**Fix:** added `config.contentModel` (same default), and both files now read `config.contentModel` instead.

## Verified, not changed

- **No authentication on any API endpoint or `/dashboard`.** Real gap, but a design decision (what auth mechanism, whether it should gate reads vs. only writes) rather than a quick fix — already tracked as a roadmap item in `ROADMAP.md`, left as-is here.
- **XSS/HTML-injection surface on the dashboard** — checked every place post content gets interpolated into the rendered HTML; all of it goes through `escapeHtml()`. No fix needed, this was already done correctly.
- **SQL injection surface** — every query uses parameterized `db.prepare(...).run(...)` / `.all(...)` calls, nowhere does user input get string-concatenated into SQL. No fix needed.

## Verification

```bash
npm run build   # clean, no errors

# Smoke test (throwaway local DB, not the production Railway volume):
ANTHROPIC_API_KEY=sk-test-placeholder npx tsx scratch-smoketest.ts
# Created post id: 1
# recordManualMetrics on REAL post -> true (expect true)
# recordManualMetrics on FAKE post 99999 -> false (expect false)
```

Then committed, pushed to `main`, and redeployed to Railway; confirmed `railway logs` showed a clean boot with no migration or startup errors against the live production database (which already held real scheduled/posted post data at the time of deploy).

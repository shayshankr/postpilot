# PostPilot

Autonomous LinkedIn posting: an AI "brain" (Claude) writes posts on a rotation of content pillars, a scheduler posts them automatically on weekdays, and a nightly job compiles a performance report and feeds what's working back into future content. Built LinkedIn-first, with an adapter interface designed to extend to other platforms later (see "Extending to more platforms / accounts" below).

## What it does

- **Writes posts** — Claude drafts posts across your configured content pillars, avoiding repeats and leaning into whatever pillar is scoring best so far. Never states a specific number (installs, users, revenue) unless it's explicitly given to it — see [BUILD_LOG.md](BUILD_LOG.md) for why that rule exists.
- **Schedules & posts automatically** — no approval step. Posts go live at the times set in `POST_TIMES` on weekdays, with no human review (this was a deliberate choice — see the note on risk below). Retries up to 3 times (spaced by the per-minute cron cadence) before giving up on a publish failure.
- **Scores performance** — a 0-100 composite score per post, and picks future topics weighted toward what's scored well.
- **Daily report** — a written digest of yesterday's posts, top performers, and per-pillar averages, at `REPORT_HOUR` each day. Also warns when the LinkedIn token is close to expiring.
- **Dashboard** — a plain read-only-plus-actions page at `/dashboard`: see everything scheduled/posted/failed/skipped, skip a queued post, or log metrics manually, all without touching the API directly.

## The one honest limitation: LinkedIn analytics

**LinkedIn does not give third-party apps API access to engagement metrics (impressions/likes/comments) for personal-profile posts.** That data is only available through LinkedIn's Community Management API, which requires a Marketing Developer Platform partnership — not something an individual developer can get approved for on request.

What this means in practice:
- The app posts fine — publishing only needs the standard `w_member_social` scope.
- It **cannot automatically pull back how a post performed.**
- `POST /api/posts/:id/metrics` lets you paste numbers you see in the LinkedIn app (impressions/likes/comments/reposts) in manually. The scoring and "what's working" logic then runs on whatever you've entered.
- If you never enter anything, the daily report still runs, but says so plainly instead of making up numbers.

If LinkedIn ever grants you Marketing API partner access, `src/linkedin/linkedinAdapter.ts` → `fetchMetrics()` is the one place to wire in a real pull — everything downstream (scoring, topic weighting, reports) already consumes whatever `fetchMetrics` returns and needs no other changes.

## Setup

### 1. Create a LinkedIn developer app

1. Go to [linkedin.com/developers/apps/new](https://www.linkedin.com/developers/apps/new) → **Create app**. (The old `developer.linkedin.com/apps` link is dead — LinkedIn moved app management under `linkedin.com/developers/apps`.)
2. Fill in the required fields (you'll need a LinkedIn Company Page to associate it with — you can create a minimal one if you don't have one).
3. Under **Products**, request access to:
   - **Sign In with LinkedIn using OpenID Connect**
   - **Share on LinkedIn**
   (Both are usually auto-approved for personal use.)
4. Under **Auth**, add an **Authorized redirect URL**. For local testing: `http://localhost:8080/auth/linkedin/callback`. For a deployed instance, use your real domain, e.g. `https://your-app.up.railway.app/auth/linkedin/callback`.
5. Copy the **Client ID** and **Client Secret** from the Auth tab.

### 2. Get a Claude API key

Get an API key from the [Anthropic Console](https://console.anthropic.com/) (`ANTHROPIC_API_KEY`).

### 3. Configure

```bash
cp .env.example .env
```

Fill in `ANTHROPIC_API_KEY`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI` (must exactly match what you registered in step 1). Adjust `CONTENT_PILLARS` and `POST_TIMES` to taste.

### 4. Run locally

```bash
npm install
npm run dev
```

Then visit `http://localhost:8080/auth/linkedin` once in a browser to connect your LinkedIn account. That's the only manual step — after that the scheduler runs on its own.

## Deploying (cloud-hosted, always-on)

Any Docker-friendly host works (Railway, Render, Fly.io). Railway example:

```bash
railway init
railway up
```

Then in the Railway dashboard:
1. Set all the env vars from `.env.example` (use your real deployed URL for `LINKEDIN_REDIRECT_URI`, and update the redirect URL in your LinkedIn app settings to match).
2. **Attach a persistent volume mounted at `/app/data`.** Without this, the SQLite database (scheduled posts, tokens, metrics) is wiped on every redeploy. This is the one step that's easy to miss and will silently lose your data.
3. Visit `https://<your-app-domain>/auth/linkedin` once to connect LinkedIn.

## LinkedIn token expiry

LinkedIn access tokens are typically valid for ~60 days and, for most apps, are **not** silently refreshable (no `offline_access` grant by default). When it expires, posts will start failing with an auth error in the logs. Re-run the `/auth/linkedin` flow to reconnect.

You don't have to watch for this manually: once the token is within 7 days of expiring, both the daily report and the `/dashboard` page show a warning banner with the exact expiry date. No warning shown means you're fine.

## Extending to more platforms / accounts

- **More platforms** (Twitter/X, etc.): implement `src/linkedin/platform.ts`'s `SocialPlatformAdapter` interface for the new platform and register it alongside `linkedinAdapter` — the scheduler, content generator, and reports don't need to change.
- **Multiple accounts**: `src/db/tokens.ts` currently keeps a single LinkedIn token (simplest thing that works for one person, one account). To support more, add an `account_id` column to `oauth_tokens` and `posts`, and thread an account selector through the scheduler's publish loop.

## Architecture

```
src/
  config.ts              env var loading
  db/                     SQLite (posts, post_metrics, oauth_tokens)
    tokens.ts              token storage + expiry-warning logic
  linkedin/
    platform.ts           generic adapter interface (for adding platforms later)
    linkedinAdapter.ts     OAuth + posting + (stubbed) metrics fetch
  content/
    generator.ts           Claude call that writes each post
    topics.ts               picks the next content pillar, weighted by past performance
  scheduler/
    scheduler.ts            cron: refill content queue, publish due posts (with retry), trigger report
  analytics/
    scorer.ts                0-100 composite score from engagement numbers
    collector.ts              API pull (currently a no-op, see limitation above) + manual entry
  reports/
    dailyReport.ts            Claude-written daily digest + token-expiry warning
  server/
    index.ts                  OAuth callback + JSON API + dashboard form actions
    dashboard.ts               server-rendered HTML view at /dashboard
```

See [ROADMAP.md](ROADMAP.md) for what's not built yet, [BUILD_LOG.md](BUILD_LOG.md) for how this was actually built and what broke along the way, and [CODE_REVIEW.md](CODE_REVIEW.md) for the most recent review pass (real bugs found and fixed: no FK enforcement on metrics writes, an unsafe Telegram route fallback, inconsistent input coercion).

## Note on autonomy

This was built with **no approval step before posting** by design choice — the AI drafts, schedules, and publishes with no human review. That's higher-risk than an approve-first flow: a bad AI-generated post goes live before anyone sees it. Two real incidents of this happened during the initial build (a scheduling bug and a fabricated statistic in generated copy — both caught by manually reading the queue before this README's autonomy note was even written; see [BUILD_LOG.md](BUILD_LOG.md) for the full account). If that ever feels wrong in practice, the smallest fix is in `src/scheduler/scheduler.ts` — hold newly generated posts at `status: 'draft'` instead of `'scheduled'`, and add an approval endpoint that flips them over. This is tracked as the top item in [ROADMAP.md](ROADMAP.md) if you'd rather build it than roll your own.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and PR expectations, and [ROADMAP.md](ROADMAP.md) for a prioritized list of what to work on.

# Roadmap

Features already built are in the [README](README.md). This is what's *not* built yet — ideas worth picking up, roughly ordered by how much value they'd add for how little they'd cost. Good first issues for contributors are marked.

## Implemented in this pass

- ✅ LinkedIn token expiry warning (daily report + dashboard banner)
- ✅ Retry with backoff on publish failure, instead of failing on the first error
- ✅ Manual metrics entry from the dashboard (was curl-only before)
- ✅ Skip/cancel a queued post from the dashboard (was DB-surgery-only before)

## Short-term (good first issues)

- **Approve-before-post mode.** Add a `POSTING_MODE=auto|approve` env var. In `approve` mode, generated posts land in a new `pending_approval` status instead of `scheduled`; the dashboard gets an Approve/Reject button per post; the scheduler only publishes from `scheduled`. This is the single biggest lever for reducing risk on an otherwise fully autonomous poster — see the "Note on autonomy" section in the README.
- **Edit-in-place on the dashboard.** The `PATCH /api/posts/:id` endpoint already exists; the dashboard just needs a textarea + save button per scheduled post instead of requiring curl.
- **Basic auth on the dashboard and API.** Everything is currently unauthenticated (fine for a single-user personal tool behind an obscure Railway URL, not fine if this gets forked and pointed at something more public). A single shared-secret header or HTTP basic auth would close this cheaply.
- **Unit tests for the pure logic.** `analytics/scorer.ts` and `content/topics.ts` are pure functions with no I/O — easy first tests. `scheduler.nextSlots`'s occupied-slot logic is the highest-value thing to cover given it's already caused one real bug (see [BUILD_LOG.md](BUILD_LOG.md)).

## Medium-term

- **A second platform adapter (Twitter/X).** The `SocialPlatformAdapter` interface in `src/linkedin/platform.ts` was built for exactly this — implement one for another platform, register it alongside `linkedinAdapter`, and the scheduler/content generator/reports layer doesn't change. Renaming the `linkedin/` folder to `platforms/` would be a reasonable companion refactor once a second adapter exists.
- **Multi-account support.** Right now `oauth_tokens` holds a single row (see `src/db/tokens.ts`). Add an `account_id` column to `oauth_tokens` and `posts`, and thread an account selector through the scheduler's publish loop and the content generator's pillar rotation (so each account can have its own pillar mix).
- **Real engagement metrics, if LinkedIn ever grants API partner access.** `linkedinAdapter.fetchMetrics()` is already the single integration point — everything downstream (scoring, topic weighting, reports) already consumes whatever it returns. See the README's "honest limitation" section for why this is stubbed today.
- **Notification on publish failure.** A Slack webhook or email when `markFailed` is called, so a broken LinkedIn token doesn't sit silently for days before someone notices the daily report says "no posts published."
- **Image/media support.** LinkedIn's `ugcPosts` API supports image attachments; the content generator would need a step to either generate or select an image (e.g. via a stock-photo API or a text-to-image model) before publishing.

## Longer-term / bigger scope

- **A/B testing content variants.** Generate two drafts for a slot, post whichever the scorer predicts will do better (needs a real prediction model, not just historical averages — probably not worth it until there's real metrics data to train on).
- **Configurable posting cadence per pillar**, instead of one global `POST_TIMES` list — e.g. post career-search content more often when actively interviewing, dial it back otherwise.
- **A proper frontend** (the current `/dashboard` is server-rendered HTML with zero JS) if the read-only page stops being enough — likely only worth it once multi-account support exists and there's more than one account's worth of state to manage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pick anything above, open an issue first if it's not already tracked, and note in the PR which item it addresses.

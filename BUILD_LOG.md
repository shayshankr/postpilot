# Build log

How PostPilot actually got built — the real timeline, the things that broke, and how long it took. Written for anyone forking this who wants to know what to expect, not as a highlight reel.

**Who built what:** the code, infra, and debugging were done by Claude (Claude Code), working turn-by-turn with the project owner (Shayshank Rathore) over chat — the owner made the product decisions (fully autonomous posting, public repo, Railway, model choice), Claude wrote the code, ran the deploys, and did the debugging. This log is written from that vantage point.

## Timeline

All times IST (UTC+5:30), from actual git commit timestamps — the only hard timestamps available. Scaffolding (package.json, DB schema, the LinkedIn adapter, content generator, scheduler, server, Dockerfile, first README) happened before the first commit, so real elapsed time from a standing start is a little longer than "first commit to last commit" below.

| Time | What happened |
|---|---|
| 18:01 | Initial commit — full scaffold: SQLite schema, LinkedIn OAuth+posting adapter, Claude-based content generator, cron scheduler, scoring, daily report, Express API, Dockerfile, README |
| 18:01–18:09 | First Railway deploy attempt fails: Railway rejects a Dockerfile with a `VOLUME` instruction |
| 18:09 | Fix pushed and redeployed — build succeeds, container crashes cleanly on missing `ANTHROPIC_API_KEY` (expected; env vars not set yet) |
| — | LinkedIn developer app creation, in the browser, by the project owner: hit a stale portal URL, a taken Company Page slug, a required logo/privacy-policy field, an OAuth `redirect_uri` mismatch, and a missing OAuth product — see **Issues** below for each |
| 18:34–18:37 | Fixes pushed for the stale portal URL and a generated privacy policy page, to unblock the app-creation flow above |
| — | LinkedIn OAuth completed successfully; account connected |
| — | First content-generation attempt fails silently: Anthropic account had a zero credit balance. Caught by checking `railway logs`, not by any error surfaced to the user up front |
| 22:47–22:54 | Switched default model to Haiku 4.5 for cost, added a manual queue-refill endpoint so the fix could be verified immediately instead of waiting for the next scheduled cron run |
| 22:57–23:06 | Found and fixed a real scheduling bug (double-booked time slots — see Issues), added an endpoint to edit already-generated post content |
| 23:10 | Found and fixed a real content-quality bug (a fabricated "500 installs" statistic in generated copy — see Issues) |
| 23:46 | Added the read-only `/dashboard` page |
| (next session) | Feature batch: token-expiry warnings, publish retry logic, dashboard actions (skip/metrics forms), CONTRIBUTING.md, this file |

**Turnaround, start to a live, autonomously-posting system with a connected LinkedIn account:** about 5 hours 45 minutes from first commit to the dashboard landing — most of it spent on the LinkedIn app-creation friction and the two real bugs below, not on the core app logic, which worked close to first-try.

## Issues faced

Roughly in the order they were hit, not by severity.

1. **Railway rejects `VOLUME` in a Dockerfile.** Standard Docker syntax; Railway wants persistent storage attached as its own Volume resource instead, separate from the image. First deploy failed on this immediately.
2. **Stale LinkedIn developer portal URL.** The README pointed at `developer.linkedin.com/apps`, which 404s — LinkedIn moved app management to `linkedin.com/developers/apps` at some point after that URL was learned. Found and fixed via a live web search, not from memory.
3. **LinkedIn Company Page slug collision.** The obvious slug (`postpilot`) was already taken by an unrelated page; had to pick an alternate (`postpilot-app`).
4. **LinkedIn app creation requires a logo and a privacy policy URL** that a brand-new personal-automation app doesn't have by default. Solved by generating a logo image and writing and publishing an actual privacy policy (`PRIVACY.md`, committed to this repo) rather than filling in placeholder junk.
5. **OAuth `redirect_uri` mismatch.** The value registered in LinkedIn's Auth tab didn't exactly match what the app was sending — diagnosed by printing the app's actual generated authorization URL and comparing it character-for-character against what was registered.
6. **`unauthorized_scope_error` for the `openid` scope.** The app was requesting `openid profile w_member_social`, but only "Share on LinkedIn" had been added as a product — "Sign In with LinkedIn using OpenID Connect" also had to be added before the `openid`/`profile` scopes were authorized.
7. **Silent Anthropic billing failure.** The account had a zero credit balance. The scheduler's own error handling swallowed the failure per-post and logged it, rather than surfacing it anywhere visible — the queue just stayed empty with no obvious signal why until `railway logs` was checked directly. (Worth revisiting: see the "notification on publish failure" item in ROADMAP.md — the same gap exists for publish failures, not just generation failures.)
8. **A real scheduling bug: double-booked time slots.** The slot-picking function (`nextSlots`) computed the next available posting times from scratch on every call, without checking which slots already had a post scheduled in the database. Multiple Railway restarts in a short window (each restart runs a boot-time queue refill) picked the same "next available" slots repeatedly, so several time slots ended up with two different posts scheduled for the exact same minute. Left alone, the publisher would have posted both to LinkedIn back to back. Caught by reviewing the generated queue by hand, not by any automated check. Fixed by tracking occupied timestamps and skipping them; a one-time repair function moved the duplicates to genuinely free slots without discarding the already-generated (already-paid-for) content.
9. **A real content-quality bug: a fabricated statistic.** The content generator, with no factual grounding for a "how's the new extension doing" post, invented a plausible-sounding "500 installs" figure for an extension that had just gone live with zero real installs or ratings. Caught by manually reading the generated queue before anything published — this system posts with **no human approval step by design**, so nothing else would have caught it. Fixed two ways: the specific posts were rewritten with the real, verified status (checked directly against the Chrome Web Store listing), and the content generator's system prompt now explicitly forbids stating any specific number (installs, users, revenue, ratings) unless it's given verbatim in the prompt.
10. **Windows/Git Bash friction, unrelated to the app itself:** `git push` hung indefinitely on Windows' Git Credential Manager with no interactive terminal available for it to prompt in — worked around with `gh auth setup-git` to make git use the already-authenticated `gh` CLI credential instead. Git Bash's automatic POSIX-path-to-Windows-path conversion silently mangled a literal `/app/data` argument passed to the Railway CLI — worked around with `MSYS_NO_PATHCONV=1`. Inline shell string escaping mangled an em dash and forced dropping apostrophes from post content passed via `curl -d` — fixed by writing the JSON payload to a file and using `--data-binary @file` instead of inlining it.

## What this suggests for anyone extending it

- **The two real bugs (double-booking, fabricated stats) were both caught by a human reading output, not by any test or automated check.** There is currently no test suite (see ROADMAP.md) and no approval gate on publishing (see the README's "Note on autonomy"). Anyone running this for real, especially in fully-autonomous mode, should assume the same class of bug can recur and budget time to actually read what's queued periodically — or better, pick up the approve-before-post roadmap item.
- **Failures fail quietly by default.** Both the billing issue and the scheduling bug were invisible until someone went looking in logs or read the queue by hand. The "notification on publish failure" and general observability items in ROADMAP.md are the direct fix for this pattern.
- **Most of the elapsed time was LinkedIn's app-approval flow, not the code.** If you're setting this up fresh, budget time for the Company Page / logo / privacy-policy / redirect-URL / OAuth-product chain above — the core application logic (scheduler, generator, scorer, dashboard) came together fast by comparison.

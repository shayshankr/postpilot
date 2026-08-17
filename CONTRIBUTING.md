# Contributing

PostPilot started as a single-person tool (see [BUILD_LOG.md](BUILD_LOG.md) for how and why), but the architecture is generic enough that it's worth opening up. If you're looking for something to work on, [ROADMAP.md](ROADMAP.md) has a prioritized list — items marked "good first issue" are a reasonable place to start.

## Before you start

- **Open an issue first** for anything beyond a small fix, so we don't duplicate work or build something that doesn't fit the direction of the project.
- **Keep the platform-adapter boundary intact.** `src/linkedin/platform.ts` defines `SocialPlatformAdapter` — the scheduler, content generator, and reports layer only talk to that interface, never to LinkedIn specifics directly. If you're adding a second platform, implement the interface rather than special-casing it elsewhere.
- **No secrets in commits.** `.env` is gitignored for a reason — double check `git diff` before committing if you've been testing locally with real credentials.

## Local setup

See the [README](README.md#setup) for the full walkthrough (LinkedIn app, Anthropic key, env vars). Once configured:

```bash
npm install
npm run dev       # tsx watch, restarts on file change
npm run build      # tsc — run this before opening a PR, it's the only current correctness check
```

There's no test suite yet (see ROADMAP.md) — `npm run build` passing is currently the bar. If you're adding logic to a pure function (`analytics/scorer.ts`, `content/topics.ts`, `scheduler.nextSlots`), consider adding the project's first tests alongside your change rather than waiting for someone else to set up a test runner.

## Making a change

1. Fork, branch, make the change.
2. `npm run build` — must pass cleanly.
3. If you touched the DB schema (`src/db/client.ts`), make sure existing databases still open without error — see the `retry_count` migration in that file for the pattern (guard with `PRAGMA table_info` before `ALTER TABLE`, since SQLite has no `ADD COLUMN IF NOT EXISTS`).
4. If you touched the scheduler or content generator, sanity-check against a real (or throwaway) Anthropic API key and LinkedIn dev app before opening the PR — this code posts to a real social platform on a schedule, and a bug here is a bug that publishes something.
5. Open a PR describing what changed and why. Reference the issue it addresses.

## Reporting a bug

Open an issue with:
- What you expected vs. what happened
- Relevant log output (`railway logs` if you're running on Railway) — redact anything that looks like a token
- Whether it's reproducible or a one-off

## Code style

No linter is configured yet. Match what's already there: TypeScript strict mode, no unnecessary abstraction, comments only where the *why* isn't obvious from the code itself.

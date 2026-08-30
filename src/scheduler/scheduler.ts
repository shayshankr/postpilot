import cron from "node-cron";
import { config } from "../config";
import { generatePost } from "../content/generator";
import {
  createPost,
  countUpcomingScheduled,
  getUpcomingScheduledTimes,
  getDuePosts,
  markPosted,
  markFailed,
  recordPublishAttemptFailure,
  listPosts,
  reschedulePost,
} from "../db/posts";
import { linkedinAdapter } from "../linkedin/linkedinAdapter";
import { getLinkedInToken } from "../db/tokens";
import { compileDailyReport } from "../reports/dailyReport";
import { sendDailyMetricsNudge } from "../telegram/telegramBot";

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

// occupied holds ISO timestamps already claimed by a scheduled post (mutated as slots
// are handed out within a single call, so callers generating many slots at once never
// collide with each other either).
function nextSlots(count: number, occupied: Set<string>): Date[] {
  const slots: Date[] = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);

  for (let daysOut = 0; slots.length < count && daysOut < 60; daysOut++) {
    const day = new Date(cursor);
    day.setDate(day.getDate() + daysOut);
    if (!isWeekday(day)) continue;

    for (const time of config.postTimes) {
      const [hh, mm] = time.split(":").map(Number);
      const slot = new Date(day);
      slot.setHours(hh, mm, 0, 0);
      if (slot.getTime() <= Date.now()) continue;
      const iso = slot.toISOString();
      if (occupied.has(iso)) continue;
      occupied.add(iso);
      slots.push(slot);
      if (slots.length >= count) break;
    }
  }
  return slots;
}

// Re-entrancy guards for refillContentQueue/publishDuePosts. Without these, two
// overlapping calls (the per-minute cron tick firing again before a slow previous run
// finishes, or the boot-time refill overlapping a same-minute cron fire or a manual
// POST /api/scheduler/refill) each read the DB's "currently occupied" state before
// either has written its new rows, so both can pick and commit the exact same slot —
// this is the same double-booking failure mode as BUILD_LOG.md issue 8 (there caused by
// back-to-back Railway restarts), just reachable again through true concurrency instead
// of restart timing. For publishDuePosts specifically, an overlap can also mean the same
// due post gets published to LinkedIn twice before the first call's markPosted() lands.
let refillInProgress = false;
let publishInProgress = false;

export async function refillContentQueue(): Promise<{ attempted: number; queued: number; errors: string[] }> {
  if (config.postingPaused) {
    console.log("[scheduler] POSTING_PAUSED is true — skipping content generation");
    return { attempted: 0, queued: 0, errors: [] };
  }
  if (refillInProgress) {
    console.log("[scheduler] refillContentQueue already running — skipping overlapping call");
    return { attempted: 0, queued: 0, errors: [] };
  }

  refillInProgress = true;
  try {
    const desired = config.scheduleLookaheadDays * config.postTimes.length;
    const have = countUpcomingScheduled();
    const need = desired - have;
    if (need <= 0) return { attempted: 0, queued: 0, errors: [] };

    const slots = nextSlots(need, getUpcomingScheduledTimes());
    console.log(`[scheduler] refilling content queue: generating ${slots.length} post(s)`);

    let queued = 0;
    const errors: string[] = [];
    for (const slot of slots) {
      try {
        const { pillar, content } = await generatePost();
        createPost({ pillar, content, scheduledFor: slot.toISOString() });
        console.log(`[scheduler] queued post for ${slot.toISOString()} (pillar: ${pillar})`);
        queued++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[scheduler] content generation failed:", err);
        errors.push(message);
      }
    }
    return { attempted: slots.length, queued, errors };
  } finally {
    refillInProgress = false;
  }
}

/**
 * Fixes slots double-booked by the pre-fix version of nextSlots (which didn't check
 * for already-scheduled posts). For each timestamp with more than one scheduled post,
 * keeps the oldest and moves the rest to the next free slot. Idempotent — a no-op once
 * the queue is clean.
 */
export function dedupeScheduledSlots(): { moved: Array<{ id: number; from: string; to: string }> } {
  const scheduled = listPosts("scheduled").sort((a, b) => a.id - b.id);
  const occupied = new Set(scheduled.map((p) => p.scheduledFor));
  const seen = new Set<string>();
  const moved: Array<{ id: number; from: string; to: string }> = [];

  for (const post of scheduled) {
    if (!seen.has(post.scheduledFor)) {
      seen.add(post.scheduledFor);
      continue;
    }
    const [newSlot] = nextSlots(1, occupied);
    if (!newSlot) continue;
    const newIso = newSlot.toISOString();
    reschedulePost(post.id, newIso);
    moved.push({ id: post.id, from: post.scheduledFor, to: newIso });
  }
  return { moved };
}

// A failed publish isn't given up on immediately — the post stays 'scheduled' and the
// next minute's cron tick tries again, up to this many attempts. This piggybacks on the
// existing per-minute cron as the retry cadence instead of blocking with an in-process
// sleep, so a transient LinkedIn API blip (rate limit, momentary 5xx) doesn't need a
// human to notice and manually retry.
const MAX_PUBLISH_ATTEMPTS = 3;

async function publishDuePosts() {
  if (config.postingPaused) return;
  if (publishInProgress) {
    console.log("[scheduler] publishDuePosts already running — skipping overlapping tick");
    return;
  }

  publishInProgress = true;
  try {
    const due = getDuePosts(new Date().toISOString());
    if (due.length === 0) return;

    const token = getLinkedInToken();
    if (!token) {
      console.error(`[scheduler] ${due.length} post(s) due but no LinkedIn account is connected. Visit /auth/linkedin to connect.`);
      return;
    }

    for (const post of due) {
      try {
        const result = await linkedinAdapter.publishPost(token.accessToken, token.memberUrn, post.content);
        markPosted(post.id, result.externalId, new Date().toISOString());
        console.log(`[scheduler] published post #${post.id} -> ${result.externalId}`);
      } catch (err: any) {
        const message = err?.message ?? String(err);
        const attempts = recordPublishAttemptFailure(post.id, message);
        if (attempts >= MAX_PUBLISH_ATTEMPTS) {
          markFailed(post.id, `${message} (gave up after ${attempts} attempts)`);
          console.error(`[scheduler] post #${post.id} failed permanently after ${attempts} attempts:`, message);
        } else {
          console.error(`[scheduler] post #${post.id} attempt ${attempts}/${MAX_PUBLISH_ATTEMPTS} failed, will retry next minute:`, message);
        }
      }
    }
  } finally {
    publishInProgress = false;
  }
}

export function startScheduler() {
  // Refill the content queue once a day, and once at boot so a fresh install isn't empty.
  cron.schedule(`0 ${config.contentGenHour} * * *`, refillContentQueue);
  refillContentQueue();

  // Check for due posts every minute.
  cron.schedule("* * * * *", publishDuePosts);

  // Compile the daily performance report.
  cron.schedule(`0 ${config.reportHour} * * *`, () => compileDailyReport());

  // Ask (via Telegram) for real numbers on posts old enough to have them but not yet recorded.
  cron.schedule(`0 ${config.metricsNudgeHour} * * *`, () => sendDailyMetricsNudge());

  console.log("[scheduler] started");
}

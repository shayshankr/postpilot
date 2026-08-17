import cron from "node-cron";
import { config } from "../config";
import { generatePost } from "../content/generator";
import { createPost, countUpcomingScheduled, getDuePosts, markPosted, markFailed } from "../db/posts";
import { linkedinAdapter } from "../linkedin/linkedinAdapter";
import { getLinkedInToken } from "../db/tokens";
import { compileDailyReport } from "../reports/dailyReport";

function isWeekday(d: Date): boolean {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function nextSlots(count: number): Date[] {
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
      slots.push(slot);
      if (slots.length >= count) break;
    }
  }
  return slots;
}

export async function refillContentQueue(): Promise<{ attempted: number; queued: number; errors: string[] }> {
  const desired = config.scheduleLookaheadDays * config.postTimes.length;
  const have = countUpcomingScheduled();
  const need = desired - have;
  if (need <= 0) return { attempted: 0, queued: 0, errors: [] };

  const slots = nextSlots(need);
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
}

async function publishDuePosts() {
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
      markFailed(post.id, err?.message ?? String(err));
      console.error(`[scheduler] failed to publish post #${post.id}:`, err?.message ?? err);
    }
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

  console.log("[scheduler] started");
}

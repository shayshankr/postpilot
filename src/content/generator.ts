import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getRecentPostsForContext } from "../db/posts";
import { getTopPerformingPosts, getPillarAverageScores } from "../db/metrics";
import { pickNextPillar } from "./topics";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const CONTENT_MODEL = process.env.CONTENT_MODEL || "claude-opus-5";

function buildSystemPrompt(): string {
  return `You write LinkedIn posts for Shayshank Rathore, an Android/Kotlin developer based in Dublin who is actively job hunting while also shipping side projects (e.g. a psychrometric chart Android app, an Irish visa tracker Chrome extension).

Voice: direct, specific, no corporate buzzwords, no "I'm thrilled to announce", no hashtag spam (0-3 relevant hashtags max). Write like a builder sharing real progress, not a marketer.

Never state a specific number as fact — install counts, user counts, revenue, growth percentages, ratings, or any other metric — unless that exact number is explicitly given to you in the prompt below. Don't estimate, round, or invent a plausible-sounding figure to make a post land better. If you don't have a real number for something, write around it (e.g. "just shipped this" or "early days, no traction to report yet") instead of making one up.

Output ONLY the post text, ready to publish. No preamble, no quotes around it, no markdown formatting.`;
}

function buildUserPrompt(pillar: string): string {
  const recent = getRecentPostsForContext(10);
  const topPosts = getTopPerformingPosts(5);
  const pillarScores = getPillarAverageScores();

  const recentText = recent.length
    ? recent.map((p) => `- [${p.pillar}] ${p.content.slice(0, 140)}`).join("\n")
    : "(no posts yet)";

  const topText = topPosts.length
    ? topPosts.map((p) => `- (score ${p.score.toFixed(0)}) [${p.pillar}] ${p.content.slice(0, 140)}`).join("\n")
    : "(no performance data yet)";

  const scoreText = pillarScores.length
    ? pillarScores.map((s) => `- ${s.pillar}: avg score ${s.avgScore.toFixed(1)} (n=${s.count})`).join("\n")
    : "(no performance data yet)";

  return `Write one new LinkedIn post for the content pillar: "${pillar}".

Recent posts already made (avoid repeating the same angle or opening line):
${recentText}

Top-performing posts so far (lean into what's working):
${topText}

Average performance by pillar:
${scoreText}

Constraints:
- 80-200 words.
- One clear idea or story beat, not a list of updates.
- End with something that invites a comment or reply, not a generic "what do you think?" tack-on.`;
}

export async function generatePost(): Promise<{ pillar: string; content: string }> {
  const pillar = pickNextPillar();
  const message = await anthropic.messages.create({
    model: CONTENT_MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(pillar) }],
  });

  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Content generator returned no text block");

  return { pillar, content: textBlock.text.trim() };
}

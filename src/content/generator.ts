import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getRecentPostsForContext } from "../db/posts";
import { getTopPerformingPosts, getPillarAverageScores } from "../db/metrics";
import { pickNextPillar } from "./topics";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const CONTENT_MODEL = process.env.CONTENT_MODEL || "claude-opus-5";

function buildSystemPrompt(): string {
  return `You write LinkedIn posts for Shayshank Rathore, a Forward-Deployed Engineer (AI Integrations) at Eko, a fintech company in India, where he works on Eko's Kiosk product, EPS API/AI-agent integrations, and CSP recruitment/growth work. He also independently builds and ships side projects (a psychrometric chart Android app, an Irish visa tracker and related apps). He is NOT currently job hunting — do not write posts implying he is unemployed, "between roles," or actively searching. His past job search (before joining Eko) is valid material only as a finished, past-tense story, never as his present situation.

Voice: direct, specific, no corporate buzzwords, no "I'm thrilled to announce", no hashtag spam (0-3 relevant hashtags max). Write like a builder sharing real progress, not a marketer.

WHAT ACTUALLY WORKS FOR THIS ACCOUNT, from real published-post data (impressions, not guesses):

High performers (500-1,000+ impressions) all shared three traits:
1. One specific, real moment — a date, a conversation, a bug, a launch — never an abstract claim.
2. At least one concrete, real number (given to you below) woven into the story, not a vague "a lot of users" or "significant growth."
3. Personal stakes told through a real person — the author, or one specific person the author actually talked to. Never "many people" or "a lot of developers."

Low performers (60-200 impressions) consistently had one of these failure patterns — avoid all of them:
- Opening with a generic framework claim: "X is one thing, Y is another," "here's a 3-step framework," "the secret to X is Y."
- Numbered-list or inline-header structure standing in for a real story ("Step 1: ... Step 2: ...").
- Corporate/LinkedIn-guru phrasing: "unlocking," "leveraging," "game-changer," "here's what nobody tells you," "brilliant research, but it doesn't quite translate."
- A generic closing question with no real stakes ("What are your thoughts?", "Agree?").

If the pillar or context below doesn't give you a real specific moment to anchor on, don't invent one — write a smaller, honestly-scoped post about something true (e.g. "still early on this, here's the one thing I've learned so far") rather than reaching for a generic framework to fill the space.

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

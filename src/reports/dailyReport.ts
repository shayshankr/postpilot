import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getPostedInRange } from "../db/posts";
import { getLatestMetricsForPost, getTopPerformingPosts, getPillarAverageScores } from "../db/metrics";
import { collectApiMetrics } from "../analytics/collector";
import { getTokenExpiryStatus } from "../db/tokens";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
const REPORT_MODEL = process.env.CONTENT_MODEL || "claude-opus-5";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function compileDailyReport(forDate: Date = new Date()): Promise<string> {
  await collectApiMetrics();

  const end = startOfDay(forDate);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);

  const posted = getPostedInRange(start.toISOString(), end.toISOString());
  const rows = posted.map((p) => ({
    post: p,
    metrics: getLatestMetricsForPost(p.id),
  }));

  const topPosts = getTopPerformingPosts(3);
  const pillarScores = getPillarAverageScores();

  const hasAnyRealMetrics = rows.some((r) => r.metrics && r.metrics.source !== "estimated");

  const summaryInput = rows
    .map((r) => {
      const m = r.metrics;
      const scoreText = m?.score != null ? `score ${m.score.toFixed(0)}` : "no metrics recorded yet";
      return `- [${r.post.pillar}] (${scoreText}) ${r.post.content.slice(0, 160)}`;
    })
    .join("\n") || "(no posts published in this window)";

  const topText = topPosts.length
    ? topPosts.map((p) => `- score ${p.score.toFixed(0)}: [${p.pillar}] ${p.content.slice(0, 120)}`).join("\n")
    : "(not enough data yet)";

  const pillarText = pillarScores.length
    ? pillarScores.map((s) => `- ${s.pillar}: avg ${s.avgScore.toFixed(1)} (n=${s.count})`).join("\n")
    : "(not enough data yet)";

  const metricsNote = hasAnyRealMetrics
    ? ""
    : "\nNote: LinkedIn does not expose engagement metrics (impressions/likes/comments) for personal-profile posts through its standard API. Scores below are placeholders until numbers are entered manually via the dashboard, or omitted entirely.";

  let narrative: string;
  try {
    const message = await anthropic.messages.create({
      model: REPORT_MODEL,
      max_tokens: 512,
      system:
        "You write a short, blunt daily performance digest for one person's LinkedIn posting automation. No fluff, no 'great job today!' cheerleading. State what happened and what it implies for tomorrow's content mix.",
      messages: [
        {
          role: "user",
          content: `Yesterday's posts:\n${summaryInput}\n\nAll-time top performers:\n${topText}\n\nAverage score by content pillar:\n${pillarText}${metricsNote}\n\nWrite a 4-8 sentence daily report.`,
        },
      ],
    });
    const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    narrative = textBlock?.text.trim() ?? "(report generation returned no text)";
  } catch (err) {
    narrative = `(report narrative generation failed: ${err instanceof Error ? err.message : String(err)})`;
  }

  const tokenStatus = getTokenExpiryStatus();
  const tokenWarningBlock = tokenStatus?.warning ? [`⚠️ ${tokenStatus.warning}`, ""] : [];

  const report = [
    `# Daily LinkedIn Report — ${end.toISOString().slice(0, 10)}`,
    "",
    ...tokenWarningBlock,
    narrative,
    "",
    "## Posts in this window",
    summaryInput,
    "",
    "## All-time top performers",
    topText,
    "",
    "## Average score by pillar",
    pillarText,
  ].join("\n");

  if (config.reportChannel === "console") {
    console.log(report);
  } else {
    fs.mkdirSync(config.reportsDir, { recursive: true });
    const filePath = path.join(config.reportsDir, `${end.toISOString().slice(0, 10)}.md`);
    fs.writeFileSync(filePath, report, "utf-8");
    console.log(`[report] wrote ${filePath}`);
  }

  return report;
}

import express from "express";
import crypto from "crypto";
import { config } from "../config";
import { linkedinAdapter } from "../linkedin/linkedinAdapter";
import { saveLinkedInToken, getLinkedInToken } from "../db/tokens";
import { listPosts } from "../db/posts";
import { getLatestMetricsForPost } from "../db/metrics";
import { recordManualMetrics } from "../analytics/collector";
import { compileDailyReport } from "../reports/dailyReport";
import { refillContentQueue, dedupeScheduledSlots } from "../scheduler/scheduler";

const pendingStates = new Set<string>();

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    const token = getLinkedInToken();
    res.json({
      status: "ok",
      linkedinConnected: !!token,
      linkedinTokenExpiresAt: token?.expiresAt ?? null,
    });
  });

  // Step 1: kick off LinkedIn OAuth. Visit this in a browser once to connect the account.
  app.get("/auth/linkedin", (_req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    pendingStates.add(state);
    res.redirect(linkedinAdapter.getAuthUrl(state));
  });

  // Step 2: LinkedIn redirects here with a code.
  app.get("/auth/linkedin/callback", async (req, res) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      res.status(400).send(`LinkedIn auth failed: ${error} - ${error_description ?? ""}`);
      return;
    }
    if (!state || !pendingStates.has(state)) {
      res.status(400).send("Invalid or expired state parameter.");
      return;
    }
    pendingStates.delete(state);

    try {
      const token = await linkedinAdapter.exchangeCodeForToken(code);
      saveLinkedInToken({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        memberUrn: token.accountUrn,
      });
      res.send(
        `LinkedIn connected. Access token expires ${token.expiresAt}. You can close this tab — the scheduler will start posting automatically.`
      );
    } catch (err: any) {
      res.status(500).send(`Token exchange failed: ${err?.message ?? err}`);
    }
  });

  app.get("/api/posts", (req, res) => {
    const status = req.query.status as any;
    const posts = listPosts(status);
    res.json(posts.map((p) => ({ ...p, metrics: getLatestMetricsForPost(p.id) ?? null })));
  });

  app.post("/api/posts/:id/metrics", (req, res) => {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    const { impressions, likes, comments, reposts, clicks } = req.body ?? {};
    recordManualMetrics(postId, { impressions, likes, comments, reposts, clicks });
    res.json({ ok: true, metrics: getLatestMetricsForPost(postId) });
  });

  app.post("/api/scheduler/refill", async (_req, res) => {
    try {
      const result = await refillContentQueue();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  app.post("/api/scheduler/dedupe", (_req, res) => {
    const result = dedupeScheduledSlots();
    res.json({ ok: true, ...result });
  });

  app.post("/api/reports/run", async (_req, res) => {
    try {
      const report = await compileDailyReport();
      res.json({ ok: true, report });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  return app;
}

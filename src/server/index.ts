import express from "express";
import crypto from "crypto";
import { config } from "../config";
import { linkedinAdapter } from "../linkedin/linkedinAdapter";
import { saveLinkedInToken, getLinkedInToken } from "../db/tokens";
import { listPosts, updateScheduledPostContent, skipPost } from "../db/posts";
import { getLatestMetricsForPost } from "../db/metrics";
import { recordManualMetrics } from "../analytics/collector";
import { compileDailyReport } from "../reports/dailyReport";
import { refillContentQueue, dedupeScheduledSlots } from "../scheduler/scheduler";
import { renderDashboard } from "./dashboard";
import { handleIncomingMessage } from "../telegram/telegramBot";

const pendingStates = new Set<string>();

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // for plain HTML <form> posts from /dashboard

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

  app.get("/dashboard", (_req, res) => {
    res.type("html").send(renderDashboard());
  });

  // Plain <form>-friendly versions of the JSON API below, for the /dashboard page —
  // these redirect back to /dashboard instead of returning JSON.
  app.post("/dashboard/posts/:id/skip", (req, res) => {
    const postId = Number(req.params.id);
    if (Number.isInteger(postId)) skipPost(postId);
    res.redirect("/dashboard");
  });

  app.post("/dashboard/posts/:id/metrics", (req, res) => {
    const postId = Number(req.params.id);
    if (Number.isInteger(postId)) {
      const toNum = (v: unknown) => (v === undefined || v === "" ? null : Number(v));
      const { impressions, likes, comments, reposts, clicks } = req.body ?? {};
      recordManualMetrics(postId, {
        impressions: toNum(impressions),
        likes: toNum(likes),
        comments: toNum(comments),
        reposts: toNum(reposts),
        clicks: toNum(clicks),
      });
    }
    res.redirect("/dashboard");
  });

  // Telegram webhook. The bot token is embedded in the path (Telegram's own recommended
  // pattern) so the URL itself isn't guessable; handleIncomingMessage additionally checks
  // the sender's chat_id against TELEGRAM_CHAT_ID before recording anything.
  app.post(`/telegram/webhook/${config.telegram.botToken}`, async (req, res) => {
    try {
      const message = req.body?.message;
      const chatId = message?.chat?.id;
      const text = message?.text;
      if (chatId !== undefined && typeof text === "string") {
        await handleIncomingMessage(chatId, text);
      }
    } catch (err) {
      console.error("[telegram] webhook handling failed:", err);
    }
    res.sendStatus(200); // Telegram expects a fast 200 regardless of processing outcome
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

  app.patch("/api/posts/:id", (req, res) => {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ error: "invalid post id" });
      return;
    }
    const { content } = req.body ?? {};
    if (typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "content must be a non-empty string" });
      return;
    }
    const updated = updateScheduledPostContent(postId, content);
    if (!updated) {
      res.status(404).json({ error: "post not found, or not in 'scheduled' status (already posted content can't be edited)" });
      return;
    }
    res.json({ ok: true });
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

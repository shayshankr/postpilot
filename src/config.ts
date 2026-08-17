import dotenv from "dotenv";
import path from "path";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  linkedin: {
    clientId: optional("LINKEDIN_CLIENT_ID", ""),
    clientSecret: optional("LINKEDIN_CLIENT_SECRET", ""),
    redirectUri: optional("LINKEDIN_REDIRECT_URI", "http://localhost:8080/auth/linkedin/callback"),
  },

  port: parseInt(optional("PORT", "8080"), 10),
  sessionSecret: optional("SESSION_SECRET", "dev-secret-change-me"),

  scheduleLookaheadDays: parseInt(optional("SCHEDULE_LOOKAHEAD_DAYS", "3"), 10),
  contentGenHour: parseInt(optional("CONTENT_GEN_HOUR", "6"), 10),
  reportHour: parseInt(optional("REPORT_HOUR", "8"), 10),
  postTimes: optional("POST_TIMES", "09:15,16:30")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  contentPillars: optional(
    "CONTENT_PILLARS",
    "career journey and job search,Android/Kotlin development,psychrometrics and HVAC engineering,build-in-public project updates"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  reportChannel: optional("REPORT_CHANNEL", "file") as "console" | "file",

  dbPath: path.join(__dirname, "..", "data", "autopilot.db"),
  reportsDir: path.join(__dirname, "..", "data", "reports"),
};

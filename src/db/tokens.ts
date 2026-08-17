import { db } from "./client";
import { OAuthTokenRecord } from "../types";

function rowToToken(row: any): OAuthTokenRecord {
  return {
    id: row.id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    memberUrn: row.member_urn,
  };
}

export function saveLinkedInToken(params: {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  memberUrn: string;
}) {
  // Single-account MVP: keep at most one live LinkedIn token, replace on reconnect.
  db.prepare(`DELETE FROM oauth_tokens WHERE provider = 'linkedin'`).run();
  db.prepare(
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, member_urn)
     VALUES ('linkedin', ?, ?, ?, ?)`
  ).run(params.accessToken, params.refreshToken, params.expiresAt, params.memberUrn);
}

export function getLinkedInToken(): OAuthTokenRecord | undefined {
  const row = db.prepare(`SELECT * FROM oauth_tokens WHERE provider = 'linkedin' ORDER BY id DESC LIMIT 1`).get();
  return row ? rowToToken(row) : undefined;
}

const EXPIRY_WARNING_WINDOW_DAYS = 7;

export interface TokenExpiryStatus {
  expiresAt: string;
  daysRemaining: number;
  expired: boolean;
  warning: string | null;
}

/** Null if no LinkedIn account is connected at all. */
export function getTokenExpiryStatus(): TokenExpiryStatus | null {
  const token = getLinkedInToken();
  if (!token) return null;

  const msRemaining = new Date(token.expiresAt).getTime() - Date.now();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const expired = daysRemaining <= 0;

  let warning: string | null = null;
  if (expired) {
    warning = `LinkedIn access token expired ${Math.abs(daysRemaining)} day(s) ago. Posts will fail until you reconnect at /auth/linkedin.`;
  } else if (daysRemaining <= EXPIRY_WARNING_WINDOW_DAYS) {
    warning = `LinkedIn access token expires in ${daysRemaining} day(s) (${token.expiresAt}). Reconnect at /auth/linkedin before then to avoid a gap in posting.`;
  }

  return { expiresAt: token.expiresAt, daysRemaining, expired, warning };
}

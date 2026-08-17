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

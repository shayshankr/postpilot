import fetch from "node-fetch";
import { config } from "../config";
import { SocialPlatformAdapter, TokenInfo, PublishResult, FetchedMetrics } from "./platform";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";

// Scopes needed: openid+profile to resolve the member's URN, w_member_social to post on their behalf.
const SCOPES = ["openid", "profile", "w_member_social"];

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

interface LinkedInUserInfo {
  sub: string; // member id -> urn:li:person:{sub}
}

async function resolveMemberUrn(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LinkedIn userinfo lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as LinkedInUserInfo;
  return `urn:li:person:${data.sub}`;
}

export const linkedinAdapter: SocialPlatformAdapter = {
  name: "linkedin",

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.linkedin.clientId,
      redirect_uri: config.linkedin.redirectUri,
      state,
      scope: SCOPES.join(" "),
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCodeForToken(code: string): Promise<TokenInfo> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.linkedin.redirectUri,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`LinkedIn token exchange failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as LinkedInTokenResponse;
    const accountUrn = await resolveMemberUrn(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      accountUrn,
    };
  },

  async refreshToken(refreshToken: string): Promise<TokenInfo> {
    // Note: LinkedIn only issues refresh tokens to apps granted the "offline_access"
    // scope (special approval). Most apps get a single access token valid ~60 days
    // and must re-run the /auth/linkedin flow when it expires. This method is here
    // for accounts that do have offline_access; otherwise it will fail and the
    // scheduler falls back to alerting for manual re-auth.
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      throw new Error(`LinkedIn token refresh failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as LinkedInTokenResponse;
    const accountUrn = await resolveMemberUrn(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      accountUrn,
    };
  },

  async publishPost(accessToken: string, accountUrn: string, text: string): Promise<PublishResult> {
    const body = {
      author: accountUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const res = await fetch(UGC_POSTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LinkedIn publish failed: ${res.status} ${await res.text()}`);
    }
    const urn = res.headers.get("x-restli-id") ?? (((await res.json().catch(() => ({}))) as any)?.id ?? "unknown");
    return { externalId: urn };
  },

  async fetchMetrics(_accessToken: string, _externalId: string): Promise<FetchedMetrics | null> {
    // HONEST LIMITATION: LinkedIn does not expose impressions/likes/comments for
    // personal-profile posts through its standard developer API tier. Reading real
    // engagement numbers back requires the Community Management API, which is only
    // granted to approved Marketing Developer Platform partners (not available to
    // individual/personal apps on request). Until/unless that partnership exists,
    // this returns null and the scorer falls back to manually-entered numbers
    // (see POST /api/posts/:id/metrics) or an estimated score from post metadata.
    return null;
  },
};

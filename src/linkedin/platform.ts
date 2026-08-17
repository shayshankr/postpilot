// Generic contract every social platform adapter implements. Adding a new platform
// (Twitter/X, etc.) later means writing one file that satisfies this interface and
// registering it — nothing else in the scheduler/content/report layers changes.

export interface TokenInfo {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string; // ISO timestamp
  accountUrn: string; // platform-specific account identifier
}

export interface PublishResult {
  externalId: string; // platform's id/urn for the created post
}

export interface FetchedMetrics {
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  clicks: number | null;
}

export interface SocialPlatformAdapter {
  name: string;
  getAuthUrl(state: string): string;
  exchangeCodeForToken(code: string): Promise<TokenInfo>;
  refreshToken(refreshToken: string): Promise<TokenInfo>;
  publishPost(accessToken: string, accountUrn: string, text: string): Promise<PublishResult>;
  /** Returns null if the platform's API doesn't expose this data at the app's current access tier. */
  fetchMetrics(accessToken: string, externalId: string): Promise<FetchedMetrics | null>;
}

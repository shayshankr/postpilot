export type PostStatus = "draft" | "scheduled" | "posted" | "failed" | "skipped";

export interface PostRecord {
  id: number;
  pillar: string;
  content: string;
  status: PostStatus;
  scheduledFor: string; // ISO timestamp
  postedAt: string | null;
  linkedinPostUrn: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: string;
}

export interface PostMetrics {
  postId: number;
  capturedAt: string;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  clicks: number | null;
  score: number | null; // 0-100 composite performance score
  source: "api" | "manual" | "estimated";
}

export interface OAuthTokenRecord {
  id: number;
  provider: "linkedin";
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string; // ISO timestamp
  memberUrn: string; // e.g. "urn:li:person:xxxx"
}

import { providerPublicationState } from "../../lib/provider-publication-state";
export const platformOptions = [
  { id: "tiktok", name: "TikTok", icon: "♪", className: "tt" },
  { id: "instagram", name: "Instagram", icon: "◎", className: "ig" },
  { id: "youtube", name: "YouTube Shorts", icon: "▶", className: "yt" },
  { id: "facebook", name: "Facebook Reels", icon: "f", className: "fb" },
  { id: "x", name: "X", icon: "𝕏", className: "x" },
] as const;

export const MAX_VIDEO_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);
export const MAX_TITLE_CHARACTERS = 100;
export const MAX_YOUTUBE_DESCRIPTION_BYTES = 5000;
export const acceptedVideoTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
export type PlatformId = (typeof platformOptions)[number]["id"];
export type PlatformPostContent = { title: string; caption: string };
export type PlatformContentState = Record<PlatformId, PlatformPostContent>;
export const emptyPlatformContent = (): PlatformContentState => ({
  tiktok: { title: "", caption: "" },
  instagram: { title: "", caption: "" },
  youtube: { title: "", caption: "" },
  facebook: { title: "", caption: "" },
  x: { title: "", caption: "" },
});

export type ConnectionState = {
  configured: boolean;
  profile?: string | null;
  connected: Partial<Record<(typeof platformOptions)[number]["id"], boolean>>;
  available?: Partial<Record<PlatformId, boolean>>;
  facebookPageConfigured?: boolean;
  message?: string;
};

export type PlatformResult = {
  platform?: string;
  success?: boolean;
  status?: string;
  message?: string;
  error?: string;
  error_message?: string | null;
  error_code?: string | null;
  failure_stage?: string | null;
  platform_post_id?: string | null;
  post_url?: string | null;
  url?: string | null;
  fallback_to_inbox?: boolean;
};

export type PublishJob = {
  requestId: string;
  status: string;
  results: PlatformResult[];
};

export type StagedUpload = {
  id: string;
  chunkSize: number;
  totalChunks: number;
  expectedSize: number;
  receivedChunks: number[];
  status: string;
};

export function normalizeResults(value: unknown): PlatformResult[] {
  if (Array.isArray(value)) return value as PlatformResult[];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(
      ([platform, result]) => ({
        platform,
        ...(result && typeof result === "object"
          ? (result as PlatformResult)
          : {}),
      }),
    );
  }
  return [];
}

export function mergeResults(
  current: PlatformResult[],
  incoming: PlatformResult[],
) {
  const merged = new Map(
    current
      .filter((item) => item.platform)
      .map((item) => [item.platform!, item]),
  );
  for (const item of incoming) {
    if (!item.platform) continue;
    merged.set(item.platform, { ...merged.get(item.platform), ...item });
  }
  return [...merged.values()];
}

export function platformResultState(
  result: PlatformResult | undefined,
  jobStatus: string | undefined,
) {
  if (!result) return "pending" as const;
  const status=providerPublicationState(result,jobStatus);
  return status === "processing" ? "pending" as const : status;
}

export function platformFailureReason(
  result: PlatformResult | undefined,
  fallback: string,
) {
  return (
    result?.error_message ||
    result?.message ||
    result?.error ||
    result?.error_code ||
    result?.failure_stage ||
    fallback
  );
}

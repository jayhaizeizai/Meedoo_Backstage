export const UPLOAD_POST_ORIGIN = "https://api.upload-post.com";
export const supportedPlatforms = ["tiktok", "instagram", "youtube"] as const;
export type UploadPostPlatform = typeof supportedPlatforms[number];

export function getUploadPostConfig() {
  return {
    apiKey: process.env.UPLOAD_POST_API_KEY ?? "",
    profile: process.env.UPLOAD_POST_PROFILE ?? "",
  };
}

export function isUploadPostConfigured() {
  const config = getUploadPostConfig();
  return Boolean(config.apiKey && config.profile);
}

export async function uploadPostFetch(path: string, init: RequestInit = {}) {
  const { apiKey } = getUploadPostConfig();
  if (!apiKey) throw new Error("UPLOAD_POST_NOT_CONFIGURED");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Apikey ${apiKey}`);
  return fetch(`${UPLOAD_POST_ORIGIN}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(5 * 60 * 1000),
  });
}

export async function parseProviderResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { success: false, message: response.ok ? "Invalid provider response" : "Upload-Post request failed" };
  }
}

export function providerMessage(payload: Record<string, unknown>, fallback: string) {
  const candidate = payload.message ?? payload.error;
  return typeof candidate === "string" && candidate.length <= 500 ? candidate : fallback;
}

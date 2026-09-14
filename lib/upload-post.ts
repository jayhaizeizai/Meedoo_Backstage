export const UPLOAD_POST_ORIGIN = "https://api.upload-post.com";
import { supportedPlatforms } from "./social-platforms";
export { supportedPlatforms, requiredPlatforms } from "./social-platforms";
export type UploadPostPlatform = typeof supportedPlatforms[number];

export function getUploadPostConfig() {
  return {
    apiKey: process.env.UPLOAD_POST_API_KEY ?? "",
    profile: process.env.UPLOAD_POST_PROFILE ?? "",
    facebookPageId: process.env.UPLOAD_POST_FACEBOOK_PAGE_ID?.trim() || null,
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
    signal: init.signal ?? AbortSignal.timeout(init.method && init.method !== "GET" ? 5 * 60 * 1000 : 20_000),
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

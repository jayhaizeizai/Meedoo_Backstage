import { supportedPlatforms, type SocialPlatform } from "./social-platforms";
export type VideoUtmLink = { platform: SocialPlatform; url: string };
// Stable video ID, never a title or user name. No token or private data in URLs.
export function approvedVideoUtmLinks(record: { id: string; review_status: string; target_platforms: readonly string[] }): VideoUtmLink[] {
  if (record.review_status !== "approved" || !/^[0-9a-f-]{36}$/i.test(record.id)) return [];
  return [...new Set(record.target_platforms)].filter((p): p is SocialPlatform => supportedPlatforms.includes(p as SocialPlatform)).map(platform => {
    const url = new URL("https://meedoo.fun/");
    url.searchParams.set("utm_source", platform);
    url.searchParams.set("utm_medium", "organic_social");
    url.searchParams.set("utm_campaign", "meedoo_video");
    url.searchParams.set("utm_content", record.id);
    return { platform, url: url.toString() };
  });
}

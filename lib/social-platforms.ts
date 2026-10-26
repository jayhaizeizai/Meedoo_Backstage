// Browser-safe catalog. Runtime availability is provided by the server.
export const supportedPlatforms = [
  "tiktok",
  "instagram",
  "youtube",
  "facebook",
  "x",
  "threads",
] as const;
export const requiredPlatforms = supportedPlatforms;
export type SocialPlatform = (typeof supportedPlatforms)[number];
export const platformMeta = {
  tiktok: { name: "TikTok", icon: "♪", className: "tt", color: "#252936" },
  instagram: {
    name: "Instagram",
    icon: "◎",
    className: "ig",
    color: "#d55a85",
  },
  youtube: { name: "YouTube", icon: "▶", className: "yt", color: "#ff4c4c" },
  facebook: { name: "Facebook", icon: "f", className: "fb", color: "#1877f2" },
  x: { name: "X", icon: "𝕏", className: "x", color: "#171717" },
  threads: { name: "Threads", icon: "@", className: "threads", color: "#6154a4" },
} as const;

export function viewMetricKeys(platform: string) {
  return platform === "facebook" || platform === "instagram"
    ? ["reach", "views", "impressions"]
    : platform === "x"
      ? ["impressions", "impression_count", "views"]
      : ["views", "reach", "impressions"];
}

// Conservative single-post budget: ASCII is 1; other code points are 2.
// This also prevents Upload-Post's automatic long-text thread creation.
export function socialTextLength(platform: string, value: string) {
  return platform === "x"
    ? [...value].reduce(
        (sum, char) => sum + (char.codePointAt(0)! <= 0x7f ? 1 : 2),
        0,
      )
    : value.length;
}
export const socialTextLimit = (platform: string) =>
  platform === "x" ? 280 : platform === "threads" ? 500 : 2200;

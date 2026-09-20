export const videoTypes = [
  { value: "repost", en: "Repost - Resonate with their World View / Core Values", zh: "转发 — 引发世界观／核心价值观共鸣" },
  { value: "saves", en: "Saves - Give them value", zh: "收藏 — 提供值得保存的价值" },
  { value: "website_visit", en: "Website Visit - Trust & Curiosity", zh: "访问网站 — 建立信任与激发好奇心" },
] as const;
export type VideoType = (typeof videoTypes)[number]["value"];
export function isVideoType(value: unknown): value is VideoType {
  return videoTypes.some((item) => item.value === value);
}

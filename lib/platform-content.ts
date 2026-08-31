import { supportedPlatforms, UploadPostPlatform } from "./upload-post";

export type PlatformPostContent = { title: string; caption: string };
export type PlatformContent = Record<UploadPostPlatform, PlatformPostContent>;

export function parsePlatformContent(value: unknown): PlatformContent | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const result = {} as PlatformContent;
  for (const platform of supportedPlatforms) {
    const item = source[platform];
    if (!item || typeof item !== "object") return null;
    const fields = item as Record<string, unknown>;
    result[platform] = {
      title: typeof fields.title === "string" ? fields.title.trim() : "",
      caption: typeof fields.caption === "string" ? fields.caption.trim() : "",
    };
  }
  return result;
}

export function validatePlatformContent(content: PlatformContent) {
  for (const platform of supportedPlatforms) {
    const { title, caption } = content[platform];
    if (!title || !caption) return `${platform.toUpperCase()}_CONTENT_REQUIRED`;
    if (title.length > 100) return `${platform.toUpperCase()}_TITLE_TOO_LONG`;
    if (/[<>]/.test(title) || /[<>]/.test(caption)) return `${platform.toUpperCase()}_INVALID_CHARACTERS`;
    if (`${title}\n\n${caption}`.length > 2200) return `${platform.toUpperCase()}_SOCIAL_TEXT_TOO_LONG`;
    if (Buffer.byteLength(caption, "utf8") > 5000) return `${platform.toUpperCase()}_CAPTION_TOO_LARGE`;
  }
  return null;
}

export function contentForPlatform(value: unknown, platform: UploadPostPlatform, legacyTitle: string, legacyCaption: string): PlatformPostContent {
  const parsed = parsePlatformContent(value);
  return parsed?.[platform] ?? { title: legacyTitle, caption: legacyCaption };
}

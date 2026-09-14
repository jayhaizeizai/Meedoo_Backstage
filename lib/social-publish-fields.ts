import { contentForPlatform } from "./platform-content";
import type { UploadPostPlatform } from "./upload-post";

export function appendSocialPublishFields(form: FormData, platforms: UploadPostPlatform[], content: unknown,
  title: string, caption: string, facebookPageId: string | null) {
  if (platforms.includes("facebook") && !facebookPageId) throw new Error("FACEBOOK_PAGE_REQUIRED");
  for (const platform of platforms) {
    const post = contentForPlatform(content, platform, title, caption);
    if (platform === "youtube") {
      form.set("youtube_title", post.title.slice(0, 100)); form.set("youtube_description", post.caption.slice(0, 5000));
    } else if (platform === "facebook") {
      form.set("facebook_title", post.title); form.set("facebook_description", post.caption);
      form.set("facebook_page_id", facebookPageId!); form.set("facebook_media_type", "REELS");
    } else {
      form.set(`${platform}_title`, `${post.title}\n\n${post.caption}`);
      if (platform === "tiktok") { form.set("post_mode", "DIRECT_POST"); form.set("disable_inbox_fallback", "true"); }
    }
  }
}

import { getUploadPostConfig, parseProviderResponse, uploadPostFetch } from "./upload-post";

// Upload-Post's pinned Page overrides the request parameter. Reject a changed
// destination rather than publishing an approved video to a different Page.
export async function assertFacebookDestination(pageId: string | null) {
  if (!pageId) throw new Error("FACEBOOK_PAGE_REQUIRED");
  const { profile } = getUploadPostConfig();
  const response = await uploadPostFetch(`/api/uploadposts/users/facebook-page?profile_username=${encodeURIComponent(profile)}`);
  const payload = await parseProviderResponse(response);
  if (!response.ok || payload.success === false || !Array.isArray(payload.pages)) throw new Error("FACEBOOK_PAGE_CHECK_FAILED");
  if (!payload.pages.some(page => page && String(page.id) === pageId)) throw new Error("FACEBOOK_PAGE_UNAVAILABLE");
  if (payload.selected_page_id != null && String(payload.selected_page_id) !== pageId) throw new Error("FACEBOOK_PINNED_PAGE_CHANGED");
}

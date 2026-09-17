type ProviderResult = {
  status?: unknown; success?: unknown; error?: unknown; error_message?: unknown;
  error_code?: unknown; failure_stage?: unknown; platform_post_id?: unknown;
  post_id?: unknown; publish_id?: unknown; post_url?: unknown; url?: unknown;
};
const active = new Set(["processing","pending","queued","running","publishing","uploading","scheduled","retrying","in_progress","in-progress","reconciling"]);
export function providerPublicationState(result: ProviderResult, jobStatus?: unknown): "completed"|"failed"|"processing" {
  const status=typeof result.status === "string"?result.status.toLowerCase():"";
  if(["failed","error","rejected"].includes(status))return "failed";
  if(["completed","success","published"].includes(status))return "completed";
  // A processing response uses success:false to mean not finished, not failed.
  if(active.has(status))return "processing";
  if(result.success===true || result.platform_post_id || result.post_id || result.publish_id || result.post_url || result.url)return "completed";
  if(result.error_message || result.error || result.error_code || result.failure_stage)return "failed";
  if(active.has(String(jobStatus).toLowerCase()))return "processing";
  return result.success===false?"failed":"processing";
}

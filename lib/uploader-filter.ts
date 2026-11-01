// Display-only aliases: historical videos and account permissions are unchanged.
const hiddenUploaderNames = new Set(["小安", "xiaoan", "yihan", "yihanliang", "wangziyi"]);
export function isVisibleUploader(name: string) {
  return !hiddenUploaderNames.has(name.normalize("NFKC").toLowerCase().replace(/[\s._-]+/g, ""));
}

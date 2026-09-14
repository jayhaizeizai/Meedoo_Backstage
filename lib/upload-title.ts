type TitleRecord = { title?: string | null; original_filename?: string | null; platform_content?: unknown };

/** Prefer an authored platform title over the filename-derived legacy title. */
export function uploadTitle(record: TitleRecord): string {
  const content = record.platform_content && typeof record.platform_content === "object"
    ? record.platform_content as Record<string, { title?: unknown }> : {};
  const titles = ["youtube", "tiktok", "instagram"].map(platform => content[platform]?.title)
    .filter((title): title is string => typeof title === "string" && Boolean(title.trim())).map(title => title.trim());
  const filename = record.original_filename?.trim() ?? "";
  const stem = filename.replace(/\.[^.]+$/, "").slice(0, 100);
  const authored = (title: string) => title !== filename && title !== stem;
  return titles.find(authored) || (record.title?.trim() && authored(record.title.trim()) ? record.title.trim() : "")
    || titles[0] || record.title?.trim() || "Untitled video";
}

export function titleForSelectedFile(current: string, previousFilename: string | undefined, nextFilename: string): string {
  const oldDefault = previousFilename?.replace(/\.[^.]+$/, "").slice(0, 100);
  return current.trim() && current !== oldDefault ? current : nextFilename.replace(/\.[^.]+$/, "").slice(0, 100);
}

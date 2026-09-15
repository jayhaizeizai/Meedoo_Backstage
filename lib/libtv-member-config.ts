import { readFile } from "node:fs/promises";

export async function loadLibTvMemberMappings(): Promise<Map<string, string>> {
  const path =
    process.env.LIBTV_MEMBER_MAPPINGS_FILE?.trim() ||
    "/etc/meedoo/libtv-member-mappings.json";
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("LIBTV_MAPPING_CONFIG_UNREADABLE");
  }
  const config = value as { version?: unknown; mappings?: unknown } | null;
  if (!config || config.version !== 1 || !Array.isArray(config.mappings))
    throw new Error("LIBTV_MAPPING_CONFIG_INVALID");
  const mappings = new Map<string, string>();
  const uploaders = new Set<string>();
  for (const row of config.mappings) {
    if (
      !row ||
      typeof row.memberId !== "string" ||
      typeof row.uploaderOpenId !== "string"
    )
      throw new Error("LIBTV_MAPPING_CONFIG_INVALID");
    const member = row.memberId.trim(),
      uploader = row.uploaderOpenId.trim();
    if (
      !member ||
      member === "0" ||
      !uploader ||
      mappings.has(member) ||
      uploaders.has(uploader)
    )
      throw new Error("LIBTV_MAPPING_CONFIG_INVALID");
    mappings.set(member, uploader);
    uploaders.add(uploader);
  }
  return mappings;
}

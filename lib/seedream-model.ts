import { generationRatios, uuidPattern } from "./generation-model";

export const seedreamModel = { id: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro" };
export type ImageDraft = { id: string; name: string; url: string };
export type SeedreamInput = { requestId: string; prompt: string; ratio: string; baseAssetId: string | null };
export function validateSeedream(value: unknown): SeedreamInput {
  const v = value as SeedreamInput;
  if (!v || !uuidPattern.test(v.requestId) || typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 4000 ||
    !(generationRatios as readonly string[]).includes(v.ratio) || (v.baseAssetId != null && !uuidPattern.test(v.baseAssetId))) throw Error("INVALID_INPUT");
  return { requestId: v.requestId, prompt: v.prompt.trim(), ratio: v.ratio, baseAssetId: v.baseAssetId ?? null };
}
// Official 2K pixel sizes; explicit dimensions keep successive edits in the same aspect ratio.
export const seedreamSizes: Record<string, string> = { "1:1": "2048x2048", "9:16": "1584x2816", "16:9": "2816x1584", "4:3": "2368x1776", "3:4": "1776x2368", "21:9": "3136x1344" };

import { generationRatios, uuidPattern } from "./generation-model";

export const seedreamModel = { id: "doubao-seedream-5-0-pro-260628", label: "Seedream 5.0 Pro" };
export type ImageDraft = { id: string; name: string; url: string };
export const seedreamQualities = ["1K", "1.5K", "2K"] as const;
export type SeedreamQuality = typeof seedreamQualities[number];
export type SeedreamInput = { requestId: string; prompt: string; ratio: string; quality?: SeedreamQuality; baseAssetId: string | null };
export function validateSeedream(value: unknown): SeedreamInput {
  const v = value as SeedreamInput;
  if (!v || !uuidPattern.test(v.requestId) || typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 4000 ||
    (v.quality !== undefined && !(seedreamQualities as readonly string[]).includes(v.quality)) || !(generationRatios as readonly string[]).includes(v.ratio) || (v.baseAssetId != null && !uuidPattern.test(v.baseAssetId))) throw Error("INVALID_INPUT");
  return { requestId: v.requestId, prompt: v.prompt.trim(), ratio: v.ratio, quality: v.quality ?? "2K", baseAssetId: v.baseAssetId ?? null };
}
// Official 2K pixel sizes; explicit dimensions keep successive edits in the same aspect ratio.
export const seedreamSizes: Record<string, string> = { "1:1": "2048x2048", "9:16": "1584x2816", "16:9": "2816x1584", "4:3": "2368x1776", "3:4": "1776x2368", "21:9": "3136x1344" };

const lowerSizes: Record<string, Record<string,string>> = {
  "1K": {"1:1":"1024x1024","9:16":"800x1424","16:9":"1424x800","4:3":"1152x864","3:4":"864x1152","21:9":"1568x672"},
  "1.5K": {"1:1":"1536x1536","9:16":"1152x2048","16:9":"2048x1152","4:3":"1792x1344","3:4":"1344x1792","21:9":"2352x1008"},
};
export function seedreamSize(ratio: string, quality: SeedreamQuality = "2K") {
  return (quality === "2K" ? seedreamSizes : lowerSizes[quality])?.[ratio];
}

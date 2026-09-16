export const generationRatios = [
  "9:16",
  "16:9",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
] as const;
export type GenerationInput = {
  requestId: string;
  requirement: string;
  prompt: string;
  mode: "reference" | "frames";
  duration: number;
  resolution: "768P" | "2K";
  ratio: string;
  assets: {
    id: string;
    role: "reference_image" | "first_frame" | "last_frame";
  }[];
};
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateGeneration(value: unknown): GenerationInput {
  if (!value || typeof value !== "object") throw Error("INVALID_INPUT");
  const v = value as GenerationInput;
  if (
    !uuidPattern.test(v.requestId) ||
    typeof v.requirement !== "string" ||
    !v.requirement.trim() ||
    v.requirement.length > 160 ||
    typeof v.prompt !== "string" ||
    !v.prompt.trim() ||
    [...v.prompt].length > 7000 ||
    !["reference", "frames"].includes(v.mode) ||
    !Number.isInteger(v.duration) ||
    v.duration < 4 ||
    v.duration > 15 ||
    !["768P", "2K"].includes(v.resolution) ||
    !generationRatios.includes(v.ratio as (typeof generationRatios)[number]) ||
    !Array.isArray(v.assets) ||
    v.assets.length > 9
  )
    throw Error("INVALID_INPUT");
  if (
    new Set(v.assets.map((a) => a?.id)).size !== v.assets.length ||
    v.assets.some((a) => !a || !uuidPattern.test(a.id))
  )
    throw Error("INVALID_INPUT");
  if (
    v.mode === "reference" &&
    v.assets.some((a) => a.role !== "reference_image")
  )
    throw Error("INVALID_INPUT");
  if (
    v.mode === "frames" &&
    (v.assets.length < 1 ||
      v.assets.length > 2 ||
      v.assets.filter((a) => a.role === "first_frame").length !== 1 ||
      v.assets.filter((a) => a.role === "last_frame").length > 1 ||
      v.assets.some((a) => !["first_frame", "last_frame"].includes(a.role)))
  )
    throw Error("INVALID_INPUT");
  return {
    requestId: v.requestId,
    requirement: v.requirement.trim(),
    prompt: v.prompt.trim(),
    mode: v.mode,
    duration: v.duration,
    resolution: v.resolution,
    ratio: v.ratio,
    assets: v.assets.map((a) => ({ id: a.id, role: a.role })),
  };
}
// China pay-as-you-go list price, 2026-09-16. Estimates are not settled invoices.
export function estimateGenerationCost(
  duration: number,
  resolution: string,
  images: number,
) {
  return (
    Math.round(
      (duration * (resolution === "2K" ? 0.8 : 0.5) +
        Math.max(0, images - 5) * 0.2) *
        100,
    ) / 100
  );
}
export function normalizeGenerationUsage(value: unknown) {
  const result: Record<string, number> = {};
  if (!value || typeof value !== "object") return result;
  for (const key of [
    "total_tokens",
    "prompt_tokens",
    "completion_tokens",
    "total_seconds",
    "input_seconds",
    "output_seconds",
    "input_image_count",
    "input_audio_seconds",
  ]) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) result[key] = n;
  }
  return result;
}

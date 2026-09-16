export const generationModels = {
  "minimax-h3": {
    label: "MiniMax H3",
    provider: "minimax",
    apiModel: "MiniMax-H3",
    maxDuration: 15,
    maxImages: 9,
    resolutions: ["768P", "2K"],
  },
  "seedance-2.0": {
    label: "Seedance 2.0",
    provider: "ark",
    apiModel: "doubao-seedance-2-0-260128",
    maxDuration: 15,
    maxImages: 9,
    resolutions: ["480p", "720p"],
  },
  "seedance-2.0-fast": {
    label: "Seedance 2.0 Fast",
    provider: "ark",
    apiModel: "doubao-seedance-2-0-fast-260128",
    maxDuration: 15,
    maxImages: 9,
    resolutions: ["480p", "720p"],
  },
  "seedance-2.0-mini": {
    label: "Seedance 2.0 Mini",
    provider: "ark",
    apiModel: "doubao-seedance-2-0-mini-260615",
    maxDuration: 15,
    maxImages: 9,
    resolutions: ["480p", "720p"],
  },
  "seedance-2.5": {
    label: "Seedance 2.5",
    provider: "ark",
    apiModel: "doubao-seedance-2-5-260628",
    maxDuration: 30,
    maxImages: 30,
    resolutions: ["480p", "720p"],
  },
} as const;
export type GenerationModel = keyof typeof generationModels;
export function generationModel(value?: string) {
  const id = value ?? "minimax-h3";
  if (!Object.hasOwn(generationModels, id)) throw Error("INVALID_INPUT");
  return generationModels[id as GenerationModel];
}
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
  model?: GenerationModel;
  generateAudio?: boolean;
  requirement: string;
  prompt: string;
  mode: "reference" | "frames";
  duration: number;
  resolution: "768P" | "2K" | "480p" | "720p";
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
  const model = generationModel(v.model);
  if (
    (v.generateAudio !== undefined && typeof v.generateAudio !== "boolean") ||
    !uuidPattern.test(v.requestId) ||
    (v.requirement !== undefined && typeof v.requirement !== "string") ||
    (typeof v.requirement === "string" && v.requirement.length > 160) ||
    typeof v.prompt !== "string" ||
    !v.prompt.trim() ||
    [...v.prompt].length > 7000 ||
    !["reference", "frames"].includes(v.mode) ||
    !Number.isInteger(v.duration) ||
    v.duration < 4 ||
    v.duration > model.maxDuration ||
    !(model.resolutions as readonly string[]).includes(v.resolution) ||
    !generationRatios.includes(v.ratio as (typeof generationRatios)[number]) ||
    !Array.isArray(v.assets) ||
    v.assets.length > model.maxImages
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
    model: v.model ?? "minimax-h3",
    ...(model.provider === "ark"
      ? { generateAudio: v.generateAudio ?? true }
      : {}),
    // Preserve old clients' names; new clients need only supply a prompt.
    requirement: v.requirement?.trim() || (() => {
      const title = [...v.prompt.trim().replace(/\s+/g, " ")];
      return title.slice(0, 40).join("") + (title.length > 40 ? "…" : "");
    })(),
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

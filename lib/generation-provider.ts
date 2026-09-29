import { generationModel, type GenerationInput } from "./generation-model";

export function safeProviderDiagnostic(data: any, requestId?: string | null) {
  const token = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_.-]{1,120}$/.test(v) ? v : undefined;
  const message = typeof data?.error?.message === "string" ? data.error.message : "";
  const parameter = /(?:parameter|field)\s+[`'"]([^`'"]+)[`'"]/i.exec(message)?.[1];
  // Preserve only structured identifiers and known field names; never upstream prose or URLs.
  return {
    code: token(data?.error?.code),
    request_id: token(requestId) || token(data?.request_id) || token(/Request id:\s*([a-zA-Z0-9_-]+)/i.exec(message)?.[1]),
    parameter: parameter && /^(model|content(?:\[\d+\])?(?:\.(?:image_url|url|text|role))?|duration|resolution|ratio|generate_audio)$/.test(parameter) ? parameter : undefined,
  };
}

export class ProviderError extends Error {
  constructor(
    public status: number,
    public code?: string,
    public diagnostic?: ReturnType<typeof safeProviderDiagnostic>,
  ) {
    super(`PROVIDER_${status}`);
  }
}
export function providerConfigured(model?: string) {
  return Boolean(
    process.env[
      generationModel(model).provider === "ark"
        ? "ARK_API_KEY"
        : "MINIMAX_API_KEY"
    ],
  );
}
async function request(
  model: string | undefined,
  endpoint: string,
  body?: unknown,
) {
  const ark = generationModel(model).provider === "ark";
  const key = process.env[ark ? "ARK_API_KEY" : "MINIMAX_API_KEY"];
  if (!key) throw Error("NOT_CONFIGURED");
  const response = await fetch(
    (ark
      ? "https://ark.cn-beijing.volces.com/api/v3"
      : "https://api.minimaxi.com") + endpoint,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(body ? 45000 : 15000),
      redirect: "error",
    },
  );
  if (!response.ok) {
    // Never expose raw upstream messages, which can contain signed URLs or input content.
    const data = await response.json().catch(() => null);
    const diagnostic = safeProviderDiagnostic(data, response.headers.get("x-request-id"));
    throw new ProviderError(response.status, diagnostic.code, diagnostic);
  }
  const data = await response.json();
  if (ark && data && typeof data === "object" && !data.request_id)
    data.request_id = safeProviderDiagnostic(data, response.headers.get("x-request-id")).request_id;
  return data;
}
export async function submitGeneration(
  input: GenerationInput,
  imageUrl: (id: string) => string,
) {
  const model = generationModel(input.model);
  const body = {
    model: model.apiModel,
    content: [
      { type: "text", text: input.prompt },
      ...input.assets.map((a) => {
        const type = a.role === "reference_video" ? "video_url" : a.role === "reference_audio" ? "audio_url" : "image_url";
        return { type, [type]: { url: imageUrl(a.id) }, role: a.role };
      }),
    ],
    resolution: input.resolution,
    duration: input.duration,
    ratio: input.mode === "frames" ? "adaptive" : input.ratio,
    ...(model.provider === "ark"
      ? { generate_audio: input.generateAudio ?? true }
      : {}),
  };
  const result = await request(
    input.model,
    model.provider === "ark"
      ? "/contents/generations/tasks"
      : "/v2/video_generation",
    body,
  );
  const id = model.provider === "ark" ? result.id : result.task_id;
  if (typeof id !== "string" || !id) throw Error("INVALID_PROVIDER_RESULT");
  return id;
}
export async function queryGeneration(input: GenerationInput, id: string) {
  const ark = generationModel(input.model).provider === "ark";
  const response = await request(
    input.model,
    ark
      ? `/contents/generations/tasks/${encodeURIComponent(id)}`
      : `/v2/query/video_generation/${encodeURIComponent(id)}`,
  );
  if (!ark) return response.task;
  return {
    ...response,
    status: response.status === "expired" ? "failed" : response.status,
    content: { url: response.content?.video_url },
    usage: {
      ...response.usage,
      ...(typeof response.duration === "number"
        ? { output_seconds: response.duration }
        : {}),
    },
  };
}

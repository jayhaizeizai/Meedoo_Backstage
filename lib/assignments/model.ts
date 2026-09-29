import { uuidPattern } from "../generation-model";

export function assignmentId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw Error("INVALID_INPUT");
  return value;
}
export function assignmentText(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw Error("INVALID_INPUT");
  return value.trim();
}
export type ShotProposal = { title: string; prompt: string; duration: number };
export type PlanOutput = { summary: string; storyboardPrompt: string; shots: ShotProposal[] };
export function parsePlan(value: unknown, kind: string): PlanOutput {
  const v = value as PlanOutput;
  const summary = assignmentText(v?.summary, 5000, true);
  const storyboardPrompt = assignmentText(v?.storyboardPrompt ?? "", 3800, kind === "summary");
  if (!Array.isArray(v?.shots) || v.shots.length > 24 || (kind === "shots" && !v.shots.length)) throw Error("INVALID_AI_RESULT");
  const shots = v.shots.map(s => {
    if (!Number.isInteger(s?.duration) || s.duration < 4 || s.duration > 30) throw Error("INVALID_AI_RESULT");
    return { title: assignmentText(s.title, 160, true), prompt: assignmentText(s.prompt, 6500, true), duration: s.duration };
  });
  return { summary, storyboardPrompt, shots };
}

export function assignmentDeadline(value: unknown): string {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) throw Error("INVALID_INPUT");
  return new Date(value).toISOString();
}

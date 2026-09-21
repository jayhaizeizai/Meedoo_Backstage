import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, transaction } from "../db";
import { createGeneration } from "../generation";
import { createSeedream } from "../seedream";
import { validateGeneration } from "../generation-model";
import { validateSeedream } from "../seedream-model";
import { assignmentSchema } from "./schema";
import { assignmentId, assignmentText, parsePlan } from "./model";

export async function ownedAssignment(id: string, owner: string, client?: PoolClient, lock = false) {
  assignmentId(id);
  const sql = "SELECT * FROM assignments WHERE id=$1 AND owner_id=$2" + (lock ? " FOR UPDATE" : "");
  const row = (await (client ? client.query(sql, [id, owner]) : query(sql, [id, owner]))).rows[0];
  if (!row) throw Error("NOT_FOUND");
  return row;
}
async function ownedAsset(id: unknown, owner: string, c: PoolClient) {
  if (id == null || id === "") return null;
  assignmentId(id);
  if (!(await c.query("SELECT id FROM generation_assets WHERE id=$1 AND owner_id=$2 AND NOT file_deleted AND (expires_at IS NULL OR expires_at>now())", [id, owner])).rowCount) throw Error("INVALID_ASSETS");
  return id as string;
}
export async function assignmentList(owner: string, page = 1) {
  await assignmentSchema();
  page = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const total = Number((await query("SELECT count(*) n FROM assignments WHERE owner_id=$1", [owner])).rows[0].n);
  const pages = Math.max(1, Math.ceil(total / 20)); page = Math.min(page, pages);
  const rows = (await query(`SELECT a.id,a.title,a.summary,a.created_at,a.updated_at,
    (SELECT count(*)::int FROM assignment_shots s WHERE s.assignment_id=a.id) shot_count
    FROM assignments a WHERE a.owner_id=$1 ORDER BY a.created_at DESC,a.id LIMIT 20 OFFSET $2`, [owner, (page - 1) * 20])).rows;
  return { assignments: rows, page, pages, total };
}
export async function createAssignment(owner: string, body: Record<string, unknown>) {
  await assignmentSchema();
  const id = assignmentId(body.id), title = assignmentText(body.title, 160, true), brief = assignmentText(body.brief, 16000, true);
  return transaction(async c => {
    await c.query("INSERT INTO assignments(id,owner_id,title,brief) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [id, owner, title, brief]);
    const row = await ownedAssignment(id, owner, c);
    if (row.title !== title || row.brief !== brief) throw Error("REQUEST_CONFLICT");
    return id;
  });
}
export async function assignmentDetail(owner: string, id: string) {
  await assignmentSchema();
  const assignment = await ownedAssignment(id, owner);
  const shots = (await query("SELECT * FROM assignment_shots WHERE assignment_id=$1 ORDER BY position,id", [id])).rows;
  const runs = (await query(`SELECT r.id,r.shot_id,r.kind,r.created_at,r.input,
    COALESCE(v.status,i.status,CASE WHEN r.error_code IS NULL THEN 'reserved' ELSE 'failed' END) status,
    COALESCE(v.error_code,i.error_code,r.error_code) error_code,
    COALESCE(v.provider_error,i.provider_error) provider_error,
    v.id video_id,i.id image_id,i.asset_id,
    (v.media_path IS NOT NULL AND v.media_deleted_at IS NULL AND v.media_expires_at>now()) downloadable,
    (a.id IS NOT NULL AND NOT a.file_deleted AND (a.expires_at IS NULL OR a.expires_at>now())) image_available
    FROM assignment_runs r
    LEFT JOIN generation_tasks v ON r.kind='video' AND v.owner_id=r.owner_id AND v.request_id=r.id
    LEFT JOIN seedream_tasks i ON r.kind='storyboard' AND i.owner_id=r.owner_id AND i.request_id=r.id
    LEFT JOIN generation_assets a ON a.id=i.asset_id
    WHERE r.assignment_id=$1 AND r.owner_id=$2 ORDER BY r.created_at DESC LIMIT 200`, [id, owner])).rows;
  const plans = (await query("SELECT id,kind,source_version,status,output,error_code,applied_at,created_at FROM assignment_plans WHERE assignment_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 20", [id, owner])).rows;
  const assets = [...new Set([assignment.storyboard_asset_id, ...shots.map(s => s.reference_asset_id)].filter(Boolean))];
  const available = (await query("SELECT id FROM generation_assets WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND NOT file_deleted AND (expires_at IS NULL OR expires_at>now())", [assets, owner])).rows.map(a => a.id);
  return { assignment, shots, runs, plans, availableAssets: available, plannerConfigured: Boolean(process.env.ARK_API_KEY) };
}
export async function editAssignment(owner: string, id: string, body: Record<string, unknown>) {
  await assignmentSchema();
  return transaction(async c => {
    const a = await ownedAssignment(id, owner, c, true);
    if (body.version !== a.version) throw Error("REQUEST_CONFLICT");
    if (body.action === "save") {
      const asset = await ownedAsset(body.storyboardAssetId, owner, c);
      await c.query("UPDATE assignments SET title=$2,brief=$3,summary=$4,storyboard_prompt=$5,storyboard_asset_id=$6,version=version+1,updated_at=now() WHERE id=$1", [id, assignmentText(body.title, 160, true), assignmentText(body.brief, 16000, true), assignmentText(body.summary, 5000), assignmentText(body.storyboardPrompt, 3800), asset]);
    } else if (body.action === "save_shot" || body.action === "add_shot") {
      const shotId = body.action === "add_shot" ? randomUUID() : assignmentId(body.shotId);
      const title = assignmentText(body.title, 160, true), prompt = assignmentText(body.prompt, 6500, true);
      const duration = body.duration;
      if (!Number.isInteger(duration) || Number(duration) < 4 || Number(duration) > 30) throw Error("INVALID_INPUT");
      const asset = await ownedAsset(body.referenceAssetId, owner, c);
      if (body.action === "add_shot") {
        const count = (await c.query("SELECT count(*)::int n,COALESCE(max(position),0)+1 pos FROM assignment_shots WHERE assignment_id=$1", [id])).rows[0];
        if (count.n >= 24) throw Error("INVALID_INPUT");
        await c.query("INSERT INTO assignment_shots(id,assignment_id,position,title,prompt,duration,reference_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [shotId, id, count.pos, title, prompt, duration, asset]);
      } else if (!(await c.query("UPDATE assignment_shots SET title=$3,prompt=$4,duration=$5,reference_asset_id=$6 WHERE id=$1 AND assignment_id=$2", [shotId, id, title, prompt, duration, asset])).rowCount) throw Error("NOT_FOUND");
      await c.query("UPDATE assignments SET version=version+1,updated_at=now() WHERE id=$1", [id]);
    } else if (body.action === "apply_plan") {
      const plan = (await c.query("SELECT * FROM assignment_plans WHERE id=$1 AND assignment_id=$2 AND owner_id=$3 AND status='succeeded'", [assignmentId(body.planId), id, owner])).rows[0];
      if (!plan || plan.applied_at || plan.source_version !== a.version) throw Error("REQUEST_CONFLICT");
      const output = parsePlan(plan.output, plan.kind);
      if (plan.kind === "summary") {
        await c.query("UPDATE assignments SET summary=$2,storyboard_prompt=$3,version=version+1,updated_at=now() WHERE id=$1", [id, output.summary, output.storyboardPrompt]);
      } else {
        // Never delete a shot with a paid generation attached.
        if ((await c.query("SELECT id FROM assignment_runs WHERE assignment_id=$1 AND kind='video' LIMIT 1", [id])).rowCount) throw Error("SHOTS_HAVE_GENERATIONS");
        await c.query("DELETE FROM assignment_shots WHERE assignment_id=$1", [id]);
        for (const [index, shot] of output.shots.entries()) await c.query("INSERT INTO assignment_shots(id,assignment_id,position,title,prompt,duration) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), id, index + 1, shot.title, shot.prompt, shot.duration]);
        await c.query("UPDATE assignments SET version=version+1,updated_at=now() WHERE id=$1", [id]);
      }
      await c.query("UPDATE assignment_plans SET applied_at=now() WHERE id=$1", [plan.id]);
    } else throw Error("INVALID_INPUT");
  });
}

// Reserve the association before calling the existing durable generation flows.
// Joining on owner + request_id recovers the link even if the HTTP request is interrupted.
export async function generateForAssignment(user: { openId: string; name: string }, id: string, body: Record<string, unknown>) {
  await assignmentSchema();
  const runId = assignmentId(body.requestId), kind = body.action === "storyboard" ? "storyboard" : "video";
  const input = kind === "storyboard" ? validateSeedream(body.input) : validateGeneration(body.input);
  if (input.requestId !== runId) throw Error("INVALID_INPUT");
  const shotId = kind === "video" ? assignmentId(body.shotId) : null;
  await transaction(async c => {
    await ownedAssignment(id, user.openId, c, true);
    if (shotId && !(await c.query("SELECT id FROM assignment_shots WHERE id=$1 AND assignment_id=$2", [shotId, id])).rowCount) throw Error("NOT_FOUND");
    const old = (await c.query("SELECT *,input=$2::jsonb same FROM assignment_runs WHERE id=$1", [runId, JSON.stringify(input)])).rows[0];
    if (old) {
      if (old.owner_id !== user.openId || old.assignment_id !== id || old.kind !== kind || old.shot_id !== shotId || !old.same) throw Error("REQUEST_CONFLICT");
      return;
    }
    const count = Number((await c.query("SELECT count(*) n FROM assignment_runs WHERE assignment_id=$1", [id])).rows[0].n);
    if (count >= 200) throw Error("TOO_MANY_TASKS");
    const pending = await c.query(`SELECT r.id FROM assignment_runs r
      LEFT JOIN generation_tasks g ON g.owner_id=r.owner_id AND g.request_id=r.id
      LEFT JOIN seedream_tasks i ON i.owner_id=r.owner_id AND i.request_id=r.id
      WHERE r.assignment_id=$1 AND r.kind=$2 AND r.shot_id IS NOT DISTINCT FROM $3::uuid
      AND (COALESCE(g.status,i.status) IN ('preparing','submitting','queued','running','submitted_unknown')
        OR (g.id IS NULL AND i.id IS NULL AND (r.error_code IS NULL OR r.error_code='SUBMISSION_UNCERTAIN'))) LIMIT 1`, [id, kind, shotId]);
    if (pending.rowCount) throw Error("GENERATION_PENDING");
    await c.query("INSERT INTO assignment_runs(id,assignment_id,shot_id,owner_id,kind,input) VALUES($1,$2,$3,$4,$5,$6)", [runId, id, shotId, user.openId, kind, JSON.stringify(input)]);
  });
  try {
    const generationId = kind === "storyboard" ? await createSeedream(user.openId, input) : await createGeneration(user, input);
    await query("UPDATE assignment_runs SET error_code=NULL WHERE id=$1 AND owner_id=$2", [runId, user.openId]);
    return generationId;
  } catch (error) {
    const code = error instanceof Error && ["INVALID_INPUT", "INVALID_ASSETS", "NOT_CONFIGURED", "TOO_MANY_TASKS", "REQUEST_CONFLICT"].includes(error.message) ? error.message : "SUBMISSION_UNCERTAIN";
    await query("UPDATE assignment_runs SET error_code=$2 WHERE id=$1 AND owner_id=$3", [runId, code, user.openId]);
    throw error;
  }
}

import { copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, transaction } from "../db";
import { createGeneration } from "../generation";
import { createSeedream } from "../seedream";
import { validateGeneration } from "../generation-model";
import { validateSeedream } from "../seedream-model";
import { assignmentSchema } from "./schema";
import { assignmentId, assignmentText, assignmentDeadline, parsePlan } from "./model";

export const assignmentVisibility = "(a.assignee_id IS NULL OR a.assignee_id=$2 OR EXISTS (SELECT 1 FROM meedoo_users WHERE open_id=$2 AND role='approver'))";
export async function ownedAssignment(id: string, owner: string, client?: PoolClient, lock = false) {
  assignmentId(id);
  const sql = `SELECT a.*,creator.name creator_name,assignee.name assignee_name,
    EXISTS (SELECT 1 FROM meedoo_users WHERE open_id=$2 AND role='approver') is_admin
    FROM assignments a JOIN meedoo_users creator ON creator.open_id=a.owner_id LEFT JOIN meedoo_users assignee ON assignee.open_id=a.assignee_id
    WHERE a.id=$1 AND ${assignmentVisibility}` + (lock ? " FOR UPDATE OF a" : "");
  const row = (await (client ? client.query(sql, [id, owner]) : query(sql, [id, owner]))).rows[0];
  if (!row) throw Error("NOT_FOUND");
  row.can_edit = row.is_admin || row.assignee_id === owner || (!row.assignee_id && row.owner_id === owner);
  return row;
}
export function requireAssignmentEditor(row: { can_edit: boolean }) { if (!row.can_edit) throw Error("FORBIDDEN"); }
export const assetAttachment = `(EXISTS (SELECT 1 FROM assignments WHERE id=$3 AND storyboard_asset_id=a.id)
  OR EXISTS (SELECT 1 FROM assignment_shots WHERE assignment_id=$3 AND reference_asset_id=a.id)
  OR EXISTS (SELECT 1 FROM assignment_runs r JOIN seedream_tasks t ON t.owner_id=r.owner_id AND t.request_id=r.id WHERE r.assignment_id=$3 AND t.asset_id=a.id)
  OR EXISTS (SELECT 1 FROM assignment_runs r WHERE r.assignment_id=$3 AND (r.input->>'baseAssetId'=a.id::text OR r.input->'assets' @> jsonb_build_array(jsonb_build_object('id',a.id::text)))))`;
export async function ownedAsset(id: unknown, owner: string, c: PoolClient, assignment: string) {
  if (id == null || id === "") return null;
  assignmentId(id);
  if (!(await c.query(`SELECT a.id FROM generation_assets a WHERE a.id=$1 AND (a.owner_id=$2 OR ${assetAttachment}) AND NOT a.file_deleted AND (a.expires_at IS NULL OR a.expires_at>now())`, [id, owner, assignment])).rowCount) throw Error("INVALID_ASSETS");
  return id as string;
}
export async function assetForGeneration(id: string, owner: string, c: PoolClient, assignment: string) {
  await ownedAsset(id, owner, c, assignment);
  const source = (await c.query("SELECT * FROM generation_assets WHERE id=$1", [id])).rows[0];
  if (source.owner_id === owner) return id;
  // Reassignment must not leak cross-user asset privileges to the general generator.
  // Copy this explicitly attached reference into the submitting user's asset namespace.
  const hex = createHash("sha256").update(`${assignment}:${id}:${owner}`).digest("hex");
  const cloneId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const existing = (await c.query("SELECT id FROM generation_assets WHERE id=$1 AND owner_id=$2 AND NOT file_deleted AND (expires_at IS NULL OR expires_at>now())", [cloneId, owner])).rows[0];
  if (existing) return cloneId;
  const directory = path.join(process.env.MEEDOO_MEDIA_DIR || "/opt/meedoo/media", "generation");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${cloneId}.image`);
  try { await copyFile(source.path, file, constants.COPYFILE_EXCL); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw Error("INVALID_ASSETS"); }
  await c.query("INSERT INTO generation_assets(id,owner_id,path,mime,filename,expires_at,media_duration) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING", [cloneId, owner, file, source.mime, source.filename, source.expires_at, source.media_duration]);
  return cloneId;
}
export async function assignmentList(owner: string, page = 1) {
  await assignmentSchema();
  page = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const visibility = assignmentVisibility.replaceAll('$2','$1');
  const total = Number((await query(`SELECT count(*) n FROM assignments a WHERE ${visibility}`, [owner])).rows[0].n);
  const pages = Math.max(1, Math.ceil(total / 20)); page = Math.min(page, pages);
  const rows = (await query(`SELECT a.id,a.title,a.summary,a.created_at,a.updated_at,a.assignee_id,a.deadline,u.name assignee_name,
    (SELECT count(*)::int FROM assignment_shots s WHERE s.assignment_id=a.id) shot_count
    FROM assignments a LEFT JOIN meedoo_users u ON u.open_id=a.assignee_id WHERE ${visibility} ORDER BY a.created_at DESC,a.id LIMIT 20 OFFSET $2`, [owner, (page - 1) * 20])).rows;
  const members = (await query("SELECT open_id,name FROM meedoo_users ORDER BY name,open_id")).rows;
  return { assignments: rows, members, page, pages, total };
}
export async function createAssignment(owner: string, body: Record<string, unknown>) {
  await assignmentSchema();
  const id = assignmentId(body.id), title = assignmentText(body.title, 160, true), brief = assignmentText(body.brief, 16000, true);
  return transaction(async c => {
    const deadline = assignmentDeadline(body.deadline);
    await c.query("INSERT INTO assignments(id,owner_id,title,brief,deadline) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING", [id, owner, title, brief, deadline]);
    const row = await ownedAssignment(id, owner, c);
    if (row.owner_id !== owner || row.title !== title || row.brief !== brief) throw Error("REQUEST_CONFLICT");
    return id;
  });
}
export async function assignmentDetail(owner: string, id: string) {
  await assignmentSchema();
  const assignment = await ownedAssignment(id, owner);
  const shots = (await query("SELECT * FROM assignment_shots WHERE assignment_id=$1 ORDER BY position,id", [id])).rows;
  const runs = (await query(`SELECT r.id,r.shot_id,r.kind,r.created_at,r.input,r.owner_id,
    COALESCE(v.status,i.status,CASE WHEN r.error_code IS NULL THEN 'reserved' WHEN r.error_code='SUBMISSION_UNCERTAIN' THEN 'submitted_unknown' ELSE 'failed' END) status,
    COALESCE(v.error_code,i.error_code,r.error_code) error_code,
    COALESCE(v.provider_error,i.provider_error) provider_error,
    v.id video_id,i.id image_id,i.asset_id,
    (v.media_path IS NOT NULL AND v.media_deleted_at IS NULL AND v.media_expires_at>now()) downloadable,
    (a.id IS NOT NULL AND NOT a.file_deleted AND (a.expires_at IS NULL OR a.expires_at>now())) image_available
    FROM assignment_runs r
    LEFT JOIN generation_tasks v ON r.kind='video' AND v.owner_id=r.owner_id AND v.request_id=r.id
    LEFT JOIN seedream_tasks i ON r.kind='storyboard' AND i.owner_id=r.owner_id AND i.request_id=r.id
    LEFT JOIN generation_assets a ON a.id=i.asset_id
    WHERE r.assignment_id=$1 ORDER BY r.created_at DESC LIMIT 200`, [id])).rows;
  const plans = (await query("SELECT id,kind,source_version,status,output,error_code,applied_at,created_at FROM assignment_plans WHERE assignment_id=$1 ORDER BY created_at DESC LIMIT 20", [id])).rows;
  const assets = [...new Set([assignment.storyboard_asset_id, ...shots.map(s => s.reference_asset_id)].filter(Boolean))];
  const available = (await query("SELECT id FROM generation_assets WHERE id=ANY($1::uuid[]) AND NOT file_deleted AND (expires_at IS NULL OR expires_at>now())", [assets])).rows.map(a => a.id);
  const members = (await query("SELECT open_id,name FROM meedoo_users ORDER BY name,open_id")).rows;
  return { assignment, shots, runs, plans, members, currentUserId: owner, availableAssets: available, plannerConfigured: Boolean(process.env.ARK_API_KEY) };
}
export async function editAssignment(owner: string, id: string, body: Record<string, unknown>) {
  await assignmentSchema();
  return transaction(async c => {
    const a = await ownedAssignment(id, owner, c, true);
    if (body.version !== a.version) throw Error("REQUEST_CONFLICT");
    if (body.action === "assign") {
      const target = body.assigneeId;
      if (target !== null && (typeof target !== "string" || !(await c.query("SELECT open_id FROM meedoo_users WHERE open_id=$1", [target])).rowCount)) throw Error("INVALID_INPUT");
      if (!a.can_edit && !(a.assignee_id === null && target === owner)) throw Error("FORBIDDEN");
      await c.query("UPDATE assignments SET assignee_id=$2,deadline=$3,version=version+1,updated_at=now() WHERE id=$1", [id, target, assignmentDeadline(body.deadline)]);
      return;
    }
    requireAssignmentEditor(a);
    if (body.action === "save") {
      const asset = await ownedAsset(body.storyboardAssetId, owner, c, id);
      await c.query("UPDATE assignments SET title=$2,brief=$3,summary=$4,storyboard_prompt=$5,storyboard_asset_id=$6,version=version+1,updated_at=now() WHERE id=$1", [id, assignmentText(body.title, 160, true), assignmentText(body.brief, 16000, true), assignmentText(body.summary, 5000), assignmentText(body.storyboardPrompt, 3800), asset]);
    } else if (body.action === "save_shot" || body.action === "add_shot") {
      const shotId = body.action === "add_shot" ? randomUUID() : assignmentId(body.shotId);
      const title = assignmentText(body.title, 160, true), prompt = assignmentText(body.prompt, 6500, true);
      const duration = body.duration;
      if (!Number.isInteger(duration) || Number(duration) < 4 || Number(duration) > 30) throw Error("INVALID_INPUT");
      const asset = await ownedAsset(body.referenceAssetId, owner, c, id);
      if (body.action === "add_shot") {
        const count = (await c.query("SELECT count(*)::int n,COALESCE(max(position),0)+1 pos FROM assignment_shots WHERE assignment_id=$1", [id])).rows[0];
        if (count.n >= 24) throw Error("INVALID_INPUT");
        await c.query("INSERT INTO assignment_shots(id,assignment_id,position,title,prompt,duration,reference_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [shotId, id, count.pos, title, prompt, duration, asset]);
      } else if (!(await c.query("UPDATE assignment_shots SET title=$3,prompt=$4,duration=$5,reference_asset_id=$6 WHERE id=$1 AND assignment_id=$2", [shotId, id, title, prompt, duration, asset])).rowCount) throw Error("NOT_FOUND");
      await c.query("UPDATE assignments SET version=version+1,updated_at=now() WHERE id=$1", [id]);
    } else if (body.action === "apply_plan") {
      const plan = (await c.query("SELECT * FROM assignment_plans WHERE id=$1 AND assignment_id=$2 AND status='succeeded'", [assignmentId(body.planId), id])).rows[0];
      if (!plan || plan.applied_at || plan.source_version !== a.version) throw Error("REQUEST_CONFLICT");
      const output = parsePlan(plan.output, plan.kind);
      if (plan.kind === "summary") {
        await c.query("UPDATE assignments SET summary=$2,storyboard_prompt=$3,version=version+1,updated_at=now() WHERE id=$1", [id, output.summary, output.storyboardPrompt]);
      } else {
        // Never delete a shot with a paid generation attached.
        if ((await c.query("SELECT id FROM assignment_runs WHERE assignment_id=$1 AND shot_id IS NOT NULL LIMIT 1", [id])).rowCount) throw Error("SHOTS_HAVE_GENERATIONS");
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
  const shotId = kind === "video" || body.shotId ? assignmentId(body.shotId) : null;
  await transaction(async c => {
    requireAssignmentEditor(await ownedAssignment(id, user.openId, c, true));
    if ("assets" in input) {
      for (const reference of input.assets) reference.id = await assetForGeneration(reference.id, user.openId, c, id);
    } else if (input.baseAssetId) input.baseAssetId = await assetForGeneration(input.baseAssetId, user.openId, c, id);
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

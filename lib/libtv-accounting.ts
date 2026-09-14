import { createHash } from "node:crypto";
import { MeeDooUser } from "./auth";
import { query, transaction } from "./db";

const REQUIRED_HEADERS = ["消耗时间", "类型", "模型", "任务详情", "项目名称", "任务 ID", "成员 ID", "成员昵称", "成员备注名", "项目 ID", "积分值"] as const;
const TIME_ZONE = "Asia/Singapore";

type ParsedEntry = {
  entryKey: string;
  sourceRow: number;
  consumedAt: Date;
  entryType: string;
  model: string;
  taskDetails: string;
  projectName: string;
  taskId: string;
  memberId: string;
  memberName: string;
  memberAlias: string;
  projectId: string;
  points: number;
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("CSV_QUOTE_INVALID");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function normalizeTaskId(value: string) {
  const match = /^="(.*)"$/.exec(value.trim());
  return match ? match[1] : value.trim();
}

function parseShanghaiTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseLibTvCsv(bytes: Uint8Array) {
  let text = "";
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new Error("CSV_ENCODING_INVALID"); }
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV_EMPTY");
  if (rows.length > 10_001) throw new Error("CSV_TOO_MANY_ROWS");
  const headers = rows[0];
  if (REQUIRED_HEADERS.some((header, index) => headers[index]?.trim() !== header)) throw new Error("CSV_HEADERS_INVALID");
  const occurrences = new Map<string, number>();
  const entries: ParsedEntry[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const values = rows[index];
    if (!values.some((value) => value.trim())) continue;
    const consumedAt = parseShanghaiTime(values[0] ?? "");
    if (!consumedAt && values[0]?.trim() === "合计") continue;
    const points = Number(values[10]);
    if (!consumedAt || !Number.isInteger(points)) throw new Error(`CSV_ROW_INVALID:${index + 1}`);
    const canonical = REQUIRED_HEADERS.map((_header, column) => values[column]?.trim() ?? "");
    const rowHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    const occurrence = (occurrences.get(rowHash) ?? 0) + 1;
    occurrences.set(rowHash, occurrence);
    entries.push({
      entryKey: `${rowHash}:${occurrence}`,
      sourceRow: index + 1,
      consumedAt,
      entryType: canonical[1],
      model: canonical[2],
      taskDetails: canonical[3],
      projectName: canonical[4],
      taskId: normalizeTaskId(canonical[5]),
      memberId: canonical[6],
      memberName: canonical[7],
      memberAlias: canonical[8],
      projectId: canonical[9],
      points,
    });
  }
  if (!entries.length) throw new Error("CSV_NO_ENTRIES");
  return entries;
}

export async function importLibTvCsv(input: { bytes: Uint8Array; filename: string; packagePoints: number; packageCostCny: number; user: MeeDooUser }) {
  const entries = parseLibTvCsv(input.bytes);
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  const consumedTimes = entries.map((entry) => entry.consumedAt.getTime());
  return transaction(async (client) => {
    const imported = await client.query(`INSERT INTO libtv_imports(file_hash,original_filename,imported_by,package_points,package_cost_cny,source_row_count,first_consumed_at,last_consumed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(file_hash) DO NOTHING RETURNING file_hash`, [fileHash, input.filename, input.user.openId, input.packagePoints, input.packageCostCny, entries.length, new Date(Math.min(...consumedTimes)), new Date(Math.max(...consumedTimes))]);
    let inserted = 0;
    if (imported.rowCount) {
      for (let offset = 0; offset < entries.length; offset += 500) {
        const batch = entries.slice(offset, offset + 500);
        const values = batch.flatMap(entry => [entry.entryKey, fileHash, entry.sourceRow, entry.consumedAt, entry.entryType, entry.model || null, entry.taskDetails || null, entry.projectName || null, entry.taskId || null, entry.memberId || null, entry.memberName || null, entry.memberAlias || null, entry.projectId || null, entry.points]);
        const placeholders = batch.map((_, row) => `(${Array.from({length:14}, (_, col) => `$${row * 14 + col + 1}`).join(",")})`).join(",");
        const result = await client.query(`INSERT INTO libtv_credit_entries(entry_key,import_hash,source_row,consumed_at,entry_type,model,task_details,project_name,task_id,member_id,member_name,member_alias,project_id,points) VALUES ${placeholders} ON CONFLICT(entry_key) DO NOTHING`, values);
        inserted += result.rowCount ?? 0;
      }
      await client.query("UPDATE libtv_imports SET imported_row_count=$2 WHERE file_hash=$1", [fileHash, inserted]);
    }
    await client.query(`INSERT INTO libtv_accounting_settings(singleton,package_points,package_cost_cny,updated_by,updated_at) VALUES(true,$1,$2,$3,now())
      ON CONFLICT(singleton) DO UPDATE SET package_points=excluded.package_points,package_cost_cny=excluded.package_cost_cny,updated_by=excluded.updated_by,updated_at=now()`, [input.packagePoints, input.packageCostCny, input.user.openId]);
    return { duplicateFile: !imported.rowCount, sourceRows: entries.length, importedRows: inserted, fileHash };
  });
}

function weekWindow(value?: string | null) {
  const parsed = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+08:00`) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return { weekStart: value!, start: parsed, end: new Date(parsed.getTime() + 7 * 86400000) };
  return null;
}

const normalizeName = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export async function saveLibTvMemberMapping(input: { memberId: string; uploaderOpenId: string; user: MeeDooUser }) {
  if (!input.memberId.trim() || !input.uploaderOpenId.trim()) throw new Error("MAPPING_INVALID");
  const uploader = await query<{ open_id: string }>("SELECT open_id FROM meedoo_users WHERE open_id=$1", [input.uploaderOpenId]);
  if (!uploader.rowCount) throw new Error("MAPPING_UPLOADER_NOT_FOUND");
  await query(`INSERT INTO libtv_member_mappings(member_id,uploader_open_id,updated_by,updated_at) VALUES($1,$2,$3,now())
    ON CONFLICT(member_id) DO UPDATE SET uploader_open_id=excluded.uploader_open_id,updated_by=excluded.updated_by,updated_at=now()`, [input.memberId, input.uploaderOpenId, input.user.openId]);
}

export async function getLibTvAccounting(requestedWeek?: string | null) {
  const weeks = await query<{ week_start: string }>(`SELECT DISTINCT to_char(date_trunc('week',consumed_at AT TIME ZONE '${TIME_ZONE}'),'YYYY-MM-DD') week_start
    FROM libtv_credit_entries WHERE points<0 AND member_id IS NOT NULL AND member_id<>'0' ORDER BY week_start DESC`);
  const selectedWeek = weekWindow(requestedWeek) ?? weekWindow(weeks.rows[0]?.week_start);
  const settings = await query<{ package_points: number; package_cost_cny: string; updated_at: string }>("SELECT package_points,package_cost_cny,updated_at FROM libtv_accounting_settings WHERE singleton=true");
  const setting = settings.rows[0] ? { packagePoints: Number(settings.rows[0].package_points), packageCostCny: Number(settings.rows[0].package_cost_cny), updatedAt: settings.rows[0].updated_at } : null;
  const uploaders = await query<{ open_id: string; name: string }>("SELECT open_id,name FROM meedoo_users ORDER BY name");
  const mappings = await query<{ member_id: string; uploader_open_id: string }>("SELECT member_id,uploader_open_id FROM libtv_member_mappings");
  const mappingByMember = new Map(mappings.rows.map((row) => [row.member_id, row.uploader_open_id]));
  const uploaderNameById = new Map(uploaders.rows.map((row) => [row.open_id, row.name]));
  if (!selectedWeek) return { period: null, availableWeeks: weeks.rows.map((row) => row.week_start), setting, uploaders: uploaders.rows, members: [], videos: [], totals: { points: 0, costCny: null, videoCount: 0 } };
  const entries = await query<{ member_id: string; member_name: string; member_alias: string | null; entry_type: string; model: string | null; points: number | string }>(`SELECT member_id,member_name,member_alias,entry_type,model,points
    FROM libtv_credit_entries WHERE consumed_at >= $1 AND consumed_at < $2 AND points<0 AND member_id IS NOT NULL AND member_id<>'0' AND COALESCE(member_name,'')<>''`, [selectedWeek.start.toISOString(), selectedWeek.end.toISOString()]);
  const uploads = await query<{ id: string; title: string; uploader_open_id: string | null; uploader_name: string; created_at: string }>(`SELECT id::text,title,uploader_open_id,COALESCE(uploader_name,'Historical import') uploader_name,created_at
    FROM uploads WHERE review_status='approved' AND removed_at IS NULL AND created_at >= $1 AND created_at < $2 ORDER BY created_at DESC`, [selectedWeek.start.toISOString(), selectedWeek.end.toISOString()]);
  const grouped = new Map<string, typeof entries.rows>();
  for (const entry of entries.rows) grouped.set(entry.member_id, [...(grouped.get(entry.member_id) ?? []), entry]);
  const costPerPoint = setting ? setting.packageCostCny / setting.packagePoints : null;
  const members = [...grouped.entries()].map(([memberId, rows]) => {
    const memberName = rows[0].member_alias?.trim() || rows[0].member_name;
    const mappedUploaderOpenId = mappingByMember.get(memberId) ?? null;
    const memberUploads = uploads.rows.filter((upload) => mappedUploaderOpenId ? upload.uploader_open_id === mappedUploaderOpenId : normalizeName(upload.uploader_name) === normalizeName(memberName));
    const points = rows.reduce((sum, row) => sum + Math.abs(Number(row.points)), 0);
    const modelGroups = new Map<string, { tasks: number; points: number }>();
    for (const row of rows) {
      const key = row.model?.trim() || row.entry_type;
      const current = modelGroups.get(key) ?? { tasks: 0, points: 0 };
      current.tasks += 1;
      current.points += Math.abs(Number(row.points));
      modelGroups.set(key, current);
    }
    const perVideoPoints = memberUploads.length ? points / memberUploads.length : null;
    return {
      memberId, memberName, mappedUploaderOpenId, mappedUploaderName: mappedUploaderOpenId ? uploaderNameById.get(mappedUploaderOpenId) ?? null : null,
      taskCount: rows.length, points, costCny: costPerPoint === null ? null : points * costPerPoint,
      videoCount: memberUploads.length, perVideoPoints, perVideoCostCny: perVideoPoints === null || costPerPoint === null ? null : perVideoPoints * costPerPoint,
      models: [...modelGroups.entries()].map(([model, values]) => ({ model, ...values })).sort((left, right) => right.points - left.points),
      matched: memberUploads.length > 0,
    };
  }).sort((left, right) => right.points - left.points);
  const videos = uploads.rows.map((upload) => {
    const member = members.find((item) => item.mappedUploaderOpenId ? item.mappedUploaderOpenId === upload.uploader_open_id : normalizeName(item.memberName) === normalizeName(upload.uploader_name));
    return { ...upload, allocatedPoints: member?.perVideoPoints ?? null, allocatedCostCny: member?.perVideoCostCny ?? null };
  });
  const totalPoints = members.reduce((sum, member) => sum + member.points, 0);
  return {
    period: { weekStart: selectedWeek.weekStart, start: selectedWeek.start.toISOString(), end: selectedWeek.end.toISOString(), timeZone: TIME_ZONE },
    availableWeeks: weeks.rows.map((row) => row.week_start), setting, uploaders: uploaders.rows, members, videos,
    totals: { points: totalPoints, costCny: costPerPoint === null ? null : totalPoints * costPerPoint, videoCount: uploads.rows.length },
  };
}

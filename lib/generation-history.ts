import { query } from "./db";
import { generationApprover } from "./generation";
import { seedreamSchema } from "./seedream";
import { historyPage, pagination } from "./generation-pagination";
import { uuidPattern } from "./generation-model";
export async function requireTeamHistory(userId:string) {
  if(!await generationApprover(userId))throw Error("FORBIDDEN");
  await seedreamSchema();
}
const historySQL=`SELECT 'video'::text kind,t.id,t.owner_id,t.owner_name,t.input,t.input->>'model' model,t.status,t.usage,t.error_code,t.provider_error,t.created_at,
 (t.media_deleted_at IS NOT NULL OR COALESCE(t.media_expires_at<=now(),false)) expired,
 (t.media_path IS NOT NULL AND t.media_deleted_at IS NULL AND t.media_expires_at>now()) available
 FROM generation_tasks t
 UNION ALL
 SELECT 'image'::text kind,t.id,t.owner_id,u.name owner_name,t.input,t.model,t.status,t.usage,t.error_code,t.provider_error,t.created_at,
 COALESCE(a.file_deleted OR a.expires_at<=now(),false) expired,
 (a.id IS NOT NULL AND NOT a.file_deleted AND (a.expires_at IS NULL OR a.expires_at>now())) available
 FROM seedream_tasks t JOIN meedoo_users u ON u.open_id=t.owner_id LEFT JOIN generation_assets a ON a.id=t.asset_id`;
export async function teamGenerationHistory(userId:string,requestedPage:unknown=1,kind="all") {
 const page=historyPage(requestedPage);if(!["all","video","image"].includes(kind))throw Error("INVALID_INPUT");
 await requireTeamHistory(userId);
 const filter=" WHERE ($1='all' OR kind=$1)";
 const total=Number((await query(`SELECT count(*) n FROM (${historySQL}) h`+filter,[kind])).rows[0].n);
 const paging=pagination(total,page,20);
 const rows=(await query(`SELECT * FROM (${historySQL}) h`+filter+" ORDER BY created_at DESC,id DESC,kind LIMIT $2 OFFSET $3",[kind,paging.pageSize,(paging.page-1)*paging.pageSize])).rows;
 return {pagination:paging,tasks:rows.map(t=>({...t,mediaUrl:t.available?(t.kind==='video'?`/api/generation/${t.id}/media`:`/api/generation/team-history/${t.id}/image`):null}))};
}
export async function teamGenerationImage(userId:string,id:string) {
 if(!uuidPattern.test(id))throw Error("NOT_FOUND");await requireTeamHistory(userId);
 const row=(await query("SELECT a.id,a.path,a.mime FROM seedream_tasks t JOIN generation_assets a ON a.id=t.asset_id WHERE t.id=$1 AND t.status='succeeded' AND NOT a.file_deleted AND (a.expires_at IS NULL OR a.expires_at>now())",[id])).rows[0];
 if(!row)throw Error("NOT_FOUND");return row;
}

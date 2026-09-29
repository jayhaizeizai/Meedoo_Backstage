import { query, transaction } from "../db";
import { assignmentSchema } from "./schema";
import { ownedAssignment, requireAssignmentEditor, assetForGeneration } from "./data";
import { assignmentId } from "./model";
import { generationModels } from "../generation-model";
import { providerConfigured } from "../generation-provider";
import { historyPage, pagination } from "../generation-pagination";

export async function shotAccess(owner:string,id:string,shot:string,edit=false) {
  assignmentId(shot); await assignmentSchema();
  const task=await ownedAssignment(id,owner); if(edit)requireAssignmentEditor(task);
  if(!(await query("SELECT id FROM assignment_shots WHERE assignment_id=$1 AND id=$2",[id,shot])).rowCount)throw Error("NOT_FOUND");
  return task;
}
export async function shotAssets(owner:string,id:string,ids:unknown) {
  if(!Array.isArray(ids)||ids.length>36)throw Error("INVALID_INPUT");
  return transaction(async c=>{
    requireAssignmentEditor(await ownedAssignment(id,owner,c,true));
    const assets=[];
    for(const sourceId of ids){
      assignmentId(sourceId);
      try{const assetId=await assetForGeneration(sourceId,owner,c,id);
        const row=(await c.query("SELECT filename FROM generation_assets WHERE id=$1",[assetId])).rows[0];
        assets.push({id:assetId,sourceId,name:row.filename,url:`/api/generation/assets/${assetId}`});
      }catch(e){if(!(e instanceof Error)||e.message!=="INVALID_ASSETS")throw e;}
    }
    return assets;
  });
}
export async function shotVideo(id:string,shot:string,video:string) {
  assignmentId(video);
  const row=(await query("SELECT g.* FROM generation_tasks g JOIN assignment_runs r ON r.id=g.request_id AND r.owner_id=g.owner_id WHERE r.assignment_id=$1 AND r.shot_id=$2 AND r.kind='video' AND g.id=$3",[id,shot,video])).rows[0];
  if(!row)throw Error("NOT_FOUND"); return row;
}
export async function shotHistory(owner:string,id:string,shot:string,page:unknown,images:boolean) {
  const rows=images ? (await query(`SELECT t.id,t.input,t.model,t.status,t.error_code,t.provider_error,t.created_at,t.usage,t.asset_id,a.filename,
    (a.file_deleted OR (a.expires_at IS NOT NULL AND a.expires_at<=now())) expired
    FROM assignment_runs r JOIN seedream_tasks t ON t.request_id=r.id AND t.owner_id=r.owner_id LEFT JOIN generation_assets a ON a.id=t.asset_id
    WHERE r.assignment_id=$1 AND r.shot_id=$2 AND r.kind='storyboard' ORDER BY t.created_at DESC,t.id DESC`,[id,shot])).rows.map(t=>({...t,asset:t.asset_id&&!t.expired?{id:t.asset_id,name:t.filename,url:`/api/assignments/${id}/media/${t.asset_id}`}:null}))
    : (await query(`SELECT t.id,t.owner_name,t.requirement,t.input,t.status,t.usage,t.error_code,t.provider_error,t.created_at,t.media_expires_at,
    (t.media_deleted_at IS NOT NULL OR COALESCE(t.media_expires_at<=now(),false)) expired,
    (t.media_path IS NOT NULL AND t.media_deleted_at IS NULL AND t.media_expires_at>now()) available
    FROM assignment_runs r JOIN generation_tasks t ON t.request_id=r.id AND t.owner_id=r.owner_id
    WHERE r.assignment_id=$1 AND r.shot_id=$2 AND r.kind='video' ORDER BY t.created_at DESC,t.id DESC`,[id,shot])).rows;
  const paging=pagination(rows.length,historyPage(page),images?12:20);
  const result={tasks:rows.slice((paging.page-1)*paging.pageSize,paging.page*paging.pageSize),pagination:paging};
  if(images){const uploads=(await query("SELECT id,filename FROM generation_assets WHERE owner_id=$1 AND mime LIKE 'image/%' AND expires_at IS NULL AND NOT file_deleted ORDER BY created_at DESC LIMIT 100",[owner])).rows.map(a=>({id:a.id,name:a.filename,url:`/api/generation/assets/${a.id}`}));
    return {...result,configured:Boolean(process.env.ARK_API_KEY),recentTasks:rows,uploads};}
  return {...result,configured:Boolean(process.env.MINIMAX_API_KEY||process.env.ARK_API_KEY),models:Object.keys(generationModels).filter(providerConfigured),ownTasks:rows};
}

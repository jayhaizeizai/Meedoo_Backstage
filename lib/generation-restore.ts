import { query } from "./db";
import { generationSchema } from "./generation";
import { uuidPattern } from "./generation-model";
export async function resolveGenerationAssets(owner:string, ids:unknown) {
  if(!Array.isArray(ids)||ids.length>30||ids.some(id=>typeof id!=="string"||!uuidPattern.test(id)))throw Error("INVALID_INPUT");
  await generationSchema();
  const rows=(await query("SELECT id,filename FROM generation_assets WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND NOT file_deleted AND (expires_at IS NULL OR expires_at>now())",[owner,ids])).rows;
  return rows.map(a=>({id:a.id,name:a.filename,url:`/api/generation/assets/${a.id}`}));
}
export async function restoreFailedGeneration(owner:string,id:string) {
  if(!uuidPattern.test(id))throw Error("NOT_FOUND");
  await generationSchema();
  const task=(await query("SELECT input FROM generation_tasks WHERE id=$1 AND owner_id=$2 AND status='failed'",[id,owner])).rows[0];
  if(!task)throw Error("NOT_FOUND");
  const found=await resolveGenerationAssets(owner,task.input.assets.map((a:{id:string})=>a.id));
  const assets=task.input.assets.flatMap((a:{id:string;role:string})=>{const image=found.find(f=>f.id===a.id);return image?[{...image,role:a.role}]:[];});
  return {input:task.input,assets,missing:task.input.assets.length-assets.length};
}

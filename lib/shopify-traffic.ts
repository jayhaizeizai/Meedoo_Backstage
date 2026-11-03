import { db, ensureSchema, query } from "./db";
import { shopifyConfig, shopifyGraphql } from "./shopify-client";
import { parseTraffic, trafficQuery, type TrafficRow } from "./shopify-traffic-data";

async function schema() {
  await ensureSchema();
  await db().query(`CREATE TABLE IF NOT EXISTS shopify_traffic_cache (
    shop text PRIMARY KEY, from_day text NOT NULL, to_day text NOT NULL,
    synced_at timestamptz NOT NULL, rows jsonb NOT NULL)`);
}
const day=(date:Date)=>{const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');};
export async function syncShopifyTraffic() {
  const config=shopifyConfig();if(!config)return {configured:false};
  await schema();const client=await db().connect();let locked=false;
  try {
    locked=(await client.query('SELECT pg_try_advisory_lock(7241912) locked')).rows[0].locked;
    if(!locked)return {alreadyRunning:true};
    const now=new Date(),from=day(new Date(now.getTime()-58*86400000)),to=day(now);
    const response=await shopifyGraphql<{shopifyqlQuery:Parameters<typeof parseTraffic>[0]}>(
      `query BackstageTraffic($query: String!) { shopifyqlQuery(query:$query) { parseErrors tableData { columns { name } rows } } }`,{query:trafficQuery(from,to)});
    const rows=parseTraffic(response.shopifyqlQuery,from,to);
    await client.query(`INSERT INTO shopify_traffic_cache(shop,from_day,to_day,synced_at,rows) VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(shop) DO UPDATE SET from_day=EXCLUDED.from_day,to_day=EXCLUDED.to_day,synced_at=EXCLUDED.synced_at,rows=EXCLUDED.rows`,[config.shop,from,to,now,JSON.stringify(rows)]);
    return {configured:true,days:59,syncedAt:now.toISOString()};
  } finally {let discard=false;if(locked){try{await client.query('SELECT pg_advisory_unlock(7241912)');}catch{discard=true;}}client.release(discard);}
}
export async function shopifyTrafficSummary(from:string,to:string,platform:string,owner:string) {
  const config=shopifyConfig();if(!config)return {ready:false};
  await schema();
  const cache=(await query<{from_day:string;to_day:string;synced_at:Date;rows:TrafficRow[]}>('SELECT * FROM shopify_traffic_cache WHERE shop=$1',[config.shop])).rows[0];
  if(!cache)return {ready:false};
  if(from<cache.from_day || to>cache.to_day)return {ready:true,covered:false,syncedAt:cache.synced_at};
  const candidates=cache.rows.filter(r=>r.day>=from&&r.day<=to&&(platform==='all'||r.platform===platform));
  const ids=[...new Set(candidates.map(r=>r.videoId).filter((v):v is string=>v!==null))];
  const uploads=ids.length ? (await query<{id:string;uploader_open_id:string;target_platforms:string[]}>("SELECT id,uploader_open_id,target_platforms FROM uploads WHERE id=ANY($1::uuid[]) AND review_status='approved'",[ids])).rows:[];
  const matches=new Map(uploads.map(u=>[u.id,u]));
  let sessions=0,pageviews=0,attributedSessions=0;
  for(const r of candidates){const u=r.videoId?matches.get(r.videoId):undefined;const valid=u?.target_platforms.includes(r.platform??'');if(owner!=='all'&&(!valid||u?.uploader_open_id!==owner))continue;sessions+=r.sessions;pageviews+=r.pageviews;if(valid)attributedSessions+=r.sessions;}
  return {ready:true,covered:true,syncedAt:cache.synced_at,sessions,pageviews,attributedSessions};
}

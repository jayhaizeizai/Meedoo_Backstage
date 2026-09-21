import type { SocialPlatform } from "./social-platforms";
export type DailySnapshot<K extends string> = { publicationId:string; platform:SocialPlatform; capturedAt:string; metrics:Record<K,number|null> };
// Real end-of-day samples only: never sum repeated syncs or fill missing days.
export function dailyPlatformHistory<K extends string>(snapshots:DailySnapshot<K>[], platforms:readonly SocialPlatform[], keys:readonly K[], now=new Date(), days=30) {
  const singaporeDay=(date:number)=>new Date(date+8*3600000).toISOString().slice(0,10);
  const today=singaporeDay(now.getTime()), start=Date.parse(today+"T00:00:00+08:00")-(days-1)*86400000;
  const latest=new Map<string,{time:number;snapshot:DailySnapshot<K>}>();
  for(const snapshot of snapshots){
    const time=Date.parse(snapshot.capturedAt);
    if(!Number.isFinite(time)||time<start||time>now.getTime()||!platforms.includes(snapshot.platform))continue;
    const key=`${singaporeDay(time)}:${snapshot.publicationId}`;
    if(!latest.has(key)||latest.get(key)!.time<=time)latest.set(key,{time,snapshot});
  }
  const byDay=new Map<string,DailySnapshot<K>[]>();
  for(const {time,snapshot} of latest.values()){const day=singaporeDay(time);const group=byDay.get(day)??[];group.push(snapshot);byDay.set(day,group);}
  return Array.from({length:days},(_,i)=>{
    const day=singaporeDay(start+i*86400000), samples=byDay.get(day)??[];
    return {day,platforms:platforms.map(platform=>({platform,metrics:Object.fromEntries(keys.map(key=>{
      const values=samples.filter(s=>s.platform===platform).map(s=>s.metrics[key]).filter((v):v is number=>v!==null&&Number.isFinite(v));
      return [key,values.length?values.reduce((sum,v)=>sum+v,0):null];
    })) as Record<K,number|null>}))};
  });
}

import { supportedPlatforms } from "./social-platforms";

export type TrafficRow = { day: string; platform: string | null; videoId: string | null; sessions: number; pageviews: number };
export function trafficQuery(from: string, to: string) {
  if (![from,to].every(s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s) || from>to) throw Error("SHOPIFY_TRAFFIC_DATE_INVALID");
  return `FROM sessions SHOW sessions, pageviews
    WHERE human_or_bot_session = 'human'
    GROUP BY day, utm_source, utm_medium, utm_campaign, utm_content
    WITH TIMEZONE 'Asia/Singapore'
    SINCE ${from} UNTIL ${to}
    ORDER BY day ASC LIMIT 10000`;
}

export function parseTraffic(data: {parseErrors?: string[]; tableData?: {columns: {name: string}[]; rows: unknown[]} | null}, from: string, to: string): TrafficRow[] {
  if (data.parseErrors?.length || !data.tableData) throw Error("SHOPIFY_TRAFFIC_QUERY_FAILED");
  const {columns, rows}=data.tableData;
  const names=columns.map(c=>c.name);
  for(const key of ['day','utm_source','utm_medium','utm_campaign','utm_content','sessions','pageviews']) if(!names.includes(key)) throw Error("SHOPIFY_TRAFFIC_COLUMNS_INVALID");
  if(rows.length>=10000) throw Error("SHOPIFY_TRAFFIC_LIMIT_REACHED");
  const result=new Map<string,TrafficRow>();
  for(const raw of rows) {
    const r=Array.isArray(raw) ? Object.fromEntries(names.map((n,i)=>[n,raw[i]])) : raw as Record<string,unknown>;
    if(!r || typeof r!=='object') throw Error("SHOPIFY_TRAFFIC_ROW_INVALID");
    const day=String(r.day).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || day<from || day>to) throw Error("SHOPIFY_TRAFFIC_DAY_INVALID");
    const count=(key:string)=>{const v=r[key]; if(v===null || v===undefined || v==='')throw Error("SHOPIFY_TRAFFIC_METRIC_MISSING");const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error("SHOPIFY_TRAFFIC_METRIC_INVALID");return n;};
    const source=String(r.utm_source??'').toLowerCase();
    const platform=supportedPlatforms.some(p=>p===source)?source:null;
    const content=String(r.utm_content??'');
    const videoId=platform && r.utm_campaign==='meedoo_video' && r.utm_medium==='organic_social' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(content) ? content.toLowerCase():null;
    // Persist aggregate counts and known platform/video identifiers, not arbitrary UTM text.
    const key=JSON.stringify([day,platform,videoId]);
    const prior=result.get(key)??{day,platform,videoId,sessions:0,pageviews:0};
    prior.sessions+=count('sessions');prior.pageviews+=count('pageviews');result.set(key,prior);
  }
  return [...result.values()];
}

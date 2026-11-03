"use client";
import { useEffect, useState } from "react";
import { useLanguage } from "./language-provider";
import { isVisibleUploader } from "../lib/uploader-filter";

type Row = { currency: string; channel: string; owner_id: string | null; owner: string | null; revenue: string; refunds: string; net_revenue: string; orders: number };
type Summary = { configured: boolean; ready?: boolean; covered?: boolean; syncedAt?: string; rows: Row[] };
export function ShopifySummary({from,to,platform,owner}: {from:string;to:string;platform:string;owner:string}) {
  const {text}=useLanguage();
  const [data,setData]=useState<Summary|null>(null), [error,setError]=useState(false);
  useEffect(()=>{
    const controller=new AbortController(); setData(null);setError(false);
    if (!from || !to || from>to) return ()=>controller.abort();
    fetch(`/api/shopify?${new URLSearchParams({from,to,platform,owner})}`,{signal:controller.signal,cache:"no-store"})
      .then(async r=>{if(!r.ok)throw Error();return r.json();}).then(setData)
      .catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[from,to,platform,owner]);
  const money=(s:string,c:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency:c}).format(Number(s));
  return <section className="card analytics-table-card"><h2>{text("Shopify 订单与收入","Shopify Orders & Revenue")}</h2>
    {error ? <p role="alert">{text("Shopify 数据暂不可用。","Shopify data is temporarily unavailable.")}</p> : !data ? <p>{text("正在读取…","Loading…")}</p> : !data.configured ? <p>{text("等待店铺 API 授权。","Waiting for store API authorization.")}</p> : !data.ready ? <p>{text("等待首次同步。","Waiting for the first sync.")}</p> : !data.covered ? <p>{text("所选日期超出已同步的完整订单范围，请缩短至最近 58 天内。","Selected dates exceed complete order coverage. Choose a range within the last 58 days.")}</p> : <>
      <p className="analytics-note">{text("按订单创建日期（新加坡时间）统计实收金额减累计退款，包含税费与运费；与 Shopify 净销售额口径不同。视频归因使用订单最后一次访问的 UTM。网站访问量尚未接入。","By order creation date (Singapore time): payments received minus lifetime refunds, including tax and shipping; differs from Shopify net sales. Video attribution uses the last visit UTM. Website visits are not connected.")}</p>
      <div className="analytics-table-scroll"><table className="analytics-table"><thead><tr>{[text("归属","Attribution"),text("币种","Currency"),text("实收金额","Revenue Received"),text("退款","Refunds"),text("净收入","Net Revenue"),text("订单数","Orders")].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
        {data.rows.map((r,i)=><tr key={i}><th>{r.channel==="organic" ? (r.owner && isVisibleUploader(r.owner) ? r.owner : text("历史成员","Historical members")) : text("未归因至视频","Not attributed to a video")}</th><td>{r.currency}</td><td>{money(r.revenue,r.currency)}</td><td>{money(r.refunds,r.currency)}</td><td>{money(r.net_revenue,r.currency)}</td><td>{r.orders}</td></tr>)}
        {!data.rows.length && <tr><td colSpan={6}>{text("此范围内没有已收款的非测试订单。","No paid, non-test orders in this range.")}</td></tr>}
      </tbody></table></div>
      <p className="analytics-note">{text("最近同步：","Last synced: ")}{new Date(data.syncedAt!).toLocaleString(undefined,{timeZone:"Asia/Singapore"})}</p>
    </>}
  </section>;
}

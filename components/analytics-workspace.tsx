"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "./app-shell";
import { useAuth } from "./auth-provider";
import { useLanguage } from "./language-provider";
import { platformMeta, type SocialPlatform } from "../lib/social-platforms";
import { isVisibleUploader } from "../lib/uploader-filter";
import { aggregateContentPerformance, performanceKeys, type ContentPerformance, type PerformanceKey } from "../lib/content-performance";

type Publication = { platform: SocialPlatform; url: string | null; status: string; error: string | null; contentMetrics: ContentPerformance };
type Video = { id: string; title: string; ownerId: string | null; owner: string; createdAt: string; platforms: Publication[] };
type Data = { updatedAt: string; videos: Video[] };
const labels: Record<PerformanceKey, [string, string]> = {
  views: ["浏览量", "Views"], averageRetention: ["平均留存", "Average Retention"], reposts: ["转发", "Reposts"], shares: ["分享", "Shares"], saves: ["收藏", "Bookmark"], comments: ["评论", "Comments"], likes: ["点赞", "Likes"],
};
const ownerKey = (v: Video) => v.ownerId ?? `name:${v.owner}`;
const singaporeDay = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
function format(value: number | null, key?: PerformanceKey) {
  return value === null ? "—" : key === "averageRetention" ? `${value.toFixed(1)}%` : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
export function AnalyticsWorkspace({ mode }: { mode: "team" | "content" }) {
  const { text } = useLanguage();
  const { enabledPlatforms } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState("all");
  const [owner, setOwner] = useState("all");
  const [from, setFrom] = useState(() => singaporeDay(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => singaporeDay(new Date()));
  const [sort, setSort] = useState<PerformanceKey | "createdAt">("createdAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [syncing, setSyncing] = useState(false);
  const [retrying, setRetrying] = useState("");
  const [page, setPage] = useState(1);
  const minDate = singaporeDay(new Date(Date.now() - 364 * 86400000));
  async function load(signal?: AbortSignal) {
    const r = await fetch("/api/dashboard?days=365", { cache: "no-store", signal });
    const d = await r.json(); if (!r.ok || !d.success) throw Error(d.message || "Dashboard unavailable"); setData(d);
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, []);
  useEffect(() => setPage(1), [platform, owner, from, to, sort, direction]);
  const uploaders = useMemo(() => [...new Map((data?.videos ?? []).filter(v => isVisibleUploader(v.owner)).map(v => [ownerKey(v), v.owner])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data]);
  const invalidDates = Boolean(from && to && from > to) || Boolean(from && from < minDate) || Boolean(to && to < minDate);
  const selected = useMemo(() => {
    if (invalidDates) return [];
    return (data?.videos ?? []).filter(v => {
      const day = singaporeDay(new Date(v.createdAt));
      return (!from || day >= from) && (!to || day <= to) && (owner === "all" || ownerKey(v) === owner);
    }).map(v => ({ ...v, platforms: v.platforms.filter(p => enabledPlatforms.includes(p.platform) && (platform === "all" || p.platform === platform)) })).filter(v => v.platforms.length > 0).map(v => ({ ...v, metrics: aggregateContentPerformance(v.platforms.map(p => p.contentMetrics)) }));
  }, [data, from, to, owner, platform, enabledPlatforms, invalidDates]);
  const total = aggregateContentPerformance(selected.flatMap(v => v.platforms.map(p => p.contentMetrics)));
  const members = useMemo(() => {
    const groups = new Map<string, { name: string; metrics: ContentPerformance[] }>();
    for (const v of selected) {
      const hidden = !isVisibleUploader(v.owner), key = hidden ? "historical" : ownerKey(v);
      const row = groups.get(key) ?? { name: hidden ? "" : v.owner, metrics: [] };
      row.metrics.push(...v.platforms.map(p => p.contentMetrics)); groups.set(key, row);
    }
    return [...groups].map(([id, row]) => ({ id, name: row.name, metrics: aggregateContentPerformance(row.metrics) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [selected]);
  const sorted = [...selected].sort((a, b) => { const av = sort === "createdAt" ? Date.parse(a.createdAt) : a.metrics[sort], bv = sort === "createdAt" ? Date.parse(b.createdAt) : b.metrics[sort]; if (av === null) return bv === null ? 0 : 1; if (bv === null) return -1; return direction === "desc" ? bv - av : av - bv; });
  const pages = Math.max(1, Math.ceil(sorted.length / 25)), currentPage = Math.min(page, pages);
  async function sync() { setSyncing(true); setError(""); try { const r = await fetch("/api/upload-post/sync", { method: "POST" }); if (!r.ok) throw Error(text("同步失败", "Sync failed")); await load(); } catch(e) { setError(e instanceof Error ? e.message : "Sync failed"); } finally { setSyncing(false); } }
  async function retry(id: string, p: string) { setRetrying(`${id}:${p}`); setError(""); try { const r = await fetch("/api/upload-post/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({uploadId: id, platform: p}) }); const d = await r.json(); if (!r.ok) throw Error(d.message || "Retry failed"); await load(); } catch(e) { setError(e instanceof Error ? e.message : "Retry failed"); } finally { setRetrying(""); } }
  const metricHeaders = performanceKeys.map(key => <th key={key} scope="col" title={key === "averageRetention" ? text("按浏览量加权的平均观看比例；仅统计有数据的视频，不是留存曲线评分。", "View-weighted average watch percentage for videos with data; not the retention curve score.") : undefined}>{text(...labels[key])}</th>);
  const cells = (metrics: ContentPerformance) => performanceKeys.map(key => <td key={key}>{format(metrics[key], key)}</td>);
  const name = (row: typeof members[number]) => row.id === "historical" ? text("历史成员", "Historical members") : row.name;
  return <AppShell active={mode === "team" ? "dashboard" : "content-analysis"} status={{ zh: data ? `更新于 ${new Date(data.updatedAt).toLocaleString("zh-CN", {timeZone:"Asia/Singapore"})}` : "正在读取数据", en: data ? `Updated ${new Date(data.updatedAt).toLocaleString("en-US", {timeZone:"Asia/Singapore"})}` : "Loading data" }}>
    <section className="page analytics-workspace">
      <div className="head analytics-head"><div><p className="eyebrow">MEEDOO ANALYTICS</p><h1>{mode === "team" ? text("团队看板", "Team Dashboard") : text("内容分析", "Content Analysis")}</h1></div>
        <div className="analytics-controls">
          <label>{text("选择平台", "Select Platform")}<select value={platform} onChange={e => setPlatform(e.target.value)}><option value="all">{text("全部平台", "All")}</option>{enabledPlatforms.map(p => <option key={p} value={p}>{platformMeta[p].name}</option>)}</select></label>
          <label>{text("选择成员", "Select Name")}<select value={owner} onChange={e => setOwner(e.target.value)}><option value="all">{text("所有人", "Everyone")}</option>{uploaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>{text("开始日期", "From")}<input type="date" min={minDate} max={to || undefined} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>{text("结束日期", "To")}<input type="date" min={from || minDate} value={to} onChange={e => setTo(e.target.value)} /></label>
          <button type="button" disabled={syncing} onClick={() => void sync()}>{syncing ? "…" : "↻"} {text("同步", "Sync")}</button>
        </div>
      </div>
      <p className="analytics-note">{text("按新加坡时间筛选上传日期，展示对应视频的累计数据；支持最近一年。— 表示暂无数据。", "Upload dates use Singapore time; metrics are lifetime totals for selected videos. Up to one year available. — means unavailable.")}</p>
      {error && <div className="data-message error" role="alert">{error}</div>}
      {invalidDates && <div className="data-message error" role="alert">{text("请选择最近一年内有效的起止日期。", "Choose a valid date range within the last year.")}</div>}
      {!data && !error && <div className="data-message">{text("正在载入…", "Loading…")}</div>}
      {data && !invalidDates && (mode === "team" ? <>
        <section className="card analytics-table-card"><h2>{text("渠道与销售表现", "Channel & Sales Performance")}</h2><div className="analytics-table-scroll"><table className="analytics-table"><thead><tr>{[text("表现", "Performance"), "Views", text("网站访问", "Website Visits"), text("净收入", "Net Revenue"), text("订单数", "Number of Orders"), text("退款", "Refunds")].map((h,i) => <th key={h} scope="col" title={i === 3 ? text("销售额 − 退款", "Revenue − Refunds") : undefined}>{h}</th>)}</tr></thead><tbody>
          <tr className="analytics-total"><th scope="row">{text("团队总计", "Team Total")}</th>{Array.from({length:5},(_,i)=><td key={i}>—</td>)}</tr>
          <tr className="analytics-organic"><th scope="row">{text("自然流量总计", "Organic Total")}</th><td>{format(total.views)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>
          {members.map(row => <tr key={row.id}><th scope="row" className="analytics-member">{name(row)}</th><td>{format(row.metrics.views)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>)}
          {[["创作者", "Creators"],["付费广告", "Paid Ads"],["Google 搜索", "Google Search"],["AI 搜索", "AI Search"],["其他", "Other"]].map(([zh,en]) => <tr key={en}><th scope="row">{text(zh,en)}</th>{Array.from({length:5},(_,i)=><td key={i}>—</td>)}</tr>)}
        </tbody></table></div><p className="analytics-note">{text("净收入 = 销售额 − 退款。Shopify 和外部渠道尚未接入，销售指标及全渠道团队总计暂不计算；自然流量为当前已收录视频。", "Net Revenue = Revenue − Refunds. Shopify and external channels are not connected; sales metrics and the all-channel team total are unavailable. Organic includes currently tracked videos.")}</p></section>
        <section className="card analytics-table-card"><h2>{text("团队内容表现", "Team Content Performance")}</h2><div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th scope="col">{text("表现", "Performance")}</th>{metricHeaders}</tr></thead><tbody><tr className="analytics-total"><th scope="row">{text("团队总计", "Team Total")}</th>{cells(total)}</tr>{members.map(row=><tr key={row.id}><th scope="row">{name(row)}</th>{cells(row.metrics)}</tr>)}</tbody></table></div></section>
      </> : <section className="card analytics-table-card">
        <div className="analytics-table-heading"><h2>{text("视频表现", "Video Performance")} <small>({sorted.length})</small></h2><div className="analytics-sort"><label>{text("排序", "Sort by")}<select value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="createdAt">{text("上传日期", "Uploaded")}</option>{performanceKeys.map(k=><option key={k} value={k}>{text(...labels[k])}</option>)}</select></label><button type="button" onClick={()=>setDirection(d=>d==="desc"?"asc":"desc")}>{direction==="desc"?text("降序 ↓","Descending ↓"):text("升序 ↑","Ascending ↑")}</button></div></div>
        <div className="analytics-table-scroll"><table className="analytics-table analytics-videos"><thead><tr><th scope="col">{text("视频", "Video")}</th><th scope="col">{text("上传者", "Uploader")}</th><th scope="col">{text("上传日期", "Uploaded")}</th>{metricHeaders}</tr></thead><tbody>
          {sorted.slice((currentPage-1)*25,currentPage*25).map(v=><tr key={v.id}><td><Link className="analytics-video-title" href={`/dashboard/videos/${v.id}`}>▶ {v.title}</Link><div className="analytics-publications">{v.platforms.map(p=><span key={p.platform}>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{platformMeta[p.platform].name} ↗</a> : platformMeta[p.platform].name}{p.status === "failed" && <button title={p.error ?? undefined} disabled={Boolean(retrying)} onClick={()=>void retry(v.id,p.platform)}>{retrying===`${v.id}:${p.platform}`?"…":text("重试","Retry")}</button>}</span>)}</div></td><td>{v.owner}</td><td>{singaporeDay(new Date(v.createdAt))}</td>{cells(v.metrics)}</tr>)}
          {!sorted.length && <tr><td colSpan={10} className="analytics-empty">{text("此筛选条件下暂无视频。", "No videos match these filters.")}</td></tr>}
        </tbody></table></div>
        <div className="analytics-pagination"><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>{text("上一页", "Previous")}</button><span>{currentPage} / {pages}</span><button disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)}>{text("下一页", "Next")}</button></div>
      </section>)}
    </section>
  </AppShell>;
}

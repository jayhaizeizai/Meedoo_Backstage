"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";

type MetricKey = "views" | "likes" | "retention" | "reposts" | "shares" | "followers" | "saves" | "comments";
type Platform = "tiktok" | "instagram" | "youtube";
type Metrics = Record<MetricKey, number | null>;
type PlatformAggregate = { metrics: Metrics; engagementRate: number | null; videoCount: number; mix: number[] };
type Person = { id: string; name: string; role: string; avatar: string | null; videoCount: number; metrics: Metrics; ratios: Metrics; scores: Metrics; totalScore: number; mix: number[]; engagementRate: number | null };
type VideoPlatform = { platform: Platform; url: string | null; postId: string | null; status: string; error: string | null };
type Video = { id: string; title: string; ownerId: string | null; owner: string; createdAt: string; status: string; platforms: VideoPlatform[]; metrics: Metrics };
type TrendPoint = { capturedAt: string; platforms: Record<Platform, PlatformAggregate> };
type DashboardData = {
  updatedAt: string;
  days: number;
  metricDefinitions: { key: MetricKey; zh: string; en: string; weight: number }[];
  team: { metrics: Metrics; videoCount: number; newFollowers: number | null; mix: number[]; engagementRate: number | null; byPlatform: Record<Platform, PlatformAggregate>; trend: TrendPoint[] };
  people: Person[];
  videos: Video[];
};

const platformMeta: Record<Platform, { name: string; className: string; icon: string }> = {
  tiktok: { name: "TikTok", className: "tt", icon: "♪" },
  instagram: { name: "Instagram", className: "ig", icon: "◎" },
  youtube: { name: "YouTube", className: "yt", icon: "▶" },
};
const allPlatforms = Object.keys(platformMeta) as Platform[];
const palette = ["#6757e8", "#00a884", "#ef8354", "#4f8fe8", "#d55a85"];
const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

function format(value: number | null, key?: MetricKey | "engagementRate" | "totalScore", language: "zh" | "en" = "zh") {
  if (value === null || !Number.isFinite(value)) return "—";
  if (key === "retention" || key === "engagementRate") return `${value.toFixed(key === "engagementRate" ? 2 : 1)}%`;
  if (key === "totalScore") return value.toFixed(1);
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function combinePlatforms(values: PlatformAggregate[]) {
  const metrics = Object.fromEntries((["views", "likes", "retention", "reposts", "shares", "followers", "saves", "comments"] as MetricKey[]).map((key) => {
    const available = values.map((item) => ({ value: item.metrics[key], views: item.metrics.views })).filter((item): item is { value: number; views: number | null } => item.value !== null);
    if (!available.length) return [key, null];
    if (key === "retention") {
      const weighted = available.filter((item): item is { value: number; views: number } => item.views !== null && item.views > 0);
      return [key, weighted.length ? weighted.reduce((sum, item) => sum + item.value * item.views, 0) / weighted.reduce((sum, item) => sum + item.views, 0) : available.reduce((sum, item) => sum + item.value, 0) / available.length];
    }
    return [key, available.reduce((sum, item) => sum + item.value, 0)];
  })) as Metrics;
  const engagement = [metrics.likes, metrics.comments, metrics.shares, metrics.saves, metrics.reposts].filter((value): value is number => value !== null);
  return { metrics, engagementRate: metrics.views && engagement.length ? engagement.reduce((sum, value) => sum + value, 0) / metrics.views * 100 : null };
}

export default function DashboardPage() {
  const { language, text } = useLanguage();
  const [data, setData] = useState<DashboardData | null>(null);
  const [active, setActive] = useState("team");
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(async () => {
    setError("");
    const response = await fetch(`/api/dashboard?days=${days}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || "Dashboard unavailable");
    setData(payload as DashboardData);
  }, [days]);
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Dashboard unavailable")); }, [load]);
  async function sync() {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/upload-post/sync", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Sync failed");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }
  const person = useMemo(() => data?.people.find((item) => item.id === active) ?? null, [data, active]);
  const status = data ? { zh: `更新于 ${new Date(data.updatedAt).toLocaleString("zh-CN")}`, en: `Updated ${new Date(data.updatedAt).toLocaleString("en-US")}` } : { zh: "正在读取数据", en: "Loading data" };
  return <AppShell active="dashboard" status={status}><section className="page">
    <div className="head"><div><p className="eyebrow">CROSS-PLATFORM INTELLIGENCE</p><h1>{text("数据看板", "Performance dashboard")}</h1><p>{text("查看团队、成员和视频在不同时间与平台上的表现。", "Explore performance by team, member, video, time and platform.")}</p></div><div className="filters"><select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label={text("时间范围", "Date range")}><option value={1}>{text("过去 24 小时", "Last 24 hours")}</option><option value={7}>{text("过去 7 天", "Last 7 days")}</option><option value={30}>{text("过去 30 天", "Last 30 days")}</option><option value={90}>{text("过去 90 天", "Last 90 days")}</option><option value={365}>{text("过去一年", "Last year")}</option></select><button disabled={syncing} onClick={() => void sync()}>{syncing ? "…" : "↻"} {text("同步", "Sync")}</button></div></div>
    {error && <div className="data-message error">⚠ {error}</div>}
    {!data && !error && <div className="data-message">{text("正在载入团队数据…", "Loading team data…")}</div>}
    {data && <>
      <div className="tabs" role="tablist"><button className={active === "team" ? "active" : ""} onClick={() => setActive("team")}>{text("团队总体", "Team overview")}</button><button className={active === "leaderboard" ? "active" : ""} onClick={() => setActive("leaderboard")}>🏆 {text("排行榜", "Leaderboard")}</button><button className={active === "videos" ? "active" : ""} onClick={() => setActive("videos")}>▶ {text("视频数据", "Video data")}</button>{data.people.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}>{item.name}</button>)}</div>
      {active === "team" && <Overview data={data} language={language} />}
      {person && <PersonView person={person} data={data} language={language} />}
      {active === "leaderboard" && <Leaderboard data={data} language={language} />}
      {active === "videos" && <VideoData data={data} language={language} onSynced={load} />}
    </>}
  </section></AppShell>;
}

type TrendMetric = "views" | "retention" | "engagementRate" | "followers";

function Overview({ data, language }: { data: DashboardData; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const cards: { key: TrendMetric; title: string; icon: string }[] = [
    { key: "views", title: t("团队总浏览 / 触达", "Team views / reach"), icon: "◉" },
    { key: "retention", title: t("观看 / 留存", "Watch / retention"), icon: "◷" },
    { key: "engagementRate", title: t("团队互动率", "Team engagement rate"), icon: "⌁" },
    { key: "followers", title: t("新增粉丝 / 订阅", "New followers / subscribers"), icon: "↗" },
  ];
  return <section className="trend-grid">{cards.map((card) => <TrendCard key={card.key} metric={card.key} title={card.title} icon={card.icon} data={data} language={language} />)}</section>;
}

function TrendCard({ metric, title, icon, data, language }: { metric: TrendMetric; title: string; icon: string; data: DashboardData; language: "zh" | "en" }) {
  const [selected, setSelected] = useState<Platform[]>(allPlatforms);
  function toggle(platform: Platform) {
    setSelected((current) => current.includes(platform) ? current.length === 1 ? current : current.filter((item) => item !== platform) : [...current, platform]);
  }
  const current = combinePlatforms(selected.map((platform) => data.team.byPlatform[platform]));
  const currentValue = metric === "engagementRate" ? current.engagementRate : current.metrics[metric];
  const points = data.team.trend.map((point) => {
    const combined = combinePlatforms(selected.map((platform) => point.platforms[platform]));
    return { at: point.capturedAt, value: metric === "engagementRate" ? combined.engagementRate : combined.metrics[metric] };
  });
  return <article className="card trend-card"><header><span className="kicon">{icon}</span><div><p>{title}</p><strong>{format(currentValue, metric, language)}</strong></div></header><PlatformSelector selected={selected} toggle={toggle} /><LineChart points={points} metric={metric} label={title} language={language} showTime={data.days === 1} /></article>;
}

function PlatformSelector({ selected, toggle }: { selected: Platform[]; toggle: (platform: Platform) => void }) {
  return <div className="platform-selector">{allPlatforms.map((platform) => <button key={platform} className={selected.includes(platform) ? "active" : ""} onClick={() => toggle(platform)}><i className={`pi ${platformMeta[platform].className}`}>{platformMeta[platform].icon}</i>{platformMeta[platform].name}</button>)}</div>;
}

function LineChart({ points, metric, label, language, showTime = false }: { points: { at: string; value: number | null }[]; metric: TrendMetric; label: string; language: "zh" | "en"; showTime?: boolean }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const available = points.map((point, index) => ({ ...point, index })).filter((point): point is { at: string; value: number; index: number } => point.value !== null && Number.isFinite(point.value));
  if (!available.length) return <div className="empty-chart">{language === "zh" ? "暂无历史数据" : "No history yet"}</div>;
  const width = 560, height = 150, padding = 12;
  const minimum = Math.min(...available.map((point) => point.value));
  const maximum = Math.max(...available.map((point) => point.value));
  const range = maximum - minimum || 1;
  const x = (index: number) => padding + (points.length === 1 ? (width - padding * 2) / 2 : index / (points.length - 1) * (width - padding * 2));
  const y = (value: number) => height - padding - (value - minimum) / range * (height - padding * 2);
  const coordinates = available.map((point) => `${x(point.index)},${y(point.value)}`).join(" ");
  const dateOptions: Intl.DateTimeFormatOptions = showTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" };
  const first = new Date(available[0].at).toLocaleString(language === "zh" ? "zh-CN" : "en-US", dateOptions);
  const last = new Date(available.at(-1)!.at).toLocaleString(language === "zh" ? "zh-CN" : "en-US", dateOptions);
  const hovered = hoveredIndex === null ? null : available.find((point) => point.index === hoveredIndex) ?? null;
  function hover(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = (event.clientX - bounds.left) / bounds.width * width;
    const nearest = available.reduce((best, point) => Math.abs(x(point.index) - chartX) < Math.abs(x(best.index) - chartX) ? point : best);
    setHoveredIndex(nearest.index);
  }
  const tooltipDate = hovered ? new Date(hovered.at).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return <div className="line-chart" onMouseLeave={() => setHoveredIndex(null)}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} onMouseMove={hover}><line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} /><line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} /><polyline points={coordinates} />{available.map((point) => <circle className={hovered?.index === point.index ? "chart-point active" : "chart-point"} key={point.index} cx={x(point.index)} cy={y(point.value)} r={hovered?.index === point.index ? 5 : 3} />)}{hovered && <line className="hover-guide" x1={x(hovered.index)} x2={x(hovered.index)} y1={padding} y2={height - padding} />}</svg>{hovered && <div className="chart-tooltip" style={{ left: `${Math.min(88, Math.max(12, x(hovered.index) / width * 100))}%`, top: `${Math.max(12, y(hovered.value) / height * 100)}%` }}><time>{tooltipDate}</time><strong>{label}</strong><b>{format(hovered.value, metric, language)}</b></div>}<span>{first}</span><span>{last}</span></div>;
}

function PersonView({ person, data, language }: { person: Person; data: DashboardData; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const recent = data.videos.filter((video) => video.ownerId === person.id).slice(0, 5);
  return <>
    <section className="card person-hero show">{person.avatar ? <img className="avatar auth-avatar" src={person.avatar} alt="" /> : <span className="avatar" style={{ background: palette[data.people.indexOf(person) % palette.length] }}>{initials(person.name)}</span>}<div><h2>{person.name}</h2><p>{person.role} · {person.videoCount} {t("个视频", "videos")}</p></div><div className="person-score"><strong>{person.totalScore.toFixed(1)}</strong><small>{t("个人综合得分", "Personal score")}</small></div></section>
    <Kpis values={[format(person.metrics.views, "views", language), person.engagementRate === null ? "—" : `${person.engagementRate.toFixed(2)}%`, format(person.metrics.followers, "followers", language), String(person.videoCount)]} labels={[t("个人浏览 / 触达", "Personal views / reach"), t("个人互动率", "Personal engagement"), t("新增粉丝 / 订阅", "New followers / subscribers"), t("发布视频", "Published videos")]} />
    <PlatformMix mix={person.mix} title={t("个人平台占比", "Personal platform mix")} language={language} />
    <MetricsTable definitions={data.metricDefinitions} metrics={person.metrics} ratios={person.ratios} scores={person.scores} language={language} />
    <RecentVideos videos={recent} language={language} />
  </>;
}

function RecentVideos({ videos, language }: { videos: Video[]; language: "zh" | "en" }) {
  return <section className="card recent-person-videos"><div className="panel-head"><div><h2>{language === "zh" ? "最近上传的五条视频" : "Five most recent uploads"}</h2><p>{language === "zh" ? "按上传时间从近到远" : "Newest uploads first"}</p></div></div>{videos.length ? <div className="recent-video-list">{videos.map((video) => <article key={video.id}><div><Link href={`/dashboard/videos/${video.id}`}><strong>{video.title}</strong></Link><small>{new Date(video.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small><span>{video.platforms.map((platform) => <i key={platform.platform}>{platformMeta[platform.platform].name}</i>)}</span></div><dl><div><dt>{language === "zh" ? "浏览" : "Views"}</dt><dd>{format(video.metrics.views, "views", language)}</dd></div><div><dt>{language === "zh" ? "点赞" : "Likes"}</dt><dd>{format(video.metrics.likes, "likes", language)}</dd></div><div><dt>{language === "zh" ? "留存" : "Retention"}</dt><dd>{format(video.metrics.retention, "retention", language)}</dd></div></dl></article>)}</div> : <div className="empty-chart">{language === "zh" ? "暂无上传记录" : "No uploads yet"}</div>}</section>;
}

function Kpis({ values, labels }: { values: string[]; labels: string[] }) {
  return <div className="kpis">{values.map((value, index) => <article className="card kpi" key={labels[index]}><span className="kicon">{["◉", "⌁", "↗", "▶"][index]}</span><p>{labels[index]}</p><strong>{value}</strong><small>{value === "—" ? "Metric unavailable" : "Upload-Post"}</small></article>)}</div>;
}

function PlatformMix({ mix, title, language }: { mix: number[]; title: string; language: "zh" | "en" }) {
  return <section className="card panel"><div className="panel-head"><div><h2>{title}</h2><p>{language === "zh" ? "按浏览 / 触达分布" : "Distribution by views / reach"}</p></div></div><div className="platform-share">{allPlatforms.map((platform, index) => <div className="share-row" key={platform}><span><i className={`pi ${platformMeta[platform].className}`}>{platformMeta[platform].icon}</i>{platformMeta[platform].name}</span><div className="track"><i style={{ width: `${mix[index] ?? 0}%`, background: ["#252936", "#d55a85", "#ff4c4c"][index] }} /></div><b>{(mix[index] ?? 0).toFixed(1)}%</b></div>)}</div></section>;
}

function MetricsTable({ definitions, metrics, ratios, scores, language }: { definitions: DashboardData["metricDefinitions"]; metrics: Metrics; ratios: Metrics; scores: Metrics; language: "zh" | "en" }) {
  return <section className="card metrics"><div className="metric-head"><div><h2>{language === "zh" ? "个人指标占比与得分" : "Personal contribution & score"}</h2><p>{language === "zh" ? "个人值 ÷ 团队最高值 × 权重" : "Individual ÷ team best × weight"}</p></div></div><div className="table-wrap"><div className="mrow header personal"><span>{language === "zh" ? "指标" : "Metric"}</span><span>{language === "zh" ? "个人值" : "Individual"}</span><span>{language === "zh" ? "占比" : "Ratio"}</span><span>{language === "zh" ? "权重" : "Weight"}</span><span>{language === "zh" ? "得分" : "Score"}</span></div>{definitions.map((item) => <div className="mrow personal" key={item.key}><span><i className="dot" /><b>{language === "zh" ? item.zh : item.en}</b></span><strong>{format(metrics[item.key], item.key, language)}</strong><span className="positive">{ratios[item.key] === null ? "—" : `${ratios[item.key]?.toFixed(1)}%`}</span><span className="weight">{item.weight}%</span><strong>{scores[item.key] === null ? "—" : scores[item.key]?.toFixed(1)}</strong></div>)}</div></section>;
}

function Leaderboard({ data, language }: { data: DashboardData; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const [sortKey, setSortKey] = useState<"totalScore" | MetricKey>("totalScore");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(() => [...data.people].sort((left, right) => {
    const a = sortKey === "totalScore" ? left.totalScore : left.metrics[sortKey];
    const b = sortKey === "totalScore" ? right.totalScore : right.metrics[sortKey];
    if (a === null) return 1;
    if (b === null) return -1;
    return direction === "desc" ? b - a : a - b;
  }), [data.people, direction, sortKey]);
  const selectedDefinition = data.metricDefinitions.find((item) => item.key === sortKey);
  return <section className="leaderboard-view show"><div className="leaderboard-intro"><div><p className="eyebrow">TEAM RANKINGS</p><h2>{t("成员排行榜", "Team leaderboard")}</h2><p>{t("选择任意指标重新排序", "Sort the team by any metric")}</p></div><div className="sort-controls"><select value={sortKey} onChange={(event) => setSortKey(event.target.value as "totalScore" | MetricKey)}><option value="totalScore">{t("综合评分", "Overall score")}</option>{data.metricDefinitions.map((metric) => <option key={metric.key} value={metric.key}>{language === "zh" ? metric.zh : metric.en}</option>)}</select><button onClick={() => setDirection((value) => value === "desc" ? "asc" : "desc")}>{direction === "desc" ? "↓" : "↑"} {direction === "desc" ? t("从高到低", "High to low") : t("从低到高", "Low to high")}</button></div></div>{sorted.length ? <div className="leader-list"><div className="leader-row leader-head"><span>#</span><span>{t("成员", "Member")}</span><span>{t("视频", "Videos")}</span><span>{sortKey === "totalScore" ? t("综合评分", "Overall score") : language === "zh" ? selectedDefinition?.zh : selectedDefinition?.en}</span></div>{sorted.map((person, index) => <div className="leader-row" key={person.id}><span className="rank-number">{index + 1}</span><span className="leader-person">{person.avatar ? <img className="avatar auth-avatar" src={person.avatar} alt="" /> : <i className="avatar" style={{ background: palette[data.people.indexOf(person) % palette.length] }}>{initials(person.name)}</i>}<b>{person.name}<small>{person.role}</small></b></span><span>{person.videoCount}</span><strong>{format(sortKey === "totalScore" ? person.totalScore : person.metrics[sortKey], sortKey, language)}</strong></div>)}</div> : <div className="data-message">{t("暂无成员数据", "No member data")}</div>}</section>;
}

function VideoData({ data, language, onSynced }: { data: DashboardData; language: "zh" | "en"; onSynced: () => Promise<void> }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const [owner, setOwner] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<"createdAt" | MetricKey>("createdAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [retrying, setRetrying] = useState("");
  const uploaders = useMemo(() => [...new Map(data.videos.map((video) => [video.ownerId ?? `name:${video.owner}`, video.owner])).entries()], [data.videos]);
  const filtered = useMemo(() => data.videos.filter((video) => {
    const ownerKey = video.ownerId ?? `name:${video.owner}`;
    const timestamp = Date.parse(video.createdAt);
    if (owner !== "all" && ownerKey !== owner) return false;
    if (from && timestamp < Date.parse(`${from}T00:00:00`)) return false;
    if (to && timestamp > Date.parse(`${to}T23:59:59.999`)) return false;
    return true;
  }).sort((left, right) => {
    const a = sortKey === "createdAt" ? Date.parse(left.createdAt) : left.metrics[sortKey];
    const b = sortKey === "createdAt" ? Date.parse(right.createdAt) : right.metrics[sortKey];
    if (a === null) return 1;
    if (b === null) return -1;
    return direction === "desc" ? b - a : a - b;
  }), [data.videos, direction, from, owner, sortKey, to]);
  async function retry(uploadId: string, platform: string) {
    const key = `${uploadId}:${platform}`;
    setRetrying(key);
    try {
      const response = await fetch("/api/upload-post/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, platform }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      await onSynced();
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : "Retry failed");
    } finally {
      setRetrying("");
    }
  }
  return <section className="video-data-view show"><div className="video-data-head"><div><p className="eyebrow">VIDEO PERFORMANCE</p><h2>{t("每个视频的数据", "Video-level performance")}</h2><p>{t(`筛选并排序 ${filtered.length} 条视频`, `Filter and sort ${filtered.length} videos`)}</p></div></div><div className="uploader-tabs"><button className={owner === "all" ? "active" : ""} onClick={() => setOwner("all")}>{t("全部上传者", "All uploaders")}</button>{uploaders.map(([key, name]) => <button key={key} className={owner === key ? "active" : ""} onClick={() => setOwner(key)}>{name}</button>)}</div><div className="video-filters"><label>{t("开始时间", "From")}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>{t("结束时间", "To")}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label>{t("排序指标", "Sort by")}<select value={sortKey} onChange={(event) => setSortKey(event.target.value as "createdAt" | MetricKey)}><option value="createdAt">{t("上传时间", "Upload time")}</option>{data.metricDefinitions.map((metric) => <option value={metric.key} key={metric.key}>{language === "zh" ? metric.zh : metric.en}</option>)}</select></label><button onClick={() => setDirection((value) => value === "desc" ? "asc" : "desc")}>{direction === "desc" ? "↓" : "↑"} {direction === "desc" ? t("倒序", "Descending") : t("正序", "Ascending")}</button>{(owner !== "all" || from || to || sortKey !== "createdAt") && <button className="clear-filter" onClick={() => { setOwner("all"); setFrom(""); setTo(""); setSortKey("createdAt"); setDirection("desc"); }}>{t("清除", "Clear")}</button>}</div>{filtered.length ? <div className="video-table-wrap"><div className="video-table"><div className="video-data-row video-data-header"><span>{t("视频", "Video")}</span><span>{t("上传者", "Uploader")}</span><span>{t("上传时间", "Uploaded")}</span>{data.metricDefinitions.map((metric) => <span key={metric.key}>{language === "zh" ? metric.zh : metric.en}{sortKey === metric.key ? direction === "desc" ? " ↓" : " ↑" : ""}</span>)}</div>{filtered.map((video) => <div className="video-data-row" key={video.id}><span className="video-cell"><Link className="video-detail-link" href={`/dashboard/videos/${video.id}`}><i><b>▶</b></i><span className="video-title"><strong>{video.title}</strong></span></Link><span className="video-platform-links">{video.platforms.map((platform) => <span key={platform.platform}>{platform.url ? <a href={platform.url} target="_blank" rel="noreferrer">{platform.platform} ↗</a> : platform.platform}{platform.status === "failed" && <button disabled={retrying === `${video.id}:${platform.platform}`} title={platform.error ?? ""} onClick={() => void retry(video.id, platform.platform)}>{retrying === `${video.id}:${platform.platform}` ? "…" : t("重试", "Retry")}</button>}</span>)}</span></span><span className="uploader-cell"><i className="avatar">{initials(video.owner)}</i><b>{video.owner}</b></span><span className="date-cell">{new Date(video.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</span>{data.metricDefinitions.map((metric) => <span key={metric.key}><strong>{format(video.metrics[metric.key], metric.key, language)}</strong><small>{video.metrics[metric.key] === null ? t("未提供", "Unavailable") : "Upload-Post"}</small></span>)}</div>)}</div></div> : <div className="data-message">{t("没有符合筛选条件的视频。", "No videos match these filters.")}</div>}</section>;
}

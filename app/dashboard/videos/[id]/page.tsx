"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../../components/app-shell";
import { useLanguage } from "../../../../components/language-provider";

type MetricKey = "views" | "likes" | "retention" | "reposts" | "shares" | "followers" | "saves" | "comments";
type Platform = "tiktok" | "instagram" | "youtube";
type PlatformKey = "all" | Platform;
type Metrics = Record<MetricKey, number | null>;
type Point = { minute: number; metrics: Record<PlatformKey, Metrics> };
type DetailData = {
  updatedAt: string;
  metricDefinitions: { key: MetricKey; zh: string; en: string }[];
  video: { id: string; title: string; owner: string; createdAt: string; status: string; platforms: { platform: Platform; url: string | null; status: string }[]; metrics: Record<PlatformKey, Metrics> };
  timeline: { target: { fallback: boolean; points: Point[] }; owner: { count: number; fallbackCount: number; points: Point[] }; team: { count: number; fallbackCount: number; points: Point[] } };
};

const platformMeta: Record<Platform, { name: string; icon: string }> = { tiktok: { name: "TikTok", icon: "♪" }, instagram: { name: "Instagram", icon: "◎" }, youtube: { name: "YouTube", icon: "▶" } };
const platforms = Object.keys(platformMeta) as Platform[];

function format(value: number | null, key: MetricKey, language: "zh" | "en") {
  if (value === null || !Number.isFinite(value)) return "—";
  if (key === "retention") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function selectedMetric(point: Point, selected: Platform[], key: MetricKey) {
  if (selected.length === platforms.length) return point.metrics.all[key];
  const values = selected.map((platform) => point.metrics[platform][key]).filter((value): value is number => value !== null);
  if (!values.length) return null;
  return key === "retention" ? values.reduce((sum, value) => sum + value, 0) / values.length : values.reduce((sum, value) => sum + value, 0);
}

export default function VideoDetailPage() {
  const { language, text } = useLanguage();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Platform[]>(platforms);
  useEffect(() => {
    void fetch(`/api/videos/${encodeURIComponent(params.id)}/analytics`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "Video analytics unavailable");
      setData(payload as DetailData);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Video analytics unavailable"));
  }, [params.id]);
  function toggle(platform: Platform) {
    setSelected((current) => current.includes(platform) ? current.length === 1 ? current : current.filter((item) => item !== platform) : [...current, platform]);
  }
  const current = useMemo(() => data ? Object.fromEntries(data.metricDefinitions.map(({ key }) => [key,
    selectedMetric({ minute: 0, metrics: data.video.metrics }, selected, key)])) as Metrics : null, [data, selected]);
  const status = data ? { zh: `更新于 ${new Date(data.updatedAt).toLocaleString("zh-CN")}`, en: `Updated ${new Date(data.updatedAt).toLocaleString("en-US")}` } : { zh: "正在读取视频数据", en: "Loading video data" };
  return <AppShell active="dashboard" status={status}><section className="page video-detail-page">
    <Link className="back-link" href="/dashboard">← {text("返回数据看板", "Back to dashboard")}</Link>
    {error && <div className="data-message error">⚠ {error}</div>}
    {!data && !error && <div className="data-message">{text("正在载入视频详情…", "Loading video details…")}</div>}
    {data && <>
      <header className="video-detail-hero card"><div><p className="eyebrow">VIDEO ANALYTICS</p><h1>{data.video.title}</h1><p>{data.video.owner} · {new Date(data.video.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")} · {data.video.status}</p><div className="detail-platform-links">{data.video.platforms.map((platform) => platform.url ? <a key={platform.platform} href={platform.url} target="_blank" rel="noreferrer">{platformMeta[platform.platform].name} ↗</a> : <span key={platform.platform}>{platformMeta[platform.platform].name} · {platform.status}</span>)}</div></div><span className="detail-play">▶</span></header>
      <div className="detail-toolbar card"><div><strong>{text("查看平台", "Platforms")}</strong><small>{text("可组合查看一个或多个平台", "Combine one or more platforms")}</small></div><div className="platform-selector">{platforms.map((platform) => <button key={platform} className={selected.includes(platform) ? "active" : ""} onClick={() => toggle(platform)}><i>{platformMeta[platform].icon}</i>{platformMeta[platform].name}</button>)}</div></div>
      {data.timeline.target.fallback && <div className="fallback-note">ⓘ {text("该历史视频没有完整时间序列，当前值暂以水平线展示；采集到真实快照后会自动替换。", "This historical video has no full time series. Its current value is shown as a flat line until real snapshots become available.")}</div>}
      <section className="detail-kpis">{data.metricDefinitions.map(({ key, zh, en }) => <article className="card" key={key}><small>{language === "zh" ? zh : en}</small><strong>{format(current?.[key] ?? null, key, language)}</strong></article>)}</section>
      <section className="comparison-copy"><div><p className="eyebrow">24-HOUR BENCHMARK</p><h2>{text("发布后 24 小时表现", "Performance in the first 24 hours")}</h2><p>{text("按相同的发布后时间，对比本视频、上传者最近 10 条和全公司最近 30 条视频的平均表现。", "Compare this video at the same age with the uploader's latest 10 and the company's latest 30 videos.")}</p></div><div className="series-legend"><span className="target">● {text("本视频", "This video")}</span><span className="owner">● {text(`上传者基准 (${data.timeline.owner.count})`, `Uploader baseline (${data.timeline.owner.count})`)}</span><span className="team">● {text(`公司基准 (${data.timeline.team.count})`, `Company baseline (${data.timeline.team.count})`)}</span></div></section>
      <section className="video-chart-grid">{data.metricDefinitions.map((definition) => <MetricComparison key={definition.key} definition={definition} data={data} selected={selected} language={language} />)}</section>
      {(data.timeline.owner.fallbackCount > 0 || data.timeline.team.fallbackCount > 0) && <p className="benchmark-footnote">* {text("部分基准视频缺少历史快照，已用其当前数据生成水平基准；新数据会逐步替换这些估算值。", "Some benchmark videos lack historical snapshots, so their current values are used as flat baselines. New snapshots will gradually replace these estimates.")}</p>}
    </>}
  </section></AppShell>;
}

function MetricComparison({ definition, data, selected, language }: { definition: DetailData["metricDefinitions"][number]; data: DetailData; selected: Platform[]; language: "zh" | "en" }) {
  const series = [
    { className: "target", points: data.timeline.target.points.map((point) => ({ minute: point.minute, value: selectedMetric(point, selected, definition.key) })) },
    { className: "owner", points: data.timeline.owner.points.map((point) => ({ minute: point.minute, value: selectedMetric(point, selected, definition.key) })) },
    { className: "team", points: data.timeline.team.points.map((point) => ({ minute: point.minute, value: selectedMetric(point, selected, definition.key) })) },
  ];
  const available = series.flatMap((item) => item.points).filter((point): point is { minute: number; value: number } => point.value !== null && Number.isFinite(point.value));
  const maximum = Math.max(1, ...available.map((point) => point.value));
  const width = 600, height = 220, left = 34, right = 12, top = 14, bottom = 28;
  const x = (minute: number) => left + Math.log(Math.max(15, minute) / 15) / Math.log(1440 / 15) * (width - left - right);
  const y = (value: number) => top + (1 - value / maximum) * (height - top - bottom);
  const tickMinutes = [15, 30, 60, 240, 720, 1440];
  return <article className="card comparison-chart"><header><div><small>{language === "zh" ? definition.zh : definition.en}</small><strong>{format(series[0].points.at(-1)?.value ?? null, definition.key, language)}</strong></div><span>{language === "zh" ? "发布后时间" : "Age since upload"}</span></header>{available.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img">{[0, .5, 1].map((ratio) => <line className="grid-line" key={ratio} x1={left} x2={width - right} y1={top + ratio * (height - top - bottom)} y2={top + ratio * (height - top - bottom)} />)}{tickMinutes.map((minute) => <g key={minute}><line className="tick-line" x1={x(minute)} x2={x(minute)} y1={top} y2={height - bottom} /><text x={x(minute)} y={height - 8}>{minute < 60 ? `${minute}m` : `${minute / 60}h`}</text></g>)}{series.map((item) => { const points = item.points.filter((point): point is { minute: number; value: number } => point.value !== null); return points.length ? <polyline key={item.className} className={item.className} points={points.map((point) => `${x(point.minute)},${y(point.value)}`).join(" ")} /> : null; })}</svg> : <div className="empty-chart">{language === "zh" ? "暂无数据" : "No data"}</div>}</article>;
}

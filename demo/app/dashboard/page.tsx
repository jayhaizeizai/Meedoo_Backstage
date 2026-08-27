"use client";

import { useState } from "react";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";
import { initials, metricRanks, metrics, people, PersonId, videos, ViewId } from "../../lib/demo-data";

const personIds: PersonId[] = ["team", "mia", "leo", "ava", "noah"];
const tabIds: ViewId[] = ["team", "leaderboard", "videos", "mia", "leo", "ava", "noah"];

function PlatformIcon({ platform }: { platform: "tt" | "ig" | "yt" }) {
  return <i className={`pi ${platform}`}>{platform === "tt" ? "♪" : platform === "ig" ? "◎" : "▶"}</i>;
}

export default function DashboardPage() {
  const { language, text } = useLanguage();
  const [active, setActive] = useState<ViewId>("team");
  const personId: PersonId = personIds.includes(active as PersonId) ? active as PersonId : "team";
  const person = people[personId];
  const isTeam = personId === "team";
  const isSpecial = active === "leaderboard" || active === "videos";

  function tabLabel(id: ViewId) {
    if (id === "leaderboard") return text("🏆 排行榜", "🏆 Leaderboard");
    if (id === "videos") return text("▶ 视频数据", "▶ Video data");
    const item = people[id];
    return language === "zh" ? item.zhName ?? item.name : item.name;
  }

  const kpiLabels = [
    text(isTeam ? "团队总浏览量" : "个人浏览量", isTeam ? "Team total views" : "Personal views"),
    text(isTeam ? "团队互动率" : "个人互动率", isTeam ? "Team engagement" : "Personal engagement"),
    text(isTeam ? "团队新增粉丝" : "个人新增粉丝", isTeam ? "Team new followers" : "Personal new followers"),
    text(isTeam ? "团队发布视频" : "个人发布视频", isTeam ? "Team videos" : "Personal videos"),
  ];

  return (
    <AppShell active="dashboard" status={{ zh: "数据更新于 2 分钟前", en: "Updated 2 minutes ago" }}>
      <section className="page">
        <div className="head">
          <div><p className="eyebrow">CROSS-PLATFORM INTELLIGENCE</p><h1>{text("数据看板", "Performance dashboard")}</h1><p>{text("先看团队总体，再切换查看每位成员的指标占比。", "Start with the team overview, then explore each member's contribution.")}</p></div>
          <div className="filters"><button>{text("◷ 过去 30 天 ⌄", "◷ Last 30 days ⌄")}</button><button aria-label={text("导出", "Export")}>⇩</button></div>
        </div>

        <div className="tabs" role="tablist" aria-label={text("数据视图", "Dashboard views")}>
          {tabIds.map((id) => <button key={id} className={active === id ? "active" : ""} onClick={() => setActive(id)} role="tab" aria-selected={active === id}>{tabLabel(id)}</button>)}
        </div>

        {active === "leaderboard" && <Leaderboard language={language} />}
        {active === "videos" && <VideoData language={language} />}

        {!isSpecial && !isTeam && (
          <section className="card person-hero show">
            <span className="avatar" style={{ background: person.color }}>{initials(person.name)}</span>
            <div><h2>{person.name}</h2><p>{person.role} · {person.videos} {text("个视频", "videos")}</p></div>
            <div className="person-score"><strong>{person.score}</strong><small>{text("个人综合得分", "Personal score")}</small></div>
          </section>
        )}

        {!isSpecial && (
          <>
            <div className="kpis">
              {person.kpis.map((value, index) => (
                <article className="card kpi" key={kpiLabels[index]}>
                  <span className="kicon">{["◉", "⌁", "↗", "▶"][index]}</span>
                  <p>{kpiLabels[index]}</p><strong>{value}</strong>
                  <small><b>{person.deltas[index]}</b> {text("较上一周期", "vs previous period")}</small>
                </article>
              ))}
            </div>

            <div className="dashboard-grid">
              <section className="card panel">
                <div className="panel-head"><div><h2>{text(isTeam ? "团队浏览趋势" : "个人浏览趋势", isTeam ? "Team view trend" : "Personal view trend")}</h2><p>{text("TikTok、Instagram、YouTube Shorts 汇总", "TikTok, Instagram & YouTube Shorts combined")}</p></div><span className="positive">↗ 21.3%</span></div>
                <div className="chart"><i className="chart-line" /></div>
              </section>
              <section className="card panel">
                <div className="panel-head"><div><h2>{text(isTeam ? "平台数据分布" : "个人平台占比", isTeam ? "Platform distribution" : "Personal platform mix")}</h2><p>{text(isTeam ? "总体浏览量按平台分布" : "该成员浏览量的平台构成", isTeam ? "Total views by platform" : "Member views by platform")}</p></div></div>
                <div className="platform-share">
                  {(["tt", "ig", "yt"] as const).map((platform, index) => (
                    <div className="share-row" key={platform}><span><PlatformIcon platform={platform} />{["TikTok", "Instagram", "YouTube"][index]}</span><div className="track"><i style={{ width: `${person.mix[index]}%`, background: ["#252936", "#d55a85", "#ff4c4c"][index] }} /></div><b>{person.mix[index]}%</b></div>
                  ))}
                </div>
              </section>
            </div>

            <MetricsTable personId={personId} language={language} />
          </>
        )}
      </section>
    </AppShell>
  );
}

function MetricsTable({ personId, language }: { personId: PersonId; language: "zh" | "en" }) {
  const personal = personId !== "team";
  const factor = { team: 1, mia: 1, leo: 0.88, ava: 0.76, noah: 0.64 }[personId];
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  return (
    <section className="card metrics">
      <div className="metric-head"><div><h2>{t(personal ? "个人指标占比与得分" : "团队互动指标汇总", personal ? "Personal contribution & score" : "Team engagement summary")}</h2><p>{t(personal ? "个人值 ÷ 团队最高值 = 指标占比；再乘对应权重得到个人得分" : "三个平台全部视频合并计算；总体视图不显示个人占比", personal ? "Individual value ÷ team best = ratio; ratio × weight = score" : "All team videos combined; no personal ratio in overview")}</p></div><div className="legend"><span>♪ TikTok</span> <span>◎ Instagram</span> <span>▶ YouTube</span></div></div>
      <div className="table-wrap">
        <div className={`mrow header${personal ? " personal" : ""}`}>
          <span>{t("互动指标", "Metric")}</span><span>{t(personal ? "个人值" : "团队汇总", personal ? "Individual" : "Team total")}</span>{personal && <span>{t("占比", "Ratio")}</span>}<span>{t("权重", "Weight")}</span><span>{t(personal ? "得分" : "趋势", personal ? "Score" : "Trend")}</span>
        </div>
        {metrics.map((metric, index) => {
          const ratio = Math.max(55, Math.round(metric.ratio * factor - (index % 3) * 2));
          const value = Math.round(ratio * (index + 3) * 7.4).toLocaleString();
          return <div className={`mrow${personal ? " personal" : ""}`} key={metric.en}><span><i className="dot" /><b>{language === "zh" ? metric.zh : metric.en}</b></span><strong>{personal ? value : metric.total}</strong>{personal && <span className="positive">{ratio}%</span>}<span className="weight">{metric.weight}%</span>{personal ? <strong>{(ratio * metric.weight / 100).toFixed(1)}</strong> : <span className="positive">↗ {metric.trend}</span>}</div>;
        })}
      </div>
    </section>
  );
}

function Leaderboard({ language }: { language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const ordered: PersonId[] = ["mia", "leo", "ava", "noah"];
  return (
    <section className="leaderboard-view show">
      <div className="leaderboard-intro"><div><p className="eyebrow">TEAM RANKINGS</p><h2>{t("成员排行榜", "Team leaderboard")}</h2><p>{t("按综合评分与 8 个互动指标分别排名", "Ranked by overall score and eight engagement metrics")}</p></div><span>🏆</span></div>
      <div className="podium">
        {ordered.map((id, index) => { const person = people[id]; return <article className={`podium-card rank-${index + 1}`} key={id}><em>{index + 1}</em><span className="avatar" style={{ background: person.color }}>{initials(person.name)}</span><div><strong>{person.name}</strong><small>{person.role} · {person.videos} {t("个视频", "videos")}</small></div><b>{person.score}<small>{t("分", "pts")}</small></b><i style={{ width: `${person.score}%` }} /></article>; })}
      </div>
      <div className="detail-ranks">
        {metrics.map((metric, metricIndex) => <article className="detail-card" key={metric.en}><header><span className="metric-badge">{metricIndex + 1}</span><div><strong>{language === "zh" ? metric.zh : metric.en}</strong><small>{t("权重", "Weight")} {metric.weight}%</small></div></header><ol>{metricRanks[metricIndex].map((id, rank) => { const person = people[id]; const factor = id === "mia" ? 1 : id === "leo" ? 0.91 : id === "ava" ? 0.84 : 0.72; const value = Math.max(58, Math.round(metric.ratio * factor - (rank % 2))); return <li key={id}><em>{rank + 1}</em><span className="avatar" style={{ background: person.color }}>{initials(person.name)}</span><b>{person.name}</b><strong>{value}<small>%</small></strong></li>; })}</ol></article>)}
      </div>
    </section>
  );
}

function VideoData({ language }: { language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  return (
    <section className="video-data-view show">
      <div className="video-data-head"><div><p className="eyebrow">VIDEO PERFORMANCE</p><h2>{t("每个视频的数据", "Video-level performance")}</h2><p>{t("各项数据顺序与团队 Dashboard 保持一致", "Metrics follow the same order as the team dashboard")}</p></div><button>⇩ {t("导出数据", "Export")}</button></div>
      <div className="video-table-wrap"><div className="video-table"><div className="video-data-row video-data-header"><span>{t("视频", "Video")}</span>{metrics.map((metric) => <span key={metric.en}>{language === "zh" ? metric.zh : metric.en}</span>)}</div>{videos.map((video) => <div className="video-data-row" key={video.title}><span className="video-cell"><i style={{ background: video.color }}><b>▶</b><small>{video.duration}</small></i><em><strong>{video.title}</strong><small>{video.owner} · {video.date}</small></em></span>{video.stats.map((stat, index) => <span key={`${video.title}-${index}`}><strong>{stat}</strong><small>{index === 0 ? "+18.2%" : index === 2 ? t("平均留存", "avg. retention") : "↗"}</small></span>)}</div>)}</div></div>
    </section>
  );
}

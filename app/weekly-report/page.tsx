"use client";

import { useEffect, useState, useRef, type FormEvent } from "react";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";

type ConversionMetrics = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  followers: number;
  engagementActions: number;
  engagementRate: number | null;
  followerRate: number | null;
  websiteRate: null;
};

type WeeklyReport = {
  success: boolean;
  updatedAt: string;
  period: { start: string; end: string; timeZone: string };
  videoCount: number;
  conversions: ConversionMetrics;
  members: Array<{ id: string; name: string; avatar: string | null; videoCount: number; conversions: ConversionMetrics }>;
  videos: Array<{
    id: string;
    title: string;
    ownerId: string;
    owner: string;
    avatar: string | null;
    createdAt: string;
    duration: number | null;
    platforms: Array<{ platform: string; website: null; reposts: number | null; shares: number | null; followers: number | null; completionRate: number | null; saves: number | null; comments: number | null; views: number | null; likes: number | null }>;
  }>;
  message?: string;
};

type AccountingData = {
  success: boolean;
  canUpload: boolean;
  period: { start: string; end: string; weekStart: string; timeZone: string } | null;
  availableWeeks: string[];
  uploaders: Array<{ open_id: string; name: string }>;
  setting: { packagePoints: number; packageCostCny: number; updatedAt: string } | null;
  totals: { points: number; costCny: number | null; videoCount: number };
  members: Array<{
    memberId: string; memberName: string; taskCount: number; points: number; costCny: number | null;
    videoCount: number; perVideoPoints: number | null; perVideoCostCny: number | null; matched: boolean;
    mappedUploaderOpenId: string | null; mappedUploaderName: string | null;
    models: Array<{ model: string; tasks: number; points: number }>;
  }>;
  videos: Array<{
    id: string; title: string; uploader_open_id: string | null; uploader_name: string; created_at: string;
    allocatedPoints: number | null; allocatedCostCny: number | null;
  }>;
  message?: string;
};

const rules = [
  { icon: "↻", zh: "转发", en: "Reposts", weight: 22, detailZh: "汇总全部视频或帖子的转发。", detailEn: "Totals reposts across all videos and posts." },
  { icon: "↗", zh: "分享 / 发送", en: "Shares / Sends", weight: 18, detailZh: "汇总平台提供的分享与发送。", detailEn: "Totals available share and send actions." },
  { icon: "+", zh: "新增粉丝 / 订阅", en: "New followers / Subscribers", weight: 18, detailZh: "优先使用直接数据，否则使用系统估算归因。", detailEn: "Uses direct data first, then estimated attribution." },
  { icon: "◷", zh: "观看质量 / 留存", en: "Watch quality / Retention", weight: 17, detailZh: "以跨平台等效的 0–100 分计算。", detailEn: "Uses the cross-platform equivalent 0–100 score." },
  { icon: "◇", zh: "收藏", en: "Saves", weight: 10, detailZh: "统计收藏、书签或喜爱。", detailEn: "Counts saves, bookmarks or favorites." },
  { icon: "…", zh: "评论", en: "Comments", weight: 6, detailZh: "统计评论与回复。", detailEn: "Counts comments and replies." },
  { icon: "◉", zh: "浏览 / 触达", en: "Views / Reach", weight: 6, detailZh: "采用各平台可用的浏览或触达数据。", detailEn: "Uses available platform views or reach." },
  { icon: "♥", zh: "点赞", en: "Likes", weight: 3, detailZh: "统计视频获得的点赞。", detailEn: "Counts likes received by published videos." },
] as const;

const number = (value: number, language: "zh" | "en") => new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 0 }).format(value);
const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}%`;
const metric = (value: number | null, language: "zh" | "en") => value === null ? "—" : number(value, language);

export default function WeeklyReportPage() {
  const { language, text } = useLanguage();
  const [active, setActive] = useState<"rules" | "accounting" | "conversions">("rules");
  const [data, setData] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/weekly-report", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as WeeklyReport;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Weekly report unavailable");
      setData(payload);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Weekly report unavailable"));
  }, []);

  const status = data
    ? { zh: `本周数据更新于 ${new Date(data.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Singapore" })}`, en: `This week updated ${new Date(data.updatedAt).toLocaleString("en-US", { timeZone: "Asia/Singapore" })}` }
    : { zh: "每周工作周报", en: "Weekly work report" };

  return <AppShell active="weekly-report" status={status}><section className="page weekly-report-page">
    <div className="head weekly-report-head"><div><p className="eyebrow">WEEKLY WORK REPORT</p><h1>{text("每周工作周报", "Weekly work report")}</h1><p>{text("团队共享规则、核算与本周转化表现。", "Shared team rules, accounting and this week's conversions.")}</p></div>{data && <div className="week-chip"><small>{text("新加坡时间", "Singapore time")}</small><strong>{new Date(data.period.start).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { timeZone: data.period.timeZone })} – {new Date(new Date(data.period.end).getTime() - 1).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { timeZone: data.period.timeZone })}</strong></div>}</div>
    <div className="weekly-tabs" role="tablist" aria-label={text("周报栏目", "Weekly report sections")}>
      <button className={active === "rules" ? "active" : ""} onClick={() => setActive("rules")} role="tab" aria-selected={active === "rules"}>① <span>{text("规则", "Bonus rules")}</span></button>
      <button className={active === "accounting" ? "active" : ""} onClick={() => setActive("accounting")} role="tab" aria-selected={active === "accounting"}>② <span>{text("核算", "Accounting")}</span></button>
      <button className={active === "conversions" ? "active" : ""} onClick={() => setActive("conversions")} role="tab" aria-selected={active === "conversions"}>③ <span>{text("转化", "Conversions")}</span></button>
    </div>
    {active === "rules" && <Rules language={language} />}
    {active === "accounting" && <Accounting language={language} />}
    {active === "conversions" && <Conversions data={data} error={error} language={language} />}
  </section></AppShell>;
}

function Accounting({ language }: { language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const [data, setData] = useState<AccountingData | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [packagePoints, setPackagePoints] = useState("16300");
  const [packageCostCny, setPackageCostCny] = useState("649");
  const [busy, setBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadRevision = useRef(0);
  const load = async (week = "") => {
    const revision = ++loadRevision.current;
    try {
    setError("");
    const response = await fetch(`/api/weekly-report/accounting${week ? `?week=${encodeURIComponent(week)}` : ""}`, { cache: "no-store" });
    const payload = await response.json() as AccountingData;
    if (revision !== loadRevision.current) return;
    if (!response.ok || !payload.success) throw new Error(payload.message || "Accounting unavailable");
    setData(payload);
    if (payload.period) setSelectedWeek(payload.period.weekStart);
    if (payload.setting) {
      setPackagePoints(String(payload.setting.packagePoints));
      setPackageCostCny(String(payload.setting.packageCostCny));
    }
    } catch(cause) { if(revision === loadRevision.current) throw cause; }
  };

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Accounting unavailable")); }, []);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("packagePoints", packagePoints);
      form.set("packageCostCny", packageCostCny);
      const response = await fetch("/api/weekly-report/accounting", { method: "POST", body: form });
      const payload = await response.json() as { success?: boolean; duplicateFile?: boolean; sourceRows?: number; importedRows?: number; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Import failed");
      setMessage(payload.duplicateFile
        ? t("该文件已经导入过，套餐价格设置已更新。", "This file was already imported; package pricing was updated.")
        : t(`已读取 ${payload.sourceRows ?? 0} 条记录，新增 ${payload.importedRows ?? 0} 条。`, `Read ${payload.sourceRows ?? 0} rows and added ${payload.importedRows ?? 0}.`));
      setFile(null);
      const input = document.getElementById("libtv-csv") as HTMLInputElement | null;
      if (input) input.value = "";
      await load();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "Import failed";
      setError(code.startsWith("CSV_") ? t("CSV 格式不符合 LIBTV 积分明细格式。", "The CSV does not match the LIBTV credit export format.") : code);
    } finally { setBusy(false); }
  };

  const mapMember = async (memberId: string, uploaderOpenId: string) => {
    if (!uploaderOpenId) return;
    setMappingBusy(memberId); setError(""); setMessage("");
    try {
      const form = new FormData();
      form.set("action", "map");
      form.set("memberId", memberId);
      form.set("uploaderOpenId", uploaderOpenId);
      const response = await fetch("/api/weekly-report/accounting", { method: "POST", body: form });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Mapping failed");
      setMessage(t("成员对应关系已保存，之后导入会自动识别。", "Member mapping saved. Future imports will match automatically."));
      await load(selectedWeek);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mapping failed");
    } finally { setMappingBusy(""); }
  };

  const formatNumber = (value: number | null, maximumFractionDigits = 0) => value === null ? "—" : new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits }).format(value);
  const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(value);

  return <section className="weekly-section accounting-section">
    {data?.canUpload && <form className="card accounting-upload" onSubmit={upload}>
      <div><p className="eyebrow">LIBTV CSV IMPORT</p><h2>{t("上传积分消耗明细", "Upload credit usage details")}</h2><p>{t("下载 LIBTV“团队积分消耗明细”CSV 后上传。重复文件和重叠记录不会重复计费。", "Upload the LIBTV team credit usage CSV. Duplicate files and overlapping records are not charged twice.")}</p></div>
      <label className="accounting-file-field"><span>{t("CSV 文件", "CSV file")}</span><span className={`accounting-file-picker${file ? " selected" : ""}`}><input id="libtv-csv" className="accounting-file-input" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><b>{t("选择 CSV", "Choose CSV")}</b><em title={file?.name}>{file ? file.name : t("尚未选择文件", "No file selected")}</em></span></label>
      <label>{t("每人套餐积分", "Points per person")}<input type="number" min="1" step="1" value={packagePoints} onChange={(event) => setPackagePoints(event.target.value)} required /></label>
      <label>{t("每人套餐价格（人民币）", "Price per person (CNY)")}<input type="number" min="0.01" step="0.01" value={packageCostCny} onChange={(event) => setPackageCostCny(event.target.value)} required /></label>
      <button type="submit" disabled={busy || !file}>{busy ? t("正在分析…", "Analyzing…") : t("上传并分析", "Upload and analyze")}</button>
    </form>}
    {message && <div className="accounting-message success">{message}</div>}
    {error && <div className="accounting-message error">⚠ {error}</div>}
    {!data && !error && <div className="data-message">{t("正在载入核算数据…", "Loading accounting data…")}</div>}
    {data && <><div className="accounting-toolbar">
      <label>{t("核算周", "Accounting week")}<select value={selectedWeek} onChange={(event) => { const value = event.target.value; setSelectedWeek(value); void load(value).catch((cause) => setError(cause instanceof Error ? cause.message : "Accounting unavailable")); }}>{data.availableWeeks.map((week) => <option value={week} key={week}>{week}</option>)}</select></label>
      {data.setting && <p>{t("成本口径", "Cost basis")}：{money(data.setting.packageCostCny)} ÷ {formatNumber(data.setting.packagePoints)} = {money(data.setting.packageCostCny / data.setting.packagePoints)} / {t("积分", "point")}</p>}
    </div>
    <div className="accounting-kpis">
      <article className="card"><small>{t("团队创作积分", "Team creative points")}</small><strong>{formatNumber(data.totals.points)}</strong></article>
      <article className="card"><small>{t("折算人民币成本", "Calculated cost")}</small><strong>{money(data.totals.costCny)}</strong></article>
      <article className="card"><small>{t("已批准视频", "Approved videos")}</small><strong>{formatNumber(data.totals.videoCount)}</strong></article>
      <article className="card"><small>{t("团队平均每条视频", "Team average per video")}</small><strong>{data.totals.videoCount ? money((data.totals.costCny ?? 0) / data.totals.videoCount) : "—"}</strong></article>
    </div>
    {data.members.length ? <div className="accounting-members">{data.members.map((member) => {
      const memberVideos = data.videos.filter((video) => member.mappedUploaderOpenId
        ? video.uploader_open_id === member.mappedUploaderOpenId
        : video.uploader_name.trim().toLocaleLowerCase() === member.memberName.trim().toLocaleLowerCase());
      return <article className="card accounting-member" key={member.memberId}>
        <header><div><p className="eyebrow">MEMBER ACCOUNTING</p><h2>{member.memberName}</h2><p>{formatNumber(member.taskCount)} {t("次创作任务", "creative tasks")} · {formatNumber(member.videoCount)} {t("条已批准视频", "approved videos")}</p></div><div className="accounting-member-side"><strong>{money(member.costCny)}</strong>{data.canUpload && <label className="accounting-member-map"><span>{t("对应网站成员", "Website member")}</span><select value={member.mappedUploaderOpenId ?? ""} disabled={mappingBusy === member.memberId} onChange={(event) => void mapMember(member.memberId, event.target.value)}><option value="" disabled>{t("选择一次即可自动识别", "Choose once to auto-match")}</option>{data.uploaders.map((uploader) => <option value={uploader.open_id} key={uploader.open_id}>{uploader.name}</option>)}</select></label>}</div></header>
        <div className="accounting-member-kpis"><div><small>{t("消耗积分", "Points used")}</small><b>{formatNumber(member.points)}</b></div><div><small>{t("平均每条积分", "Points per video")}</small><b>{formatNumber(member.perVideoPoints, 2)}</b></div><div><small>{t("平均每条成本", "Cost per video")}</small><b>{money(member.perVideoCostCny)}</b></div></div>
        {!member.matched && <p className="accounting-warning">{t("尚未对应网站成员，选择一次后即可自动分摊到其本周视频。", "This LIBTV member is not mapped yet. Choose the website member once to enable weekly video allocation.")}</p>}
        <div className="accounting-models">{member.models.map((model) => <div key={model.model}><span><strong>{model.model}</strong><small>{model.tasks} {t("次任务", "tasks")}</small></span><b>{formatNumber(model.points)} {t("积分", "points")}</b></div>)}</div>
        {memberVideos.length > 0 && <div className="accounting-video-list"><div className="accounting-video-row header"><span>{t("视频", "Video")}</span><span>{t("分摊积分", "Allocated points")}</span><span>{t("人民币成本", "Cost (CNY)")}</span></div>{memberVideos.map((video) => <div className="accounting-video-row" key={video.id}><span><strong>{video.title}</strong><small>{new Date(video.created_at).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { timeZone: data.period?.timeZone })}</small></span><b>{formatNumber(video.allocatedPoints, 2)}</b><b>{money(video.allocatedCostCny)}</b></div>)}</div>}
      </article>;
    })}</div> : <div className="empty-week card">{t("该周暂无已导入的成员创作积分。", "No imported member creative credits for this week.")}</div>}
    <p className="conversion-source-note">ⓘ {t("成本按每人 649 元 ÷ 16,300 积分折算；系统清零不计入。每个人的周积分平均分摊到其本周已批准视频，并非 LIBTV 对单条成片的直接归属。", "Cost is calculated at CNY 649 ÷ 16,300 points per person. System clearing is excluded. Each member's weekly points are averaged across their approved videos; this is not direct per-video attribution from LIBTV.")}</p></>}
  </section>;
}

function Rules({ language }: { language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  return <section className="weekly-section">
    <article className="rules-intro card"><div><span className="weekly-icon">◎</span><div><p className="eyebrow">SHARED BY THE WHOLE TEAM</p><h2>{t("奖金规则", "Bonus rules")}</h2><p>{t("本页规则对全团队一致，并作为个人周度得分的统一依据。", "These rules are shared by the whole team and define the weekly personal score.")}</p></div></div><strong>100<small>{t("总权重", "Total weight")}</small></strong></article>
    <div className="bonus-rule-grid">
      <article className="card bonus-rule-panel"><p className="eyebrow">WORK EFFICIENCY</p><h2>{t("工作效率奖金倍率", "Work efficiency bonus multiplier")}</h2><div className="bonus-rule-list">{[
        [t("正常工作时间内完成分配工作量", "Assigned work completed within normal hours"), "100%"],
        [t("偶尔延迟，但有合理解释", "Occasional delay with a reasonable explanation"), "75%–100%"],
        [t("反复无法在正常工作时间内完成", "Repeatedly unable to finish within normal hours"), "25%–75%"],
        [t("有书面记录证明长期因个人效率低而无法完成", "Documented long-term failure caused by personal inefficiency"), "0%"],
        [t("甲方要求额外工作、加班、紧急冲刺或改变工作量", "Extra work, overtime, urgent sprint or workload change requested by the client"), t("不扣分", "No deduction")],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></article>
      <article className="card bonus-rule-panel"><p className="eyebrow">BONUS ADJUSTMENT</p><h2>{t("团队与个人奖金", "Team and individual bonus")}</h2><div className="team-bonus"><small>{t("团队成就奖金", "Team achievement bonus")}</small><strong>{t("三个月净收入每达到 $370,000，奖励税前 1 个月工资", "+1 month pre-tax salary per $370,000 net revenue achieved in 3 months")}</strong></div><div className="ranking-list">{[
        [t("第 1 名 / 相对第一名 100%", "1st / 100% of top score"), "+50%"],
        [t("第 2 名 / 91%–99%", "2nd / 91%–99%"), "+25%"],
        [t("第 3 名 / 81%–90%", "3rd / 81%–90%"), "0%"],
        [t("第 4 名 / 71%–80%", "4th / 71%–80%"), "−25%"],
        [t("第 5 名 / 61%–70%", "5th / 61%–70%"), "−50%"],
        [t("低于 60%", "Below 60%"), "−75%"],
      ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p className="low-score-note">{t("如下一考核周期再次低于 61%，该周期个人奖金为 0，并可依法启动绩效改进、培训或岗位评估程序。", "If the next review period is again below 61%, that period's individual bonus is 0 and a lawful performance improvement, training or role review process may begin.")}</p></article>
    </div>
    <article className="card marketing-result"><p className="eyebrow">MARKETING RESULTS</p><h2>{t("每周汇报清单", "Weekly reporting checklist")}</h2><p>{t("逐项列出周报内容；在 Lark Base 汇总团队进度、成果、协作情况与排行榜。", "Itemize the weekly report, and use Lark Base to aggregate team progress, achievements, teamwork and the leaderboard.")}</p></article>
    <div className="rule-section-title"><div><p className="eyebrow">PERFORMANCE WEIGHTS</p><h2>{t("互动指标权重", "Performance metric weights")}</h2></div><small>{t("汇总全部视频 / 帖子", "Across all videos / posts")}</small></div>
    <div className="rule-grid">{rules.map((rule) => <article className="rule-card card" key={rule.en}><header><span>{rule.icon}</span><b>{rule.weight}%</b></header><h3>{language === "zh" ? rule.zh : rule.en}</h3><p>{language === "zh" ? rule.detailZh : rule.detailEn}</p></article>)}</div>
    <article className="score-formula card"><div><span>ƒx</span><div><h2>{t("个人指标得分", "Personal metric score")}</h2><p>{t("每项分别计算后相加，得到个人周度综合得分。", "Calculate each metric separately, then add them for the weekly total score.")}</p></div></div><code>{t("个人值 ÷ 团队本周最高值 × 指标权重", "Individual value ÷ team weekly best × metric weight")}</code></article>
    <div className="rule-notes"><p>ⓘ {t("YouTube 和 TikTok 使用等效留存；Instagram 观看时长不可用时不会按 0 处理。", "YouTube and TikTok use equivalent retention; unavailable Instagram watch time is not treated as zero.")}</p><p>ⓘ {t("Instagram 与 TikTok 的新增粉丝继续使用估算归因；直接平台数据始终优先。", "Instagram and TikTok followers continue to use estimated attribution; direct platform data always takes priority.")}</p></div>
  </section>;
}

type PlatformResult = WeeklyReport["videos"][number]["platforms"][number];

function Conversions({ data, error, language }: { data: WeeklyReport | null; error: string; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const [owner, setOwner] = useState("");
  if (error) return <div className="data-message error">⚠ {t("周报数据暂时不可用。", "Weekly report data is temporarily unavailable.")}</div>;
  if (!data) return <div className="data-message">{t("正在载入本周转化数据…", "Loading this week's conversions…")}</div>;
  const selected = data.members.find((member) => member.id === owner) ?? data.members[0] ?? null;
  const videos = selected ? data.videos.filter((video) => video.ownerId === selected.id) : [];
  const allRows = videos.flatMap((video) => video.platforms.map((result) => ({ video, result })));
  const platformNames: Record<string, string> = { instagram: "Instagram Reels", youtube: "YouTube Shorts", tiktok: "TikTok" };

  return <section className="weekly-section conversion-sheet">
    <div className="person-report-tabs" role="tablist">{data.members.map((member) => <button className={selected?.id === member.id ? "active" : ""} onClick={() => setOwner(member.id)} key={member.id}>{member.avatar ? <img src={member.avatar} alt="" /> : <i>{member.name.slice(0, 2).toUpperCase()}</i>}<span><strong>{member.name}</strong><small>{member.videoCount} {t("个视频", "videos")}</small></span></button>)}</div>
    {selected ? <>
      <article className="card person-conversion-total"><div className="weekly-panel-head"><div><p className="eyebrow">PERSON TOTAL</p><h2>{selected.name} · {t("本周加总", "Weekly total")}</h2><p>{t("先汇总该成员的所有渠道，再查看各渠道逐视频明细。", "All channels combined first, followed by per-channel video details.")}</p></div><span>{t("网站转化暂不可用", "Website conversion unavailable")}</span></div><ConversionSummary rows={allRows} videoCount={videos.length} language={language} /></article>
      {Object.entries(platformNames).map(([platform, label], index) => {
        const rows = videos.flatMap((video) => video.platforms.filter((result) => result.platform === platform).map((result) => ({ video, result })));
        return <ChannelTable key={platform} index={index + 1} label={label} rows={rows} data={data} language={language} />;
      })}
    </> : <div className="empty-week card">{t("本周暂无上传了已批准视频的成员。", "No members have approved videos this week.")}</div>}
    <p className="conversion-source-note">ⓘ {t("新增粉丝优先使用平台直接数据；Instagram 与 TikTok 缺少直接数据时继续使用估算归因。完播率使用现有跨平台等效留存口径。", "Direct follower data takes priority; Instagram and TikTok continue to use estimated attribution when direct data is missing. Completion uses the existing cross-platform equivalent retention method.")}</p>
  </section>;
}

type ConversionRow = { video: WeeklyReport["videos"][number]; result: PlatformResult };

function sumResult(rows: ConversionRow[], key: Exclude<keyof PlatformResult, "platform" | "website">) {
  const values = rows.map(({ result }) => result[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function averageCompletion(rows: ConversionRow[]) {
  const available = rows.filter(({ result }) => result.completionRate !== null);
  if (!available.length) return null;
  const weighted = available.filter(({ result }) => result.views !== null && result.views > 0);
  return weighted.length
    ? weighted.reduce((sum, { result }) => sum + result.completionRate! * result.views!, 0) / weighted.reduce((sum, { result }) => sum + result.views!, 0)
    : available.reduce((sum, { result }) => sum + result.completionRate!, 0) / available.length;
}

function ConversionSummary({ rows, videoCount, language }: { rows: ConversionRow[]; videoCount: number; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const duration = [...new Map(rows.map(({ video }) => [video.id, video.duration])).values()].filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0);
  const items = [
    [t("视频", "Videos"), number(videoCount, language)], [t("总时长", "Total duration"), `${number(duration, language)}s`],
    ["Repost", metric(sumResult(rows, "reposts"), language)], ["Share", metric(sumResult(rows, "shares"), language)],
    [t("新增粉丝", "New followers"), metric(sumResult(rows, "followers"), language)], [t("平均完播 / 留存", "Avg completion / retention"), percent(averageCompletion(rows))],
    [t("收藏", "Saves"), metric(sumResult(rows, "saves"), language)], [t("评论", "Comments"), metric(sumResult(rows, "comments"), language)],
    [t("浏览", "Views"), metric(sumResult(rows, "views"), language)], [t("点赞", "Likes"), metric(sumResult(rows, "likes"), language)],
  ];
  return <div className="person-total-grid">{items.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>;
}

function ChannelTable({ index, label, rows, data, language }: { index: number; label: string; rows: ConversionRow[]; data: WeeklyReport; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "zh" ? zh : en;
  const duration = rows.map(({ video }) => video.duration).filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0);
  return <article className="card conversion-sheet-card"><div className="weekly-panel-head"><div><p className="eyebrow">CHANNEL {index}</p><h2>{label}</h2><p>{t(`${rows.length} 条视频`, `${rows.length} videos`)}</p></div></div>
    <div className="conversion-sheet-wrap"><div className="conversion-sheet-table person-channel-table"><div className="conversion-sheet-row header"><span>{t("视频", "Video")}</span><span>{t("时长（秒）", "Duration (sec)")}</span><span>{t("转化到网站", "Conversion to Website")}</span><span>Repost</span><span>Share</span><span>{t("新增粉丝", "New Followers")}</span><span>{t("完播率 / 等效留存", "Completion / Equivalent retention")}</span><span>{t("收藏", "Save / Bookmark")}</span><span>{t("评论", "Comment")}</span><span>{t("浏览", "Views")}</span><span>{t("点赞", "Likes")}</span></div>
      {rows.map(({ video, result }) => <div className="conversion-sheet-row" key={`${video.id}:${result.platform}`}><span className="conversion-video"><strong>{video.title}</strong><small>{new Date(video.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { timeZone: data.period.timeZone })}</small></span><strong>{video.duration === null ? "—" : Math.round(video.duration)}</strong><span className="unavailable-pill">{t("不可用", "Unavailable")}</span><strong>{metric(result.reposts, language)}</strong><strong>{metric(result.shares, language)}</strong><strong>{result.followers === null ? "—" : `+${number(result.followers, language)}`}</strong><strong>{percent(result.completionRate)}</strong><strong>{metric(result.saves, language)}</strong><strong>{metric(result.comments, language)}</strong><strong>{metric(result.views, language)}</strong><strong>{metric(result.likes, language)}</strong></div>)}
      {rows.length > 0 && <div className="conversion-sheet-row totals"><span>{t("渠道合计", "Channel total")}</span><strong>{number(duration, language)}</strong><span className="unavailable-pill">{t("不可用", "Unavailable")}</span><strong>{metric(sumResult(rows, "reposts"), language)}</strong><strong>{metric(sumResult(rows, "shares"), language)}</strong><strong>{metric(sumResult(rows, "followers"), language)}</strong><strong>{percent(averageCompletion(rows))}</strong><strong>{metric(sumResult(rows, "saves"), language)}</strong><strong>{metric(sumResult(rows, "comments"), language)}</strong><strong>{metric(sumResult(rows, "views"), language)}</strong><strong>{metric(sumResult(rows, "likes"), language)}</strong></div>}
    </div></div>{rows.length === 0 && <div className="empty-week">{t("本周该渠道暂无视频。", "No videos on this channel this week.")}</div>}</article>;
}

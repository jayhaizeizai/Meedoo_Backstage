"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./app-shell";
import { useLanguage } from "./language-provider";
import { GenerationWorkspace } from "./generation-workspace";
import { clearGenerationDraft } from "./use-generation-draft";
import { seedanceErrorReason } from "../lib/generation-error-reasons";
import type { PlanOutput } from "../lib/assignments/model";
import "../styles/assignments.css";

type Asset = { id: string; name: string; url: string };
type Assignment = { assignee_id: string | null; assignee_name: string | null; creator_name: string; deadline: string | null; can_edit: boolean; is_admin: boolean; id: string; title: string; brief: string; summary: string; storyboard_prompt: string; storyboard_asset_id: string | null; version: number };
type Shot = { id: string; position: number; title: string; prompt: string; duration: number; reference_asset_id: string | null };
type Run = { owner_id: string; id: string; shot_id: string | null; kind: string; status: string; error_code: string | null; provider_error: { code?: string } | null; input: Record<string, unknown>; asset_id: string | null; image_available: boolean; video_id: string | null; downloadable: boolean };
type Plan = { id: string; kind: string; status: string; output: PlanOutput | null; error_code: string | null; source_version: number; applied_at: string | null };
type Detail = { currentUserId: string; members: { open_id: string; name: string }[]; assignment: Assignment; shots: Shot[]; runs: Run[]; plans: Plan[]; availableAssets: string[]; plannerConfigured: boolean };
const deadlineInput = (value: string | null) => value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0,16) : "";
const deadlineValue = (value: string) => new Date(`${value}:00+08:00`).toISOString();
const deadlineLabel = (value: string | null) => value ? new Date(value).toLocaleString("en-SG", { timeZone: "Asia/Singapore", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " SGT" : "—";
const pending = (status: string) => ["reserved", "queued", "preparing", "submitting", "running", "submitted_unknown"].includes(status);

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw Error(data.code || "UNAVAILABLE"); return data;
}
function reason(code: string, text: (zh: string, en: string) => string) {
  const map: Record<string, [string, string]> = {
    REQUEST_CONFLICT: ["内容已变更，请刷新后重试；旧 AI 草稿不能覆盖新版本。", "Content changed. Refresh and retry; an older AI draft cannot overwrite a newer version."],
    INVALID_INPUT: ["请检查必填内容、时长和生成设置。", "Check required fields, duration and generation settings."],
    INVALID_ASSETS: ["参考图片已失效或不可用，请重新上传。", "Reference image is unavailable. Upload it again."],
    INVALID_IMAGE: ["请上传符合要求的 JPG、PNG 或 WebP 图片（最大 30 MB）。", "Upload a valid JPG, PNG or WebP image (maximum 30 MB)."],
    TOO_MANY_TASKS: ["已有任务正在处理，或已达到任务版本上限，请稍后再试。", "Tasks are processing or the version limit was reached. Try again later."],
    GENERATION_PENDING: ["该分镜已有任务处理中或结果待核对，请先等待结果。", "This shot has a pending or uncertain generation. Wait for its result."],
    SHOTS_HAVE_GENERATIONS: ["已有分镜生成过视频，不能整体替换；请逐条修改或新增分镜。", "Shots have video generations. Edit or add shots individually instead of replacing them."],
    NOT_CONFIGURED: ["生成服务尚未配置，请联系管理员。", "Generation service is not configured. Contact an administrator."],
    PLANNER_MODEL_UNAVAILABLE: ["摘要／拆镜模型尚未开通，请管理员在火山方舟开通或配置可用模型。", "The planning model is unavailable. Ask an administrator to activate or configure it in Ark."],
    PLANNER_ACCESS_DENIED: ["摘要／拆镜模型访问被拒绝，请管理员检查授权。", "Planning model access denied. Ask an administrator to check authorization."],
    SUBMISSION_UNCERTAIN: ["平台是否接收尚待核对，请勿重复生成。", "Provider acceptance is uncertain. Do not submit another generation."],
    PLANNER_PROVIDER_ERROR: ["规划服务返回错误，可稍后重试。", "The planning service returned an error. Try again later."],
    PLANNER_FAILED: ["AI 规划失败或超时，未覆盖已有内容。可重新发起。", "AI planning failed or timed out. Existing content was preserved. You may retry."],
    PLANNER_INTERRUPTED: ["规划请求中断，未自动重复提交。可重新发起。", "Planning was interrupted and was not automatically resubmitted. You may retry."],
    INVALID_AI_RESULT: ["AI 返回的内容不完整或格式不正确，请重试或手动编辑。", "AI returned incomplete or invalid content. Retry or edit manually."],
    NO_DOWNLOADS: ["暂无可下载的视频，生成文件可能已过期。", "No downloadable videos; generated files may have expired."],
    ARCHIVE_TOO_LARGE: ["打包文件超过 3 GB，请分别下载各视频。", "Archive exceeds 3 GB. Download videos individually."],
    FORBIDDEN: ["只有负责人、任务创建人（未分配时）和管理员可以修改。", "Only the owner, creator of an unassigned task, or an administrator can edit."],
    NOT_FOUND: ["任务不存在或无权访问。", "Task not found or access denied."],
    UNAUTHORIZED: ["登录已过期，请重新登录。", "Your session expired. Sign in again."],
  };
  return map[code] ? text(...map[code]) : text("操作失败，请稍后重试。", "Operation failed. Please try again.") + ` (${code})`;
}
function Status({ value }: { value: string }) {
  const { text } = useLanguage();
  const labels: Record<string, [string, string]> = { queued: ["排队中", "Queued"], reserved: ["准备提交", "Preparing submission"], preparing: ["准备素材", "Preparing media"], submitting: ["提交中", "Submitting"], running: ["生成中", "Generating"], succeeded: ["已完成", "Completed"], failed: ["失败", "Failed"], submitted_unknown: ["结果待核对", "Result uncertain"] };
  return <span className={`assignment-status ${value}`}>{labels[value] ? text(...labels[value]) : value}</span>;
}
async function uploadImage(file: File): Promise<Asset> {
  if (file.size > 30 * 1024 * 1024) throw Error("INVALID_IMAGE");
  const form = new FormData(); form.set("file", file);
  const response = await fetch("/api/generation/assets", { method: "POST", body: form });
  const payload = await response.json(); if (!response.ok) throw Error(payload.code || "INVALID_IMAGE"); return payload.asset;
}

export function AssignmentsPage() {
  const { text } = useLanguage();
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<{ id: string; title: string; summary: string; shot_count: number; assignee_id: string | null; assignee_name: string | null; deadline: string | null }[]>([]);
  const [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const [title, setTitle] = useState(""), [brief, setBrief] = useState(""), [deadline, setDeadline] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const createId = useRef<string | null>(null);
  useEffect(() => { setSelected(new URLSearchParams(window.location.search).get("id")); }, []);
  const list = useCallback(async () => { try { const data = await api<{ assignments: typeof rows; pages: number }>(`/api/assignments?page=${page}`); setRows(data.assignments); setPages(data.pages); } catch (e) { setError((e as Error).message); } }, [page]);
  useEffect(() => { if (!selected) void list(); }, [list, selected]);
  function select(id: string | null) { setSelected(id); window.history.replaceState(null, "", id ? `/assignments?id=${id}` : "/assignments"); setError(""); }
  async function create() {
    setBusy(true); setError("");
    try { createId.current ??= crypto.randomUUID(); const data = await api<{ id: string }>("/api/assignments", "POST", { id: createId.current, title, brief, deadline: deadlineValue(deadline) }); createId.current = null; setTitle(""); setBrief(""); setDeadline(""); select(data.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <AppShell active="assignments" status={{ zh: "任务创作", en: "Assignment studio" }}><section className="page assignment-page">
    <div className="head"><div><p className="eyebrow">BRIEF · STORYBOARD · SHOTS</p><h1>{text("任务系统", "Assignment System")}</h1><p>{text("从创意需求到逐镜生成，让一个任务里的素材和成片集中在一起。", "Keep your brief, storyboard, shots and generated videos together.")}</p></div>{selected && <button onClick={() => select(null)}>{text("返回任务列表", "All assignments")}</button>}</div>
    {error && <p className="assignment-error" role="alert">{reason(error, text)}</p>}
    {selected ? <AssignmentWorkspace key={selected} id={selected} onClose={() => select(null)} /> : <>
      <section className="card assignment-card"><h2>{text("创建任务", "New assignment")}</h2><label>{text("任务名称", "Assignment title")}<input value={title} maxLength={160} onChange={e => { setTitle(e.target.value); createId.current = null; }} /></label><label>{text("创作需求", "Creative brief")}<textarea rows={5} maxLength={16000} placeholder={text("描述产品、观众、故事、风格、目标时长……", "Describe the product, audience, story, style, target duration…")} value={brief} onChange={e => { setBrief(e.target.value); createId.current = null; }} /></label><label>{text("截止时间（新加坡时间）", "Deadline (Singapore time)")}<input type="datetime-local" value={deadline} required onChange={e => { setDeadline(e.target.value); createId.current = null; }} /></label><small>{text("新任务默认为未分配，所有成员可见。", "New assignments start unassigned and are visible to everyone.")}</small><button className="primary" disabled={busy || !title.trim() || !brief.trim() || !deadline} onClick={() => void create()}>{busy ? text("创建中…", "Creating…") : text("创建任务", "Create assignment")}</button></section>
      <div className="assignment-list">{rows.map(row => <button className="card assignment-list-item" key={row.id} onClick={() => select(row.id)}><strong>{row.title}</strong><div className="assignment-actions"><span className="assignment-status">{row.assignee_id ? text("已分配", "Assigned") : text("未分配", "Unassigned")}</span>{row.assignee_name && <small>{row.assignee_name}</small>}</div><small className={row.deadline && Date.parse(row.deadline) < Date.now() ? "assignment-overdue" : ""}>{text("截止：", "Due: ")}{deadlineLabel(row.deadline)}</small><p>{row.summary || text("尚未生成摘要", "No summary yet")}</p><small>{row.shot_count} {text("个分镜", "shots")} →</small></button>)}</div>
      <div className="assignment-actions"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>{text("上一页", "Previous")}</button><span>{page} / {pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)}>{text("下一页", "Next")}</button></div>
    </>}
  </section></AppShell>;
}

function AssignmentWorkspace({ id, onClose }: { id: string; onClose: () => void }) {
  const { text } = useLanguage();
  const [data, setData] = useState<Detail | null>(null), [error, setError] = useState("");
  const [activeShotId,setActiveShotId]=useState<string|null>(null);
  const [shotBusy,setShotBusy]=useState(false);
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState<Plan | null>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const refresh = useCallback(async () => { const result = await api<Detail>(`/api/assignments/${id}`); setData(result); return result; }, [id]);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  const polling = data?.plans.some(p => ["queued", "running"].includes(p.status)) || data?.runs.some(r => pending(r.status));
  useEffect(() => { if (!polling) return; const timer = setInterval(() => { void refresh().catch(e => setError(e.message)); }, 6000); return () => clearInterval(timer); }, [polling, refresh]);
  async function act(body: Record<string, unknown>, method = "PATCH") {
    if (busy) return; setBusy(true); setError("");
    try { await api(`/api/assignments/${id}`, method, { version: data!.assignment.version, ...body }); try { await refresh(); } catch (e) { if (body.action === "assign" && (e as Error).message === "NOT_FOUND") { onClose(); return; } throw e; } }
    catch (e) { setError((e as Error).message); throw e; } finally { setBusy(false); }
  }
  async function download() {
    // A normal navigation streams the archive to disk instead of buffering video blobs in JS.
    try { await api(`/api/assignments/${id}/download?check=1`); downloadRef.current?.click(); } catch (e) { setError((e as Error).message); }
  }
  if (!data) return <p role="status">{error ? reason(error, text) : text("读取任务…", "Loading assignment…")}</p>;
  const activeShot=data.shots.find(s=>s.id===activeShotId)??data.shots[0];
  const activeIndex=activeShot?data.shots.findIndex(s=>s.id===activeShot.id):0;
  const downloadable = data.runs.filter(r => r.kind === "video" && r.status === "succeeded" && r.downloadable).length;
  return <>
    {error && <p className="assignment-error" role="alert">{reason(error, text)}</p>}
    <div className="assignment-actions"><button disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>{text("刷新状态", "Refresh status")}</button><button disabled={!downloadable} onClick={() => void download()}>{text("下载全部已完成视频", "Download all completed videos")} ({downloadable}) ↓</button><a ref={downloadRef} href={`/api/assignments/${id}/download`} hidden download>ZIP</a><small>{text("生成图片和视频保留 14 天，请及时下载。", "Generated images and videos are kept for 14 days. Download them in time.")}</small></div>
    <AssignmentAccess key={`access:${data.assignment.version}`} data={data} busy={busy} act={act} />
    <AssignmentEditor key={data.assignment.version} data={data} busy={busy || !data.assignment.can_edit} act={act} onError={setError} />
    {data.plans.slice(0, 4).map(plan => <section className="card assignment-card" key={plan.id}>
      <div className="assignment-actions"><h3>{plan.kind === "summary" ? text("AI 摘要草稿", "AI summary draft") : text("AI 分镜草稿", "AI shot draft")}</h3><Status value={plan.status} /></div>
      {plan.error_code && <p className="assignment-error">{reason(plan.error_code, text)}</p>}
      {plan.output && <><p className="assignment-prewrap">{plan.output.summary}</p>{plan.kind === "shots" && <ol>{plan.output.shots.map((shot, i) => <li key={i}><strong>{shot.title} · {shot.duration}s</strong><p>{shot.prompt}</p></li>)}</ol>}<button disabled={busy || !data.assignment.can_edit || Boolean(plan.applied_at) || plan.source_version !== data.assignment.version} onClick={() => setConfirm(plan)}>{plan.applied_at ? text("已采用", "Applied") : plan.source_version !== data.assignment.version ? text("旧版本草稿", "Outdated draft") : text("采用此草稿", "Apply draft")}</button></>}
    </section>)}
    <section className="assignment-shots"><div className="assignment-actions"><h2>{text("03 · 分镜与视频", "03 · Shots & videos")}</h2><button disabled={busy || !data.assignment.can_edit || data.shots.length >= 24} onClick={() => void act({ action: "add_shot", title: text("新分镜", "New shot"), prompt: text("描述这个镜头的主体、动作和镜头运动。", "Describe the subject, action and camera movement."), duration: 6, referenceAssetId: null }).catch(() => {})}>{text("新增分镜", "Add shot")}</button></div>
      {!data.shots.length && <p>{text("先生成并采用分镜草稿，也可以手动新增。", "Generate and apply a shot draft, or add shots manually.")}</p>}
      {activeShot && <>
        <div className="assignment-shot-nav" aria-label={text("分镜切换", "Shot navigation")}>
          <button disabled={shotBusy||activeIndex===0} onClick={()=>setActiveShotId(data.shots[activeIndex-1].id)}>← {text("上一分镜", "Previous shot")}</button>
          <label>{text("当前分镜", "Current shot")}<select value={activeShot.id} disabled={shotBusy} onChange={e=>setActiveShotId(e.target.value)}>{data.shots.map((s,i)=><option key={s.id} value={s.id}>{i+1} / {data.shots.length} · {s.title}</option>)}</select></label>
          <button disabled={shotBusy||activeIndex===data.shots.length-1} onClick={()=>setActiveShotId(data.shots[activeIndex+1].id)}>{text("下一分镜", "Next shot")} →</button>
        </div>
        <ShotEditor assignmentId={id} currentUser={data.currentUserId} key={activeShot.id} shot={activeShot} busy={busy||!data.assignment.can_edit} act={act} onBusyChange={setShotBusy} onSubmitted={()=>void refresh().catch(e=>setError(e.message))}/>
      </>}
    </section>
    {confirm && <div className="assignment-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="assignment-confirm" className="card assignment-modal"><h2 id="assignment-confirm">{text("采用 AI 草稿？", "Apply AI draft?")}</h2><p>{confirm.kind === "shots" ? text("这将替换当前未生成视频的分镜列表。", "This replaces the current shot list, provided it has no video generations.") : text("这将替换当前摘要和故事板提示词。", "This replaces the current summary and storyboard prompt.")}</p><div className="assignment-actions"><button onClick={() => setConfirm(null)}>{text("取消", "Cancel")}</button><button disabled={busy} onClick={() => void act({ action: "apply_plan", planId: confirm.id }).then(() => setConfirm(null)).catch(() => {})}>{text("确认采用", "Apply")}</button></div></section></div>}
  </>;
}

type Act = (body: Record<string, unknown>, method?: string) => Promise<void>;
function AssignmentAccess({ data, busy, act }: { data: Detail; busy: boolean; act: Act }) {
  const { text } = useLanguage();
  const a = data.assignment;
  const [assignee, setAssignee] = useState(a.assignee_id || ""), [deadline, setDeadline] = useState(deadlineInput(a.deadline));
  return <section className="card assignment-card">
    <div className="assignment-actions"><h2>{text("任务管理", "Assignment management")}</h2><span className="assignment-status">{a.assignee_id ? text("已分配", "Assigned") : text("未分配", "Unassigned")}</span><span>{text("创建人：", "Created by: ")}{a.creator_name}</span></div>
    <p>{a.assignee_id ? text("仅负责人和管理员可见", "Visible only to the owner and administrators") : text("所有成员可见，可以领取此任务", "Visible to everyone; you can claim this assignment")}</p>
    <div className="assignment-settings"><label>{text("负责人", "Owner")}<select disabled={busy || !a.can_edit} value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">{text("未分配", "Unassigned")}</option>{data.members.map(member => <option key={member.open_id} value={member.open_id}>{member.name}</option>)}</select></label><label>{text("截止时间（新加坡时间）", "Deadline (Singapore time)")}<input type="datetime-local" required value={deadline} disabled={busy || !a.can_edit} onChange={e => setDeadline(e.target.value)} /></label></div>
    <div className="assignment-actions">{a.can_edit && <button disabled={busy || !deadline} onClick={() => void act({ action: "assign", assigneeId: assignee || null, deadline: deadlineValue(deadline) }).catch(() => {})}>{text("保存分配与截止时间", "Save owner & deadline")}</button>}{!a.assignee_id && <button disabled={busy || !deadline} onClick={() => void act({ action: "assign", assigneeId: data.currentUserId, deadline: deadlineValue(deadline) }).catch(() => {})}>{text("领取任务", "Claim assignment")}</button>}{a.deadline && Date.parse(a.deadline) < Date.now() && <span className="assignment-overdue">{text("已逾期", "Overdue")}</span>}</div>
  </section>;
}

function AssignmentEditor({ data, busy, act, onError }: { data: Detail; busy: boolean; act: Act; onError: (error: string) => void }) {
  const { text } = useLanguage(); const a = data.assignment;
  const [title, setTitle] = useState(a.title), [brief, setBrief] = useState(a.brief), [summary, setSummary] = useState(a.summary), [prompt, setPrompt] = useState(a.storyboard_prompt);
  const [asset, setAsset] = useState(a.storyboard_asset_id), [uploading, setUploading] = useState(false);
  const [quality, setQuality] = useState("2K");
  const request = useRef<string | null>(null);
  const dirty = title !== a.title || brief !== a.brief || summary !== a.summary || prompt !== a.storyboard_prompt || asset !== a.storyboard_asset_id;
  const disabled = busy || uploading;
  const save = (assetId = asset) => act({ action: "save", title, brief, summary, storyboardPrompt: prompt, storyboardAssetId: assetId });
  async function upload(file?: File) { if (!file) return; setUploading(true); try { const image = await uploadImage(file); setAsset(image.id); } catch(e) { onError((e as Error).message); } finally { setUploading(false); } }
  async function storyboard() { request.current ??= crypto.randomUUID(); try { await act({ action: "storyboard", requestId: request.current, input: { requestId: request.current, prompt, ratio: "16:9", quality, baseAssetId: asset } }, "POST"); request.current = null; } catch {} }
  const boardRuns = data.runs.filter(r => r.kind === "storyboard" && !r.shot_id);
  return <div className="assignment-top-grid">
    <section className="card assignment-card"><h2>{text("01 · 需求与摘要", "01 · Brief & summary")}</h2>
      <label>{text("任务名称", "Title")}<input value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label>
      <label>{text("创作需求", "Creative brief")}<textarea rows={6} value={brief} maxLength={16000} onChange={e => setBrief(e.target.value)} /></label>
      <label>Summary<textarea rows={5} value={summary} maxLength={5000} onChange={e => setSummary(e.target.value)} /></label>
      <div className="assignment-actions"><button disabled={disabled || !dirty} onClick={() => void save().catch(() => {})}>{text("保存内容", "Save changes")}</button><button disabled={disabled || dirty || data.plans.some(p => ["queued", "running"].includes(p.status))} onClick={() => void act({ action: "plan", kind: "summary", requestId: crypto.randomUUID() }, "POST").catch(() => {})}>{text("生成摘要", "Generate summary")}</button></div>
      {dirty && <small>{text("有未保存修改，保存后可生成或拆镜。", "Save your changes before generating or planning shots.")}</small>}
    </section>
    <section className="card assignment-card"><h2>{text("02 · 故事板", "02 · Storyboard")}</h2>
      {asset ? <><img className="assignment-board" src={(asset === a.storyboard_asset_id || boardRuns.some(run => run.asset_id === asset)) ? `/api/assignments/${a.id}/media/${asset}` : `/api/generation/assets/${asset}`} alt={text("故事板", "Storyboard")} /><a href={(asset === a.storyboard_asset_id || boardRuns.some(run => run.asset_id === asset)) ? `/api/assignments/${a.id}/media/${asset}?download=1` : `/api/generation/assets/${asset}?download=1`} download>{text("下载故事板", "Download storyboard")}</a><button disabled={disabled} onClick={() => setAsset(null)}>{text("清除当前故事板", "Clear storyboard")}</button></> : <div className="assignment-placeholder">{text("上传外部故事板，或用 Seedream 生成", "Upload a storyboard, or generate one with Seedream")}</div>}
      <label className="assignment-file">{uploading ? text("上传中…", "Uploading…") : text("上传故事板图片", "Upload storyboard image")}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
      <label>{text("故事板提示词", "Storyboard prompt")}<textarea rows={4} maxLength={3800} value={prompt} onChange={e => { setPrompt(e.target.value); request.current = null; }} /></label>
      <div className="assignment-actions"><label>{text("图片质量", "Quality")}<select value={quality} onChange={e => { setQuality(e.target.value); request.current = null; }}>{["1K", "1.5K", "2K"].map(q => <option key={q}>{q}</option>)}</select></label><button disabled={disabled || dirty || !prompt.trim() || boardRuns.some(r => pending(r.status))} onClick={() => void storyboard()}>{text("生成故事板", "Generate storyboard")}</button><button disabled={disabled || dirty || data.plans.some(p => ["queued", "running"].includes(p.status))} onClick={() => void act({ action: "plan", kind: "shots", requestId: crypto.randomUUID() }, "POST").catch(() => {})}>{asset ? text("根据故事板拆镜", "Plan shots from storyboard") : text("根据需求拆镜", "Plan shots from brief")}</button></div>
      {dirty && <button disabled={disabled} onClick={() => void save().catch(() => {})}>{text("保存故事板与内容", "Save storyboard & content")}</button>}
      <div className="assignment-board-history">{boardRuns.map(run => <div className="assignment-run" key={run.id}><Status value={run.status} />{run.image_available && run.asset_id && <><img src={`/api/assignments/${a.id}/media/${run.asset_id}`} alt={text("生成的故事板", "Generated storyboard")} /><button disabled={disabled} onClick={() => { setAsset(run.asset_id); }}>{text("选为当前故事板", "Use as storyboard")}</button><a href={`/api/assignments/${a.id}/media/${run.asset_id}?download=1`} download>{text("下载图片", "Download image")}</a></>}<RunError run={run} />{run.status === "reserved" && run.owner_id === data.currentUserId && <button disabled={disabled} onClick={() => void act({ action: "storyboard", requestId: run.id, input: run.input }, "POST").catch(() => {})}>{text("恢复提交", "Resume submission")}</button>}</div>)}</div>
    </section>
  </div>;
}

function RunError({ run }: { run: Run }) {
  const { text } = useLanguage();
  if (!run.error_code) return null;
  const providerCode = run.provider_error?.code;
  return <details className="assignment-error"><summary>{text("查看失败／待核对原因", "Failure / uncertainty details")}</summary><p>{providerCode ? text(...seedanceErrorReason(providerCode)) : reason(run.error_code, text)}</p><code>{providerCode || run.error_code}</code></details>;
}
function ShotEditor({assignmentId,currentUser,shot,busy,act,onBusyChange,onSubmitted}:{assignmentId:string;currentUser:string;shot:Shot;busy:boolean;act:Act;onBusyChange:(value:boolean)=>void;onSubmitted:()=>void}) {
  const {text}=useLanguage();
  const [title,setTitle]=useState(shot.title),[epoch,setEpoch]=useState(0);
  return <article className="assignment-shot">
    <div className="card assignment-card"><div className="assignment-actions"><span className="assignment-shot-number">{String(shot.position).padStart(2,"0")}</span><h3>{shot.title}</h3></div>
      <label>{text("分镜标题","Shot title")}<input disabled={busy} value={title} maxLength={160} onChange={e=>setTitle(e.target.value)}/></label>
      <button disabled={busy||!title.trim()||title===shot.title} onClick={()=>void act({action:"save_shot",shotId:shot.id,title,prompt:shot.prompt,duration:shot.duration,referenceAssetId:shot.reference_asset_id}).catch(()=>{})}>{text("保存标题","Save title")}</button>
    </div>
    <GenerationWorkspace key={epoch} ownerId={currentUser} scope={{assignmentId,shotId:shot.id,prompt:shot.prompt,duration:shot.duration,referenceAssetId:shot.reference_asset_id}} readOnly={busy} onBusyChange={onBusyChange} onSubmitted={onSubmitted} onReset={()=>{clearGenerationDraft(`${currentUser}:assignment:${assignmentId}:shot:${shot.id}`);setEpoch(v=>v+1);}}/>
  </article>;
}

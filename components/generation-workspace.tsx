"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GenerationPagination, type HistoryPagination } from "./generation-pagination";
import { GenerationImageStudio } from "./generation-image-studio";
import { useAuth } from "./auth-provider";
import { useGenerationDraft, clearGenerationDraft } from "./use-generation-draft";
import { videoDraft } from "../lib/generation-draft";
import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
import { useLanguage } from "./language-provider";
import { useReferenceCompression } from "./generation-image-compression";
import {
  generationRatios,
  shouldRenewGenerationRequest,
  generationModels,
  generationModel,
  type GenerationModel,
  type GenerationInput,
} from "../lib/generation-model";
import "../styles/generation.css";
import { seedanceErrorReason } from "../lib/generation-error-reasons";

type Asset = {
  id: string;
  name: string;
  url: string;
  duration?: number;
  role: GenerationInput["assets"][number]["role"];
};
type Task = {
  id: string;
  owner_name: string;
  requirement: string;
  input: GenerationInput;
  status: string;
  usage: Record<string, number> | null;
  available: boolean;
  expired: boolean;
  media_expires_at: string | null;
  error_code: string | null;
  provider_error?: { code?: string; request_id?: string; parameter?: string; http_status?: number } | null;
  created_at: string;
};
export type ShotScope = { assignmentId: string; shotId: string; prompt: string; duration: number; referenceAssetId: string | null };
export function GenerationWorkspace({ownerId,onReset,scope,readOnly=false,onBusyChange,onSubmitted}:{ownerId:string;onReset:()=>void;scope?:ShotScope;readOnly?:boolean;onBusyChange?:(value:boolean)=>void;onSubmitted?:()=>void}) {
  const apiBase = scope ? `/api/assignments/${scope.assignmentId}/shots/${scope.shotId}/generation` : "/api/generation";
  const draftOwner = scope ? `${ownerId}:assignment:${scope.assignmentId}:shot:${scope.shotId}` : ownerId;

  const { text, language } = useLanguage();
  const compression = useReferenceCompression();
  const [model, setModel] = useState<GenerationModel>("minimax-h3");
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [imageSync, setImageSync] = useState<Record<string, string>>({});
  const settings = generationModel(model);
  const [mode, setMode] = useState<"reference" | "frames">("reference"),
    [assets, setAssets] = useState<Asset[]>([]),
    [prompt, setPrompt] = useState(scope?.prompt ?? ""),
    [duration, setDuration] = useState(scope?.duration ?? 6),
    [ratio, setRatio] = useState("9:16"),
    [resolution, setResolution] =
      useState<GenerationInput["resolution"]>("768P");
  const [rightTab, setRightTab] = useState<"video" | "image">("image");
  const [ownTasks, setOwnTasks] = useState<Task[]>([]);
  const [failureTask, setFailureTask] = useState<Task | null>(null);
  const failureDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (failureTask && !failureDialog.current?.open) failureDialog.current?.showModal();
  }, [failureTask]);
  const [historyPage,setHistoryPage]=useState(1);
  const [historyLoading,setHistoryLoading]=useState(false);
  const historyRequest=useRef(0);
  const [paging,setPaging]=useState<HistoryPagination>({page:1,pageSize:20,total:0,totalPages:1});
  const [tasks, setTasks] = useState<Task[]>([]),
    [configured, setConfigured] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [refreshing, setRefreshing] = useState(false);
  const intent = useRef<{ fingerprint: string; id: string } | null>(null),
    pending = useRef(false),
    polling = useRef(false);
  const [imageBusy,setImageBusy]=useState(false);
  const resetDialog=useRef<HTMLDialogElement>(null);
  const snapshot={model,generateAudio,mode,assets,prompt,duration,ratio,resolution,rightTab,selected,intent:intent.current};
  const draftRestored=useRef(false);
  const draft=useGenerationDraft(draftOwner,"video",snapshot,(raw)=>{
    const d=videoDraft(raw);if(!d)return;draftRestored.current=true;
    setModel(d.model);setGenerateAudio(d.generateAudio);setMode(d.mode);setAssets(d.assets);setPrompt(d.prompt);setDuration(d.duration);setRatio(d.ratio);setResolution(d.resolution);setRightTab(d.rightTab);setSelected(d.selected);intent.current=d.intent;
    if(d.assets.length)void fetch(`${apiBase}/assets/resolve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:d.assets.map((a:Asset)=>a.id)})}).then(async r=>{if(!r.ok)return;const result=await r.json();const ids=new Set(result.assets.map((a:Asset & {sourceId?:string})=>a.sourceId??a.id));if(scope)setAssets(current=>current.flatMap(a=>{const found=result.assets.find((f:Asset & {sourceId?:string})=>(f.sourceId??f.id)===a.id);return found?[{...found,role:a.role}]:[];}));if(d.assets.some((a:Asset)=>!ids.has(a.id))){setAssets(current=>current.filter(a=>!d.assets.some((old:Asset)=>old.id===a.id)||ids.has(a.id)));setError(text("部分草稿图片已过期或不可用，请重新选择。","Some draft images expired or are unavailable. Select them again."));}}).catch(()=>{});
  });
  useEffect(()=>{onBusyChange?.(busy||uploading||imageBusy);return()=>onBusyChange?.(false);},[busy,uploading,imageBusy,onBusyChange]);
  useEffect(()=>{
    if(!scope?.referenceAssetId || readOnly)return;
    if(draftRestored.current)return;
    let active=true;
    void fetch(`${apiBase}/assets/resolve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:[scope.referenceAssetId]})}).then(async r=>{if(!r.ok)return;const result=await r.json();if(active&&result.assets?.length)setAssets([{...result.assets[0],role:"reference_image"}]);}).catch(()=>{});
    return()=>{active=false;};
  },[apiBase]);
  async function refill(task:Task){
    if(busy||uploading)return;setBusy(true);setError("");
    try{const r=await fetch(`${apiBase}/${task.id}/restore`,{method:scope?"POST":"GET",cache:"no-store"});if(!r.ok)throw Error("UNAVAILABLE");const d=await r.json(),v=d.input;
      setModel(v.model??"minimax-h3");setGenerateAudio(v.generateAudio??true);setMode(v.mode);setAssets(d.assets);setPrompt(v.prompt);setDuration(v.duration);setRatio(v.ratio);setResolution(v.resolution);setSelected(task.id);setRightTab("video");intent.current=null;
      setError(d.missing?text(`已回填，${d.missing} 张图片已过期或不可用，请重新选择。`,`Restored; ${d.missing} images are unavailable. Select replacements.`):text("已回填，可修改后重新生成。","Restored. Edit the settings, then generate when ready."));
      window.scrollTo({top:0,behavior:"smooth"});
    }catch{setError(text("无法回填该任务，请刷新后重试。","Unable to restore this task. Refresh and retry."));}finally{setBusy(false);}
  }
  const status = (s: string) =>
    ({
      preparing: text("正在同步参考素材", "Syncing reference media"),
      submitting: text("正在提交", "Submitting"),
      queued: text("排队中", "Queued"),
      running: text("生成中", "Generating"),
      succeeded: text("已生成", "Generated"),
      failed: text("失败", "Failed"),
      cancelled: text("已取消", "Cancelled"),
      submitted_unknown: text(
        "提交结果待核对，请勿重复生成",
        "Submission uncertain; do not resubmit",
      ),
    })[s] || s;
  const message = (code: string) =>
    ({
      NOT_CONFIGURED: text(
        "服务尚未配置，请联系管理员。",
        "Service is not configured. Contact an administrator.",
      ),
      INVALID_REFERENCE_MEDIA: text("素材不符合要求：视频需 MP4/MOV、H.264/H.265、24–60 fps、最大 50 MB；音频需 MP3/WAV、最大 15 MB。每段 2–15 秒。", "Invalid reference: MP4/MOV H.264/H.265 video, 24–60 fps, up to 50 MB; MP3/WAV audio up to 15 MB. Each clip must be 2–15s."),
      REFERENCE_DURATION_EXCEEDED: text("参考视频或音频总时长超过 15 秒，请移除部分素材。", "Reference video or audio exceeds 15s in total. Remove some clips."),
      INVALID_IMAGE: text(
        "图片须为 JPG、PNG、WEBP 或 HEIC，最大 30 MB，宽高 256–5760 像素，宽高比 0.4–2.5。",
        "Use JPG, PNG, WEBP or HEIC up to 30 MB, 256–5760 pixels per side, aspect ratio 0.4–2.5.",
      ),
      COMPRESSION_FAILED: text(
        "浏览器无法压缩这张图片。请重新选择图片并保留原图上传，或先转换为 JPG / PNG。",
        "Your browser could not compress this image. Select it again and upload the original, or convert it to JPG / PNG first.",
      ),
      TOO_MANY_TASKS: text(
        "最多同时处理 3 个任务，请等待当前任务完成。",
        "Up to 3 tasks can run at once. Please wait.",
      ),
      INVALID_INPUT: text(
        "请检查提示词和生成参数。",
        "Check the prompt and generation settings.",
      ),
      GENERATION_PENDING: text("此分镜已有生成任务正在处理，请等待完成。", "This shot already has a pending generation. Please wait."),
      FORBIDDEN: text("只有负责人或管理员可以生成。", "Only the owner or an administrator can generate."),
      UNAUTHORIZED: text("请重新登录。", "Please sign in again."),
      REQUEST_CONFLICT: text(
        "任务参数已变更，请刷新后重试。",
        "Task parameters changed. Refresh and try again.",
      ),
    })[code] ||
    text(
      "暂时无法完成操作，请稍后刷新。",
      "This operation is unavailable. Please refresh later.",
    );
  const load = useCallback(async () => {
    const requestId=++historyRequest.current;
    setHistoryLoading(true);
    try {
    const r = await fetch(`${apiBase}?page=${historyPage}${selected?`&selected=${selected}`:""}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.code);
    if(requestId!==historyRequest.current)return;
    setTasks(d.tasks);
    setPaging(d.pagination);
    setOwnTasks(d.ownTasks ?? []);

    setConfigured(d.configured);
    setModels(d.models ?? ["minimax-h3"]);
    setLoaded(true);
    } finally {if(requestId===historyRequest.current)setHistoryLoading(false);}
  }, [historyPage,selected,apiBase]);
  useEffect(() => {
    void load().catch(() => {
      setLoaded(true);
      setError(
        language === "zh"
          ? "读取生成记录失败，请刷新。"
          : "Could not load generation history. Refresh to retry.",
      );
    });
  }, [load, language]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (polling.current || document.hidden) return;
      const active = ownTasks.filter(
        (t) =>
          ["preparing", "queued", "running"].includes(t.status) ||
          (t.status === "succeeded" && !t.available && !t.expired),
      );
      if (!active.length) return;
      polling.current = true;
      void (async () => {
        try {
          for (const t of active.slice(0, 3))
            await fetch(`${apiBase}/${t.id}/refresh`, { method: "POST" });
          await load();
        } catch {
        } finally {
          polling.current = false;
        }
      })();
    }, 15000);
    return () => clearInterval(timer);
  }, [ownTasks, load]);
  const syncImage = useCallback(async (id: string, retry = false, manual = false) => {
    try {
      if (retry) setImageSync((v) => ({ ...v, [id]: "pending" }));
      const response = await fetch(`/api/generation/assets/${id}/sync${manual ? "?retry=1" : ""}`, {
        method: retry ? "POST" : "GET", cache: "no-store",
      });
      if (!response.ok) throw Error("SYNC_UNAVAILABLE");
      const result = await response.json();
      setImageSync((v) => ({ ...v, [id]: result.status }));
    } catch {
      setImageSync((v) => ({ ...v, [id]: "unavailable" }));
    }
  }, []);
  useEffect(() => {
    if (model !== "minimax-h3" || !assets.length) return;
    let active = true, checking = false;
    // Includes images uploaded while another model was selected.
    void (async () => {
      for (const asset of assets.filter(a=>!["reference_video", "reference_audio"].includes(a.role))) {
        if (!active) break;
        await syncImage(asset.id, true);
      }
    })();
    const timer = setInterval(() => {
      if (!active || checking || document.hidden) return;
      checking = true;
      void (async () => {
        try { for (const asset of assets.filter(a=>!["reference_video", "reference_audio"].includes(a.role))) { if (!active) break; await syncImage(asset.id); } }
        finally { checking = false; }
      })();
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [assets, model, syncImage]);
  async function upload(files: FileList | null, role: Asset["role"]) {
    if (!files?.length || uploading || busy) return;
    const limit =
      role === "reference_image" ? settings.maxImages - assets.filter(a=>a.role === role).length : role === "reference_video" || role === "reference_audio" ? 3 - assets.filter(a=>a.role === role).length : 1;
    if (files.length > limit) {
      setError(
        text(
          `参考图最多 ${settings.maxImages} 张；参考视频、音频各最多 3 段；首尾帧各 1 张。`,
          `Up to ${settings.maxImages} images, 3 videos and 3 audio clips; one image per frame.`,
        ),
      );
      return;
    }
    setUploading(true);
    setError("");
    try {
      const media = role === "reference_video" || role === "reference_audio";
      const prepared = media ? Array.from(files) : await compression.prepareFiles(Array.from(files));
      if (!prepared) return;
      for (const file of prepared) {
        if (file.size > (role === "reference_video" ? 50 : role === "reference_audio" ? 15 : 30) * 1024 * 1024) throw Error(media ? "INVALID_REFERENCE_MEDIA" : "INVALID_IMAGE");
        const form = new FormData();
        form.set("file", file);
        form.set("model", model);
        form.set("kind", role === "reference_video" ? "video" : role === "reference_audio" ? "audio" : "image");
        const r = await fetch("/api/generation/assets", {
          method: "POST",
          body: form,
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.code);
        setAssets((a) => [
          ...(role.startsWith("reference_")
            ? a
            : a.filter((x) => x.role !== role)),
          { ...d.asset, role },
        ]);
      }
    } catch (e) {
      setError(message(e instanceof Error ? e.message : ""));
    } finally {
      setUploading(false);
    }
  }
  async function submit() {
    if (readOnly || pending.current || uploading) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const params = {
      model,
      ...(settings.provider === "ark" ? { generateAudio } : {}),
      prompt,
      mode,
      duration,
      resolution,
      ratio,
      assets: assets.map(({ id, role }) => ({ id, role })),
    };
    const fingerprint = JSON.stringify(params);
    const previousTask = ownTasks.find((task) => task.input.requestId === intent.current?.id);
    if (!intent.current || shouldRenewGenerationRequest(intent.current.fingerprint, fingerprint, previousTask?.status))
      intent.current = { fingerprint, id: crypto.randomUUID() };
    draft.save({...snapshot,intent:intent.current});
    try {
      const r = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, requestId: intent.current.id }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.code);
      setSelected(d.id);
      onSubmitted?.();
      await load();
    } catch (e) {
      setError(message(e instanceof Error ? e.message : ""));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const current = ownTasks.find((t) => t.id === selected) || ownTasks[0];
  const taskError = (task: Task) => (<>
                {task.error_code && (!task.provider_error || task.status === "submitted_unknown") && (
                  <p className="data-message">
                    {task.error_code === "INPUT_UPLOAD_FAILED"
                      ? text(
                          "参考图上传至生成平台失败，尚未提交视频生成。请重新发起任务。",
                          "Reference upload failed before video generation was submitted. Start a new task to retry.",
                        )
                      : task.error_code === "INPUT_MEDIA_UNREACHABLE"
                        ? text(
                            "生成平台无法读取参考图。请重新发起任务，系统会先缓存参考图。",
                            "The provider could not read a reference image. Start a new task to use cached references.",
                          )
                        : task.error_code === "PROVIDER_ACCESS_DENIED"
                          ? text(
                              "模型调用权限不足，请在对应平台确认模型已开通且密钥有权限。",
                              "Model access denied. Check activation and key permissions with the provider.",
                            )
                          : task.error_code === "PROVIDER_PAYMENT_REQUIRED"
                            ? text(
                                "平台余额或额度不足，请联系管理员。",
                                "Provider balance or quota is insufficient. Contact an administrator.",
                              )
                            : task.error_code === "OUTPUT_SAVE_PENDING"
                              ? text(
                                  "成片已生成，服务器保存待重试。请刷新。",
                                  "Video generated; saving needs another attempt. Refresh to retry.",
                                )
                              : task.status === "submitted_unknown"
                                ? text(
                                    "平台可能已接收任务，请联系管理员核对，避免重复扣费。",
                                    "The provider may have accepted this task. Ask an administrator to reconcile it before resubmitting.",
                                  )
                                : text(
                                    `任务未完成（${task.error_code}）。`,
                                    `Task not completed (${task.error_code}).`,
                                  )}
                  </p>
                )}
                {task.provider_error && (
                  <p className="data-message" role="status">
                    {task.input.model?.startsWith("seedance-")
                      ? text(...seedanceErrorReason(task.provider_error.code))
                      : text("生成平台返回错误，请凭下方错误码联系管理员。", "The provider returned an error. Contact an administrator with the code below.")}
                    {task.provider_error.code && <><br />{text("错误码：", "Error: ")}{task.provider_error.code}</>}
                    {task.provider_error.parameter && <><br />{text("相关参数：", "Parameter: ")}{task.provider_error.parameter}</>}
                    {task.provider_error.request_id && <><br />{text("请求编号：", "Request ID: ")}{task.provider_error.request_id}</>}
                  </p>
                )}
  </>);
  const input = (role: Asset["role"], label: string, multiple = false) => (
    <label className="generation-drop">
      <span>{label}</span>
      <small>
        {role === "reference_video" ? text("MP4 / MOV · 每段 2–15 秒 · 最大 50 MB", "MP4 / MOV · 2–15s each · up to 50 MB") : role === "reference_audio" ? text("MP3 / WAV · 每段 2–15 秒 · 最大 15 MB", "MP3 / WAV · 2–15s each · up to 15 MB") : text("选择图片 · 最大 30 MB", "Choose images · up to 30 MB")}
      </small>
      <input
        type="file"
        accept={role === "reference_video" ? ".mp4,.mov" : role === "reference_audio" ? ".mp3,.wav" : "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"}
        multiple={multiple}
        disabled={busy || uploading}
        onChange={(e) => {
          void upload(e.target.files, role);
          e.target.value = "";
        }}
      />
    </label>
  );
  return (
    <WorkspaceShell embedded={Boolean(scope)}>
      <section className={scope ? "generation-page assignment-generation" : "page generation-page"}>
        {compression.dialog}
        <header className="generation-header">
          <div>
            <p className="eyebrow">CREATE · REVIEW · PUBLISH</p>
            <h1>{scope ? text("分镜创作", "Shot studio") : text("生成视频", "Generate video")}</h1>
            <p>
              {text(
                "从分镜与参考图开始，把创意变成视频。",
                "Turn storyboards and reference images into video.",
              )}
            </p>
          </div>
          <div className="generation-header-actions">
          <button type="button" className="generation-reset" disabled={busy||uploading||imageBusy||!draft.ready} onClick={()=>resetDialog.current?.showModal()}>{text("重置","Reset")}</button>
          <span className="generation-badge">
            {settings.label} · {text("国内站", "China")}
          </span>
          </div>
        </header>
        {draft.unavailable && <p className="data-message">{text("浏览器存储不可用，离开页面后草稿可能丢失。","Browser storage is unavailable; drafts may be lost when leaving.")}</p>}
        {error && (
          <p role="alert" className="data-message error">
            {error}
          </p>
        )}
        {loaded && !configured && (
          <p className="data-message">
            {text(
              "生成服务尚未配置，请联系管理员。",
              "Generation service is not configured. Contact an administrator.",
            )}
          </p>
        )}
        <div className="generation-workspace">
          <fieldset disabled={readOnly} className="card generation-form">
            <h2>{text("创作设置", "Creation settings")}</h2>
            <label>
              {text("生成模型", "Generation model")}
              <select
                value={model}
                disabled={busy || uploading}
                onChange={(e) => {
                  const next = e.target.value as GenerationModel;
                  const options = generationModel(next);
                  setModel(next);
                  setResolution(options.provider === "ark" ? "720p" : "768P");
                  setDuration((d) => Math.max(options.minDuration, Math.min(d, options.maxDuration)));
                  intent.current = null;
                }}
              >
                {(Object.keys(generationModels) as GenerationModel[]).map(
                  (id) => (
                    <option key={id} value={id} disabled={!models.includes(id)}>
                      {generationModels[id].label}
                      {loaded && !models.includes(id)
                        ? text("（未配置）", " (not configured)")
                        : ""}
                    </option>
                  ),
                )}
              </select>
            </label>
            {settings.provider === "ark" && (
              <label>
                <span>{text("生成声音", "Generate audio")}</span>
                <select
                  value={String(generateAudio)}
                  onChange={(e) => setGenerateAudio(e.target.value === "true")}
                >
                  <option value="true">{text("开启", "On")}</option>
                  <option value="false">{text("关闭", "Off")}</option>
                </select>
              </label>
            )}
            {assets.filter(a=>a.role === "reference_image").length > settings.maxImages && (
              <p className="data-message">
                {text(
                  `当前模型最多支持 ${settings.maxImages} 张参考图，请移除多余图片。`,
                  `This model supports up to ${settings.maxImages} reference images. Remove extra images.`,
                )}
              </p>
            )}
            <div
              className="generation-tabs"
              role="group"
              aria-label={text("素材模式", "Input mode")}
            >
              {(["reference", "frames"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={busy || uploading}
                  className={mode === m ? "active" : ""}
                  onClick={() => {
                    if (m !== mode) {
                      setMode(m);
                      setAssets([]);
                    }
                  }}
                >
                  {m === "reference"
                    ? text("参考素材", "Reference media")
                    : text("首尾帧", "First & last frame")}
                </button>
              ))}
            </div>
            {mode === "reference" ? (
              input(
                "reference_image",
                text(
                  `添加参考图（最多 ${settings.maxImages} 张）`,
                  `Add reference images (up to ${settings.maxImages})`,
                ),
                true,
              )
            ) : (
              <div className="generation-frame-inputs">
                {input(
                  "first_frame",
                  text("首帧（必填）", "First frame (required)"),
                )}
                {input(
                  "last_frame",
                  text("尾帧（可选）", "Last frame (optional)"),
                )}
              </div>
            )}
            {mode === "reference" && <>
              <div className="generation-frame-inputs">
                {input("reference_video", text("添加参考视频（最多 3 段）", "Add reference videos (up to 3)"), true)}
                {input("reference_audio", text("添加参考音频（最多 3 段）", "Add reference audio (up to 3)"), true)}
              </div>
              <small>{text("参考视频合计不超过 15 秒，参考音频合计不超过 15 秒。Seedance 的音频参考需搭配图片或视频。", "Videos: up to 15s total. Audio: up to 15s total. Seedance audio references require an image or video.")}</small>
            </>}
            {uploading && (
              <small role="status">
                {compression.compressing
                  ? text("正在压缩图片…", "Compressing images…")
                  : text("正在准备并上传素材…", "Preparing and uploading media…")}
              </small>
            )}
            <div className="generation-assets">
              {assets.map((a, i) => (
                <div key={a.id} className={["reference_video", "reference_audio"].includes(a.role) ? "generation-media-asset" : undefined}>
                  <button
                    type="button"
                    onClick={() =>
                      setPrompt(
                        (p) =>
                          `${p} ${mode === "reference" ? `${a.role === "reference_video" ? "视频" : a.role === "reference_audio" ? "音频" : "图片"}${assets.slice(0,i+1).filter(x=>x.role===a.role).length}` : a.role === "first_frame" ? "首帧" : "尾帧"} `,
                      )
                    }
                    title={text("插入素材引用", "Insert media reference")}
                  >
                    {a.role === "reference_video" ? <span aria-label={a.name}>▶ {a.name}</span> : a.role === "reference_audio" ? <span aria-label={a.name}>♫ {a.name}</span> : <img src={a.url} alt={a.name} />}
                    <span>
                      {mode === "reference"
                        ? `${a.role === "reference_video" ? text("视频", "Video ") : a.role === "reference_audio" ? text("音频", "Audio ") : text("图片", "Image ")}${assets.slice(0,i+1).filter(x=>x.role===a.role).length}`
                        : a.role === "first_frame"
                          ? text("首帧", "First frame")
                          : text("尾帧", "Last frame")}
                    </span>
                    {a.duration !== undefined && <small>{a.duration.toFixed(1)}s</small>}
                  </button>
                  {a.role === "reference_video" && <video src={a.url} controls preload="metadata" style={{width:"100%",maxHeight:140}} />}
                  {a.role === "reference_audio" && <audio src={a.url} controls preload="metadata" style={{width:"100%"}} />}
                  {model === "minimax-h3" && !["reference_video", "reference_audio"].includes(a.role) && (
                    <div className="generation-image-status" aria-live="polite">
                      <small>{imageSync[a.id] === "ready"
                        ? text("已就绪", "Ready")
                        : imageSync[a.id] === "failed"
                          ? text("同步失败", "Sync failed")
                          : imageSync[a.id] === "retrying"
                            ? text("自动重试中", "Retrying")
                            : imageSync[a.id] === "unavailable"
                              ? text("状态读取失败", "Status unavailable")
                              : text("同步中…", "Syncing…")}</small>
                      {["failed", "unavailable"].includes(imageSync[a.id]) &&
                        <button type="button" onClick={() => void syncImage(a.id, true, true)}>
                          {text("重试", "Retry")}
                        </button>}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={busy || uploading}
                    className="generation-remove"
                    aria-label={text("移除素材", "Remove media")}
                    onClick={() =>
                      setAssets((v) => v.filter((x) => x.id !== a.id))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <label>
              {text("视频提示词", "Video prompt")}
              <textarea
                rows={6}
                maxLength={7000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={text(
                  "描述角色、动作、场景和镜头。点击素材可插入图片、视频或音频编号。",
                  "Describe the characters, action, setting and camera. Click a reference to insert its number.",
                )}
              />
              <small>{prompt.length} / 7000</small>
            </label>
            <div className="generation-settings">
              <label>
                {text("时长（秒）", "Duration (seconds)")}
                <input
                  type="number"
                  min={settings.minDuration}
                  max={settings.maxDuration}
                  step={1}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  aria-describedby="generation-duration-help"
                  aria-invalid={!Number.isInteger(duration) || duration < settings.minDuration || duration > settings.maxDuration}
                />
                <small id="generation-duration-help">
                  {text(`最短 ${settings.minDuration} 秒，最长 ${settings.maxDuration} 秒（整数秒）`, `Minimum ${settings.minDuration}s, maximum ${settings.maxDuration}s (whole seconds)`)}
                </small>
                {(!Number.isInteger(duration) || duration < settings.minDuration || duration > settings.maxDuration) && (
                  <small role="alert">{text(`请输入 ${settings.minDuration}–${settings.maxDuration} 之间的整数秒。`, `Enter a whole number from ${settings.minDuration} to ${settings.maxDuration} seconds.`)}</small>
                )}
              </label>
              <label>
                {text("画面比例", "Aspect ratio")}
                <select
                  value={ratio}
                  disabled={mode === "frames"}
                  onChange={(e) => setRatio(e.target.value)}
                >
                  {generationRatios.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                {text("清晰度", "Resolution")}
                <select
                  value={resolution}
                  onChange={(e) =>
                    setResolution(
                      e.target.value as GenerationInput["resolution"],
                    )
                  }
                >
                  {settings.resolutions.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>
            {mode === "frames" && (
              <small>
                {text(
                  "首尾帧模式的画面比例由图片决定。",
                  "In frame mode, the input images determine the aspect ratio.",
                )}
              </small>
            )}
            {settings.provider === "ark" && model !== "seedance-2.5" && assets.length > 12 && <p role="alert">{text("当前模型参考素材合计最多 12 个，请移除部分素材。", "This model supports up to 12 references in total.")}</p>}
            {settings.provider === "ark" && assets.some(a=>a.role === "reference_audio") && !assets.some(a=>["reference_image","reference_video"].includes(a.role)) && <p role="alert">{text("请搭配至少一张参考图或一段参考视频。", "Add at least one reference image or video with audio.")}</p>}
            {["reference_video", "reference_audio"].some(role=>assets.filter(a=>a.role===role).reduce((n,a)=>n+(a.duration??0),0)>15.05) && <p role="alert">{text("参考视频或音频合计超过 15 秒，请移除部分素材。", "Video or audio references exceed 15s in total.")}</p>}
            <button
              className="primary generation-submit"
              disabled={
                !configured ||
                (settings.provider === "ark" && assets.some(a=>a.role === "reference_audio") && !assets.some(a=>["reference_image","reference_video"].includes(a.role))) ||
                ["reference_video","reference_audio"].some(role=>assets.filter(a=>a.role===role).reduce((n,a)=>n+(a.duration??0),0)>15.05) ||
                busy ||
                uploading ||
                !prompt.trim() ||
                !Number.isInteger(duration) ||
                duration < settings.minDuration ||
                duration > settings.maxDuration ||
                !models.includes(model) ||
                assets.filter(a=>a.role === "reference_image").length > settings.maxImages ||
                assets.filter(a=>a.role === "reference_video").length > 3 || assets.filter(a=>a.role === "reference_audio").length > 3 ||
                (settings.provider === "ark" && model !== "seedance-2.5" && assets.length > 12) ||
                (model === "minimax-h3" && assets.some((a) => imageSync[a.id] === "failed")) ||
                (mode === "frames" &&
                  !assets.some((a) => a.role === "first_frame"))
              }
              onClick={() => void submit()}
            >
              {busy
                ? text("正在提交…", "Submitting…")
                : text("生成视频", "Generate video")}
            </button>
            {current && (
              <button
                type="button"
                className="generation-new"
                onClick={() => {
                  intent.current = null;
                  setPrompt("");
                  setSelected(null);
                }}
              >
                {text("开始新的创作", "Start a new creation")}
              </button>
            )}
          </fieldset>
          <div className="generation-right-column">
            <div className="generation-tabs" role="tablist" aria-label={text("创作预览", "Creative preview")}>
              {(["image", "video"] as const).map((tab) => <button key={tab} type="button" role="tab" id={`generation-tab-${tab}`} aria-selected={rightTab === tab} aria-controls={`generation-panel-${tab}`} tabIndex={rightTab === tab ? 0 : -1} className={rightTab === tab ? "active" : ""} onClick={() => setRightTab(tab)} onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "image" : event.key === "End" ? "video" : tab === "video" ? "image" : "video";
                setRightTab(next); document.getElementById(`generation-tab-${next}`)?.focus();
              }}>{tab === "video" ? scope ? text("当前分镜视频预览", "Shot video preview") : text("我的视频预览", "My video preview") : text("生成图片", "Generate images")}</button>)}
            </div>
            <div role="tabpanel" id="generation-panel-image" aria-labelledby="generation-tab-image" hidden={rightTab !== "image"}>
          <GenerationImageStudio ownerId={draftOwner} apiBase={apiBase} readOnly={readOnly} onSubmitted={onSubmitted} onBusyChange={setImageBusy} disabled={busy || uploading} onUse={async (asset, role) => {
            try {
            if(scope){const response=await fetch(`${apiBase}/assets/resolve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:[asset.id]})});const result=await response.json();if(!response.ok||!result.assets?.length){setError(message("INVALID_ASSETS"));return;}asset=result.assets[0];}
            const nextMode = role === "reference_image" ? "reference" : "frames";
            const keep = mode === nextMode ? assets.filter(a => a.id !== asset.id && (role === "reference_image" || a.role !== role)) : [];
            if (role === "reference_image" && keep.length >= settings.maxImages) { setError(text(`最多 ${settings.maxImages} 张参考图。`, `Up to ${settings.maxImages} reference images.`)); return; }
            setMode(nextMode); setAssets([...keep, {...asset, role}]); setError("");
            } catch {setError(message("INVALID_ASSETS"));}
          }}/>
            </div>
            <div role="tabpanel" id="generation-panel-video" aria-labelledby="generation-tab-video" hidden={rightTab !== "video"}>
          <section className="card generation-output">
            <div className="generation-output-heading">
              <h2>{scope ? text("当前分镜视频预览", "Shot video preview") : text("我的视频预览", "My video preview")}</h2>
              <button
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void (async () => {
                    try {
                      if (current)
                        await fetch(`${apiBase}/${current.id}/refresh`, {
                          method: "POST",
                        });
                      await load();
                    } catch {
                      setError(message(""));
                    } finally {
                      setRefreshing(false);
                    }
                  })();
                }}
              >
                {refreshing
                  ? text("刷新中…", "Refreshing…")
                  : text("刷新", "Refresh")}
              </button>
            </div>
            {current ? (
              <>
                <h3>{current.requirement}</h3>
                <p>
                  {generationModel(current.input.model).label} ·{" "}
                  {status(current.status)}
                </p>
                {current.available ? (
                  <>
                    <video
                      key={current.id}
                      controls
                      playsInline
                      preload="metadata"
                      src={`${apiBase}/${current.id}/media`}
                    />
                    <a
                      className="generation-download"
                      href={`${apiBase}/${current.id}/media?download=1`}
                    >
                      {text("下载视频", "Download video")} ↓
                    </a>
                    <p className="generation-help">
                      {text(
                        "下载后可在“上传视频”中提交审批；仅支持符合现有发布规格的视频。",
                        "Download and submit through Upload video for approval. Existing publishing requirements still apply.",
                      )}
                    </p>
                  </>
                ) : (
                  <div className="generation-placeholder">
                    <span>✦</span>
                    <p>
                      {current.expired
                        ? text("文件已过期", "File expired")
                        : current.status === "succeeded"
                          ? text(
                              "正在保存成片，请稍后刷新。",
                              "Saving the generated video. Refresh shortly.",
                            )
                          : status(current.status)}
                    </p>
                  </div>
                )}
                {taskError(current)}
                <div className="generation-usage">
                  <div>
                    <small>{text("总 Token", "Total tokens")}</small>
                    <strong>
                      {current.usage?.total_tokens?.toLocaleString() ??
                        text("未返回", "Not reported")}
                    </strong>
                  </div>
                  <div>
                    <small>{text("输出秒数", "Output seconds")}</small>
                    <strong>{current.usage?.output_seconds ?? "—"}</strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="generation-placeholder">
                <span>✦</span>
                <h3>
                  {text("成片会显示在这里", "Your video will appear here")}
                </h3>
                <p>
                  {text(
                    "添加素材、填写提示词，开始创作。",
                    "Add your images and prompt to start creating.",
                  )}
                </p>
              </div>
            )}
          </section>
        </div>
        </div>
        </div>
        <section className="card generation-history">
          <h2>{scope ? text("当前分镜生成记录", "Shot generation history") : text("我的生成记录", "My generation history")}</h2>
          <p>
            {text(
              "成片保存 14 天后自动清理，请及时下载。生成记录保留。",
              "Generated files are automatically deleted after 14 days. Download them in time. Records remain.",
            )}
          </p>
          <div className="generation-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    text("视频", "Video"),
                    text("模型", "Model"),
                    text("创建人", "Creator"),
                    text("时间", "Created"),
                    text("状态", "Status"),
                    text("Token", "Tokens"),
                    text("下载", "Download"),
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {ownTasks.some((own) => own.id === t.id) ? (
                        <button onClick={() => { setSelected(t.id); setRightTab("video"); }}>{t.requirement}</button>
                      ) : t.requirement}
                    </td>
                    <td>{generationModel(t.input.model).label}</td>
                    <td>{t.owner_name}</td>
                    <td>
                      {new Date(t.created_at).toLocaleString(
                        language === "zh" ? "zh-CN" : "en-US",
                        { timeZone: "Asia/Singapore" },
                      )}
                    </td>
                    <td>
                      {status(t.status)}
                      {t.status === "failed" && ownTasks.some(own=>own.id===t.id) && <button type="button" className="generation-failure-link" disabled={readOnly||busy||uploading} onClick={()=>void refill(t)}>{text("一键回填","Restore inputs")}</button>}
                      {(t.status === "failed" || t.status === "submitted_unknown") && (
                        <button type="button" className="generation-failure-link" onClick={() => setFailureTask(t)}>
                          {text("查看失败详情", "View failure details")}
                        </button>
                      )}
                    </td>
                    <td>{t.usage?.total_tokens?.toLocaleString() ?? "—"}</td>
                    <td>
                      {t.available ? (
                        <a
                          className="generation-record-download"
                          href={`${apiBase}/${t.id}/media?download=1`}
                        >
                          {text("下载视频", "Download video")} ↓
                        </a>
                      ) : t.expired ? (
                        text("文件已过期", "File expired")
                      ) : t.status === "succeeded" ? (
                        text("保存中", "Saving")
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <GenerationPagination value={paging} disabled={historyLoading} onChange={setHistoryPage}/>
          {!tasks.length && (
            <p>{text("暂无生成记录。", "No generation history yet.")}</p>
          )}
        </section>
        <dialog ref={resetDialog} className="generation-failure-dialog" aria-labelledby="generation-reset-title">
          <h2 id="generation-reset-title">{text("重置当前创作？","Reset current work?")}</h2>
          <p>{text("将清空本浏览器保存的视频和图片草稿。历史记录及已提交任务会保留。","This clears saved video and image drafts in this browser. History and submitted tasks will remain.")}</p>
          <div className="image-studio-actions">
            <button type="button" autoFocus onClick={()=>resetDialog.current?.close()}>{text("取消","Cancel")}</button>
            <button type="button" onClick={()=>{resetDialog.current?.close();onReset();}}>{text("确认重置","Confirm reset")}</button>
          </div>
        </dialog>
        <dialog ref={failureDialog} className="generation-failure-dialog" aria-labelledby="generation-failure-title" onClose={() => setFailureTask(null)}>
          {failureTask && <>
            <h2 id="generation-failure-title">{text("生成失败详情", "Generation failure details")}</h2>
            <p>{failureTask.requirement} · {generationModel(failureTask.input.model).label}</p>
            {taskError(failureTask)}
            {!failureTask.error_code && !failureTask.provider_error && <p>{text("这条历史记录未保存具体错误原因。", "No detailed error was saved for this record.")}</p>}
            <dl>
              <dt>{text("创建人", "Creator")}</dt><dd>{failureTask.owner_name}</dd>
              <dt>{text("任务编号", "Task ID")}</dt><dd>{failureTask.id}</dd>
              {failureTask.error_code && <><dt>{text("系统错误码", "System error code")}</dt><dd>{failureTask.error_code}</dd></>}
              {failureTask.provider_error?.http_status && <><dt>HTTP</dt><dd>{failureTask.provider_error.http_status}</dd></>}
            </dl>
            <form method="dialog"><button className="button" autoFocus>{text("关闭", "Close")}</button></form>
          </>}
        </dialog>
      </section>
    </WorkspaceShell>
  );
}

function WorkspaceShell({embedded,children}:{embedded:boolean;children:ReactNode}) { return embedded ? <>{children}</> : <AppShell active="generate" status={{zh:"AI · 视频生成",en:"AI · Video generation"}}>{children}</AppShell>; }

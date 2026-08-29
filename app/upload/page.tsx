"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useAuth } from "../../components/auth-provider";
import { useLanguage } from "../../components/language-provider";

const platformOptions = [
  { id: "tiktok", name: "TikTok", icon: "♪", className: "tt" },
  { id: "instagram", name: "Instagram", icon: "◎", className: "ig" },
  { id: "youtube", name: "YouTube Shorts", icon: "▶", className: "yt" },
] as const;

const MAX_VIDEO_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);
const MAX_TITLE_CHARACTERS = 100;
const MAX_SOCIAL_TEXT_CHARACTERS = 2200;
const MAX_YOUTUBE_DESCRIPTION_BYTES = 5000;
const acceptedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);

type ConnectionState = {
  configured: boolean;
  profile?: string | null;
  connected: Partial<Record<(typeof platformOptions)[number]["id"], boolean>>;
  message?: string;
};

type PlatformResult = {
  platform?: string;
  success?: boolean;
  status?: string;
  message?: string;
  error?: string;
  error_message?: string | null;
  error_code?: string | null;
  failure_stage?: string | null;
  platform_post_id?: string | null;
  post_url?: string | null;
  url?: string | null;
  fallback_to_inbox?: boolean;
};

type PublishJob = {
  requestId: string;
  status: string;
  results: PlatformResult[];
};

type StagedUpload = {
  id: string;
  chunkSize: number;
  totalChunks: number;
  expectedSize: number;
  receivedChunks: number[];
  status: string;
};

function normalizeResults(value: unknown): PlatformResult[] {
  if (Array.isArray(value)) return value as PlatformResult[];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([platform, result]) => ({ platform, ...(result && typeof result === "object" ? result as PlatformResult : {}) }));
  }
  return [];
}

function mergeResults(current: PlatformResult[], incoming: PlatformResult[]) {
  const merged = new Map(current.filter((item) => item.platform).map((item) => [item.platform!, item]));
  for (const item of incoming) {
    if (!item.platform) continue;
    merged.set(item.platform, { ...merged.get(item.platform), ...item });
  }
  return [...merged.values()];
}

function platformResultState(result: PlatformResult | undefined, jobStatus: string | undefined) {
  if (!result) return "pending" as const;
  const status = result.status?.toLowerCase();
  const hasFailure = Boolean(result.error_message || result.error_code || result.failure_stage || result.error)
    || ["failed", "error", "rejected"].includes(status ?? "")
    || (["completed", "failed"].includes(jobStatus ?? "") && result.success === false);
  if (hasFailure) return "failed" as const;
  if (result.success === true || result.platform_post_id || result.post_url || result.url || ["completed", "success", "published"].includes(status ?? "")) return "completed" as const;
  return "pending" as const;
}

function platformFailureReason(result: PlatformResult | undefined, fallback: string) {
  return result?.error_message || result?.message || result?.error || result?.error_code || result?.failure_stage || fallback;
}

export default function UploadPage() {
  const { text } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [publishError, setPublishError] = useState("");
  const [job, setJob] = useState<PublishJob | null>(null);
  const [stagedUpload, setStagedUpload] = useState<StagedUpload | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetch("/api/upload-post/profile", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as ConnectionState }))
      .then(({ data }) => {
        if (cancelled) return;
        setConnection(data);
        setPlatforms(data.configured
          ? platformOptions.filter((platform) => data.connected[platform.id]).map((platform) => platform.id)
          : []);
      })
      .catch(() => { if (!cancelled) setConnection({ configured: false, connected: {}, message: "Upload-Post unavailable" }); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!job?.requestId || ["completed", "failed", "pending_review"].includes(job.status)) return;
    const delay = ["pending", "queued"].includes(job.status) ? 6000 : 10000;
    const timer = window.setInterval(() => {
      void fetch(`/api/upload-post/status?request_id=${encodeURIComponent(job.requestId)}`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json() as { status?: string; results?: unknown };
          if (response.ok) setJob((current) => current ? { ...current, status: data.status ?? current.status, results: mergeResults(current.results, normalizeResults(data.results)) } : current);
        })
        .catch(() => undefined);
    }, delay);
    return () => window.clearInterval(timer);
  }, [job?.requestId, job?.status]);

  function chooseFile(nextFile?: File) {
    if (!nextFile) {
      fileInputRef.current?.click();
      return;
    }
    setPublishError("");
    setUploadProgress(null);
    if (nextFile.size > MAX_VIDEO_BYTES) {
      setPublishError(text("视频不能超过 1.5 GB。", "Video must be 1.5 GB or smaller."));
      return;
    }
    if (!acceptedVideoTypes.has(nextFile.type) && !/\.(mp4|mov|webm)$/i.test(nextFile.name)) {
      setPublishError(text("请选择 MP4、MOV 或 WebM 视频。", "Choose an MP4, MOV, or WebM video."));
      return;
    }
    let restored:StagedUpload|null=null;
    if (stagedUpload) {
      void fetch(`/api/uploads/${stagedUpload.id}`, { method: "DELETE" }).catch(() => undefined);
      window.localStorage.removeItem("meedoo_staged_upload");
    } else {
      try {
        const saved=JSON.parse(window.localStorage.getItem("meedoo_staged_upload")??"null") as {id?:string;filename?:string;size?:number;lastModified?:number}|null;
        if(saved?.id&&saved.filename===nextFile.name&&saved.size===nextFile.size&&saved.lastModified===nextFile.lastModified)restored={id:saved.id,chunkSize:0,totalChunks:0,expectedSize:nextFile.size,receivedChunks:[],status:"uploading"};
        else window.localStorage.removeItem("meedoo_staged_upload");
      } catch { window.localStorage.removeItem("meedoo_staged_upload"); }
    }
    setStagedUpload(restored);
    setFile(nextFile);
    setTitle(nextFile.name.replace(/\.[^.]+$/, "").slice(0, MAX_TITLE_CHARACTERS));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) chooseFile(nextFile);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) chooseFile(nextFile);
  }

  function togglePlatform(id: string) {
    if (connection?.configured && !connection.connected[id as keyof ConnectionState["connected"]]) return;
    setPlatforms((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function publish() {
    if (!file || !user) return;
    if (validationError) {
      setPublishError(validationError);
      return;
    }
    setPublishError("");
    setPublishing(true);
    setUploadProgress(0);

    try {
      let stage=stagedUpload;
      if(stage){
        const response=await fetch(`/api/uploads/${stage.id}`,{cache:"no-store"});
        const payload=await response.json() as Partial<StagedUpload>&{message?:string};
        if(!response.ok)stage=null;else stage={...stage,...payload} as StagedUpload;
      }
      if(!stage){
        const response=await fetch("/api/uploads/init",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,contentType:file.type,size:file.size})});
        const payload=await response.json() as {id?:string;chunkSize?:number;totalChunks?:number;message?:string};
        if(!response.ok||!payload.id||!payload.chunkSize||!payload.totalChunks)throw new Error(payload.message||text("无法创建上传任务。","Could not initialize the upload."));
        stage={id:payload.id,chunkSize:payload.chunkSize,totalChunks:payload.totalChunks,expectedSize:file.size,receivedChunks:[],status:"uploading"};
        setStagedUpload(stage);
        window.localStorage.setItem("meedoo_staged_upload",JSON.stringify({id:stage.id,filename:file.name,size:file.size,lastModified:file.lastModified}));
      }
      if(stage.status==="uploading"){
        const received=new Set(stage.receivedChunks??[]);
        let completedBytes=[...received].reduce((sum,index)=>sum+Math.min(stage!.chunkSize,file.size-index*stage!.chunkSize),0);
        setUploadProgress(Math.min(100,Math.round(completedBytes/file.size*100)));
        for(let index=0;index<stage.totalChunks;index++){
          if(received.has(index))continue;
          const chunk=file.slice(index*stage.chunkSize,Math.min(file.size,(index+1)*stage.chunkSize));
          let lastError:Error|undefined;
          for(let attempt=0;attempt<3;attempt++){
            try{
              await new Promise<void>((resolve,reject)=>{
                const request=new XMLHttpRequest();request.open("PUT",`/api/uploads/${stage!.id}/chunks/${index}`);request.timeout=10*60*1000;request.setRequestHeader("Content-Type","application/octet-stream");
                request.upload.onprogress=(event)=>{if(event.lengthComputable)setUploadProgress(Math.min(99,Math.round((completedBytes+event.loaded)/file.size*100)));};
                request.onload=()=>request.status>=200&&request.status<300?resolve():reject(new Error(`${text("分片上传失败","Chunk upload failed")} (HTTP ${request.status})`));
                request.onerror=()=>reject(new Error(text("网络连接中断，正在重试分片。","Connection interrupted; retrying this chunk.")));
                request.ontimeout=()=>reject(new Error(text("单个分片上传超时。","A single chunk timed out.")));
                request.send(chunk);
              });
              lastError=undefined;break;
            }catch(cause){lastError=cause instanceof Error?cause:new Error("Chunk upload failed");if(attempt<2)await new Promise((resolve)=>window.setTimeout(resolve,1000*(attempt+1)));}
          }
          if(lastError)throw lastError;
          completedBytes+=chunk.size;received.add(index);setStagedUpload({...stage,receivedChunks:[...received]});
        }
        const completeResponse=await fetch(`/api/uploads/${stage.id}/complete`,{method:"POST"});
        const completePayload=await completeResponse.json() as {message?:string};if(!completeResponse.ok)throw new Error(completePayload.message||text("无法合并视频。","Could not assemble the video."));
        stage={...stage,status:"ready",receivedChunks:[...received]};setStagedUpload(stage);
      }
      if(stage.status!=="ready")throw new Error(text("这个视频上传任务已经被使用，请重新选择文件。","This staged upload has already been used. Choose the file again."));
      setUploadProgress(100);
      const publishResponse=await fetch("/api/upload-post/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uploadSessionId:stage.id,title:title.trim(),caption:caption.trim(),platforms})});
      const data=await publishResponse.json() as {requestId?:string;status?:string;results?:unknown;message?:string};
      if(!publishResponse.ok||!data.requestId)throw new Error(data.message||text("发布请求失败","Publishing request failed"));
      setUploadProgress(100);
      setJob({ requestId: data.requestId, status: data.status ?? "queued", results: normalizeResults(data.results) });
      window.localStorage.removeItem("meedoo_staged_upload");
      dialogRef.current?.showModal();
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : text("发布请求失败", "Publishing request failed"));
    } finally {
      setPublishing(false);
    }
  }

  const connectedCount = platformOptions.filter((platform) => connection?.connected[platform.id]).length;
  const socialTextLength = title.trim().length + (caption.trim() ? caption.trim().length + 2 : 0);
  const youtubeDescriptionBytes = new TextEncoder().encode(caption.trim()).length;
  const validationError = !title.trim()
    ? text("标题不能为空。", "Title is required.")
    : title.trim().length > MAX_TITLE_CHARACTERS
      ? text("标题不能超过 100 个字符。", "Title cannot exceed 100 characters.")
      : /[<>]/.test(title) || /[<>]/.test(caption)
        ? text("标题和文案不能包含 < 或 >。", "Title and caption cannot contain < or >.")
        : socialTextLength > MAX_SOCIAL_TEXT_CHARACTERS
          ? text("标题与文案合计不能超过 2,200 个字符。", "Title and caption together cannot exceed 2,200 characters.")
          : youtubeDescriptionBytes > MAX_YOUTUBE_DESCRIPTION_BYTES
            ? text("文案的 UTF-8 大小不能超过 5,000 字节。", "Caption cannot exceed 5,000 UTF-8 bytes.")
            : "";
  const selectedPlatformsConnected = platforms.every((platform) => connection?.connected[platform as keyof ConnectionState["connected"]]);
  const canPublish = Boolean(file && !validationError && platforms.length && user && connection?.configured && selectedPlatformsConnected && !publishing);
  const shellStatus = connection === null
    ? { zh: "检查三平台连接", en: "Checking platform connections" }
    : connection.configured
      ? { zh: `${connectedCount}/3 平台已连接`, en: `${connectedCount}/3 platforms connected` }
      : { zh: "等待 Upload-Post 配置", en: "Awaiting Upload-Post setup" };

  return (
    <AppShell active="upload" status={shellStatus}>
      <section className="page">
        <div className="head">
          <div>
            <p className="eyebrow">ONE VIDEO · EVERY CHANNEL</p>
            <h1>{text("上传并提交审批", "Upload & submit for review")}</h1>
            <p>{text("审批通过后，系统才会发布到所选平台。", "Your video is published to the selected platforms only after approval.")}</p>
          </div>
          <div className="platform-flow" aria-label="TikTok, Instagram, YouTube Shorts">
            <i className="pi tt">♪</i><span /><i className="pi ig">◎</i><span /><i className="pi yt">▶</i>
          </div>
        </div>

        <div className="upload-grid">
          <section
            className={`card drop${dragging ? " dragging" : ""}`}
            onClick={() => chooseFile()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={fileInputRef} className="sr-only" type="file" accept="video/mp4,video/quicktime,video/webm" onChange={onFileChange} />
            <div className="orbit"><b>↥</b></div>
            <h2>{file ? text("视频已就绪", "Video ready") : text("拖放视频到这里", "Drop your video here")}</h2>
            <p>{file ? `${text("已选择", "Selected")}: ${file.name}` : text("MP4、MOV 或 WebM · 最大 1.5 GB · 分片断点续传", "MP4, MOV or WebM · Up to 1.5 GB · resumable chunks")}</p>
            {!file && <button className="choose" type="button">{text("选择视频", "Choose video")}</button>}
            {file && (
              <div className="file" style={{ display: "flex" }}>
                <span className="cover">▶</span>
                <div>
                  <strong>{file.name}</strong>
                  <small>{file.size>=1024*1024*1024?`${(file.size/1024/1024/1024).toFixed(2)} GB`:`${(file.size / 1024 / 1024).toFixed(1)} MB`} · {text("等待分片上传", "Ready for chunked upload")}</small>
                  <span className="progress"><i /></span>
                </div>
                <em>100%</em>
              </div>
            )}
          </section>

          <section className="card form">
            <div className="ctitle">
              <div><span>✦</span><div><h2>{text("发布设置", "Publishing details")}</h2><p>{text("为三个平台配置统一内容", "Configure once for all channels")}</p></div></div>
              <small>{platforms.length} / 3</small>
            </div>
            <div className={`provider-state${connection?.configured ? " ready" : ""}`}>
              <span>{connection?.configured ? "✓" : "…"}</span>
              <div>
                <strong>{connection === null ? text("正在检查 Upload-Post", "Checking Upload-Post") : connection.configured ? text(`Profile: ${connection.profile ?? "—"}`, `Profile: ${connection.profile ?? "—"}`) : text("等待 API Key 与 Profile", "Awaiting API Key and profile")}</strong>
                <small>{connection?.configured ? text(`${connectedCount} 个平台授权有效`, `${connectedCount} platform connections available`) : text("配置后无需修改前端代码", "No frontend changes needed after setup")}</small>
              </div>
            </div>
            <label className="label field-label" htmlFor="video-title"><span>{text("视频标题", "Video title")}</span><small>{title.length} / 100</small></label>
            <input id="video-title" maxLength={100} value={title} placeholder={text("选择文件后自动使用文件名", "Uses the filename after selection")} onChange={(event) => setTitle(event.target.value)} />
            <label className="label field-label" htmlFor="caption"><span>{text("文案", "Caption")}</span><small>{socialTextLength} / 2,200 · {youtubeDescriptionBytes} / 5,000 bytes</small></label>
            <textarea id="caption" maxLength={2200} value={caption} placeholder={text("输入三个平台共用的文案（可选）", "Shared caption for all platforms (optional)")} onChange={(event) => setCaption(event.target.value)} />
            <small className={`field-rule${file && validationError ? " invalid" : ""}`}>{file && validationError ? `⚠ ${validationError}` : text("统一规则：标题 1–100 字；标题与文案合计 ≤2,200 字；文案 ≤5,000 UTF-8 bytes；不可包含 < 或 >。", "Combined rules: title 1–100 chars; title + caption ≤2,200 chars; caption ≤5,000 UTF-8 bytes; no < or >.")}</small>
            <span className="label">{text("发布平台", "Publish to")}</span>
            <div className="platforms">
              {platformOptions.map((platform) => {
                const selected = platforms.includes(platform.id);
                const unavailable = Boolean(connection?.configured && !connection.connected[platform.id]);
                return (
                  <button key={platform.id} className={`${selected ? "selected" : ""}${unavailable ? " unavailable" : ""}`} type="button" disabled={unavailable} onClick={() => togglePlatform(platform.id)} aria-pressed={selected}>
                    <i className={`pi ${platform.className}`}>{platform.icon}</i>
                    <span>{platform.name}<small>{connection === null ? text("检查中", "Checking") : !connection.configured ? text("等待配置", "Awaiting setup") : unavailable ? text("未连接", "Not connected") : text("已连接", "Connected")}</small></span>
                    <b>{unavailable ? "×" : selected ? "✓" : "+"}</b>
                  </button>
                );
              })}
            </div>
            {publishError && <div className="publish-error" role="alert">⚠ {publishError}</div>}
            {connection?.configured && !selectedPlatformsConnected && <div className="publish-error connection-warning">{text("请先在 Upload-Post 连接所有已选择的平台。", "Connect every selected platform in Upload-Post first.")}</div>}
            <button className="publish" disabled={!canPublish} onClick={() => void publish()}>
              ↥ {publishing ? uploadProgress === 100 ? text("视频已上传，正在提交审批…", "Video uploaded, submitting for review…") : text(`正在上传 ${uploadProgress ?? 0}%`, `Uploading ${uploadProgress ?? 0}%`) : text(`提交审批 · ${platforms.length} 个平台 →`, `Submit for review · ${platforms.length} platforms →`)}
            </button>
            {uploadProgress !== null && <div className="upload-meter" aria-label={text("上传进度", "Upload progress")}><span><i style={{ width: `${uploadProgress}%` }} /></span><small>{uploadProgress === 100 && publishing ? text("服务器正在创建待审批记录", "Server is creating the review submission") : `${uploadProgress}%`}</small></div>}
          </section>
        </div>
      </section>

      <dialog ref={dialogRef} className="modal" onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
        <div className="dialog">
          <div className={`success${job?.status === "failed" ? " failed" : ""}`}>{job?.status === "failed" ? "!" : "✓"}</div>
          <h2>{job?.status === "pending_review" ? text("已提交审批", "Submitted for review") : job?.status === "failed" ? text("提交失败", "Submission failed") : text("提交已完成", "Submission complete")}</h2>
          <p>{job?.status === "pending_review" ? text("审批通过前不会发布到任何平台。你可以在上传记录中查看状态。", "Nothing will be published until the video is approved. Track it in Upload records.") : text("处理结果已经返回。", "The result is ready.")}</p>
          <div className="job-id">Submission ID · {job?.requestId ?? "—"}</div>
          {job?.status !== "pending_review" && <div className="platform-results">
            {platformOptions.filter((platform) => platforms.includes(platform.id)).map((platform) => {
              const result = job?.results.find((item) => item.platform === platform.id);
              const link = result?.post_url || result?.url;
              const state = platformResultState(result, job?.status);
              const message = state === "failed"
                ? platformFailureReason(result, text("平台未提供失败原因", "The platform did not provide a failure reason"))
                : state === "completed"
                  ? result?.fallback_to_inbox ? text("已发送至 TikTok 草稿箱", "Sent to TikTok inbox") : text("已完成", "Completed")
                  : text("处理中，请稍候", "Processing, please wait");
              return <div key={platform.id}><i className={`pi ${platform.className}`}>{platform.icon}</i><span><strong>{platform.name}</strong><small>{message}</small></span>{state === "completed" && link ? <a href={link} target="_blank" rel="noreferrer">↗</a> : <b className={state === "failed" ? "bad" : ""}>{state === "failed" ? "!" : state === "completed" ? "✓" : "…"}</b>}</div>;
            })}
          </div>}
          <button onClick={() => job?.status === "pending_review" ? router.push("/records") : dialogRef.current?.close()}>{job?.status === "pending_review" ? text("查看上传记录 →", "View upload records →") : text("关闭", "Close")}</button>
        </div>
      </dialog>
    </AppShell>
  );
}

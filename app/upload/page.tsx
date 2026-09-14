"use client";
import { requiredPlatforms, socialTextLength, socialTextLimit } from "../../lib/social-platforms";
import { titleForSelectedFile } from "../../lib/upload-title";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useAuth } from "../../components/auth-provider";
import { useLanguage } from "../../components/language-provider";

const platformOptions = [
  { id: "tiktok", name: "TikTok", icon: "♪", className: "tt" },
  { id: "instagram", name: "Instagram", icon: "◎", className: "ig" },
  { id: "youtube", name: "YouTube Shorts", icon: "▶", className: "yt" },
  { id: "facebook", name: "Facebook Reels", icon: "f", className: "fb" },
  { id: "x", name: "X", icon: "𝕏", className: "x" },
] as const;

const MAX_VIDEO_BYTES = Math.floor(1.5 * 1024 * 1024 * 1024);
const MAX_TITLE_CHARACTERS = 100;
const MAX_SOCIAL_TEXT_CHARACTERS = 2200;
const MAX_YOUTUBE_DESCRIPTION_BYTES = 5000;
const acceptedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
type PlatformId = (typeof platformOptions)[number]["id"];
type PlatformPostContent = { title: string; caption: string };
type PlatformContentState = Record<PlatformId, PlatformPostContent>;
const emptyPlatformContent = (): PlatformContentState => ({
  tiktok: { title: "", caption: "" },
  instagram: { title: "", caption: "" },
  youtube: { title: "", caption: "" },
  facebook: { title: "", caption: "" },
  x: { title: "", caption: "" },
});

type ConnectionState = {
  configured: boolean;
  profile?: string | null;
  connected: Partial<Record<(typeof platformOptions)[number]["id"], boolean>>;
  available?: Partial<Record<PlatformId, boolean>>;
  facebookPageConfigured?: boolean;
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
  const [platformContent, setPlatformContent] = useState<PlatformContentState>(emptyPlatformContent);
  const [syncPlatformContent,setSyncPlatformContent]=useState(true);
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
          ? platformOptions.filter((platform) => requiredPlatforms.some(id => id === platform.id) && data.connected[platform.id]).map((platform) => platform.id)
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
    setPlatformContent((current)=>Object.fromEntries(platformOptions.map(({id})=>[id,{...current[id],title:titleForSelectedFile(current[id].title,file?.name,nextFile.name)}])) as PlatformContentState);
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

  function updatePlatformContent(platform:PlatformId,field:keyof PlatformPostContent,value:string){
    setPlatformContent((current)=>syncPlatformContent
      ? Object.fromEntries(platformOptions.map(({id})=>[id,{...current[id],[field]:value}])) as PlatformContentState
      : {...current,[platform]:{...current[platform],[field]:value}});
  }

  function toggleContentSync(){setSyncPlatformContent((current)=>{const next=!current;if(next)setPlatformContent((content)=>Object.fromEntries(platformOptions.map(({id})=>[id,{...content.tiktok}])) as PlatformContentState);return next;});}

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
      const publishResponse=await fetch("/api/upload-post/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uploadSessionId:stage.id,platformContent,platforms})});
      const data=await publishResponse.json() as {requestId?:string;status?:string;results?:unknown;message?:string};
      if(!publishResponse.ok||!data.requestId)throw new Error(data.message||text("发布请求失败","Publishing request failed"));
      setUploadProgress(100);
      setJob({ requestId: data.requestId, status: data.status ?? "queued", results: normalizeResults(data.results) });
      setStagedUpload(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      window.localStorage.removeItem("meedoo_staged_upload");
      dialogRef.current?.showModal();
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : text("发布请求失败", "Publishing request failed"));
    } finally {
      setPublishing(false);
    }
  }

  const connectedCount = platformOptions.filter((platform) => connection?.connected[platform.id]).length;
  const invalidPlatform=platformOptions.filter(({id})=>platforms.includes(id)).find(({id})=>{const content=platformContent[id];const combined=content.title.trim().length+(content.caption.trim()?2+content.caption.trim().length:0);return !content.title.trim()||!content.caption.trim()||content.title.trim().length>MAX_TITLE_CHARACTERS||/[<>]/.test(content.title)||/[<>]/.test(content.caption)||socialTextLength(id,`${content.title.trim()}\n\n${content.caption.trim()}`)>socialTextLimit(id)||new TextEncoder().encode(content.caption.trim()).length>MAX_YOUTUBE_DESCRIPTION_BYTES;});
  const validationError = invalidPlatform
    ? text(`${invalidPlatform.name} 的标题和文案均为必填，并且必须符合长度与字符规则。`, `${invalidPlatform.name} requires both a valid title and caption.`)
    : requiredPlatforms.some(id=>!platforms.includes(id))
      ? text("必须连接 TikTok、Instagram 和 YouTube 后才能提交审批。","TikTok, Instagram, and YouTube must all be connected before review submission.")
      : "";
  const selectedPlatformsConnected = platforms.every((platform) => connection?.connected[platform as keyof ConnectionState["connected"]]);
  const canPublish = Boolean(file && !validationError && requiredPlatforms.every(id=>platforms.includes(id)) && user && connection?.configured && selectedPlatformsConnected && !publishing);
  const shellStatus = connection === null
    ? { zh: "检查平台连接", en: "Checking platform connections" }
    : connection.configured
      ? { zh: `${connectedCount}/5 平台已连接`, en: `${connectedCount}/5 platforms connected` }
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
              <div><span>✦</span><div><h2>{syncPlatformContent?text("所选平台共用内容","Shared content for all platforms"):text("各平台独立内容", "Content for each platform")}</h2><p>{syncPlatformContent?text("填写一次，用于所选平台","Enter once and use it across selected platforms"):text("分别填写所选平台的标题和文案", "Customize the title and caption for each platform")}</p></div></div>
              <small>{platforms.length} / 5</small>
            </div>
            <div className={`provider-state${connection?.configured ? " ready" : ""}`}>
              <span>{connection?.configured ? "✓" : "…"}</span>
              <div>
                <strong>{connection === null ? text("正在检查 Upload-Post", "Checking Upload-Post") : connection.configured ? text(`Profile: ${connection.profile ?? "—"}`, `Profile: ${connection.profile ?? "—"}`) : text("等待 API Key 与 Profile", "Awaiting API Key and profile")}</strong>
                <small>{connection?.configured ? text(`${connectedCount} 个平台授权有效`, `${connectedCount} platform connections available`) : text("配置后无需修改前端代码", "No frontend changes needed after setup")}</small>
              </div>
            </div>
            <fieldset className="optional-social-platforms"><legend>{text("额外发布渠道（可选）", "Additional channels (optional)")}</legend>{platformOptions.filter(p=>p.id === "facebook" || p.id === "x").map(p=><label key={p.id}><input type="checkbox" checked={platforms.includes(p.id)} disabled={publishing || !connection?.available?.[p.id]} onChange={event=>setPlatforms(current=>event.target.checked?[...new Set([...current,p.id])]:current.filter(id=>id!==p.id))} /><strong>{p.name}</strong><small>{connection?.available?.[p.id]?text("已就绪", "Ready"):connection?.connected[p.id]?text("需配置公共主页", "Page setup required"):text("尚未连接", "Not connected")}</small></label>)}</fieldset>
            {platforms.includes("facebook") && <p className="field-rule">{text("Facebook 发布到已配置的公共主页，使用 Reels：3–90 秒，竖屏至少 540 × 960。", "Facebook publishes Reels to the configured Page: 3–90 seconds, portrait, at least 540 × 960.")}</p>}
            {platforms.includes("x") && <p className="field-rule">{text("X 按单帖处理，标题和文案合计最多 280 加权字符（非 ASCII 按 2 计）；Upload-Post 默认移除链接。可关闭内容同步，为 X 单独缩短文案。", "X uses a single post with at most 280 weighted characters (non-ASCII counts as 2). Upload-Post removes links by default. Turn off content sync to shorten the X copy.")}</p>}
            <button className={`content-sync-toggle${syncPlatformContent?" active":""}`} type="button" onClick={toggleContentSync} aria-pressed={syncPlatformContent}><span>{syncPlatformContent?"✓":""}</span><div><strong>{text("同步所选平台内容","Keep platform content in sync")}</strong><small>{syncPlatformContent?text("编辑任意一项会同步到所选平台","Edits apply to selected platforms"):text("已开启独立编辑","Platform fields can now differ")}</small></div></button>
            {syncPlatformContent?(()=>{const content=platformContent.tiktok;const combined=content.title.trim().length+(content.caption.trim()?2+content.caption.trim().length:0);const captionBytes=new TextEncoder().encode(content.caption.trim()).length;return <section className="platform-content-card shared-content-card">
              <header><span className="shared-platform-icons">{platformOptions.filter(platform=>platforms.includes(platform.id)).map(platform=><i className={`pi ${platform.className}`} key={platform.id}>{platform.icon}</i>)}</span><strong>{text("所选平台共用","Shared across selected platforms")}</strong></header>
              <label className="label field-label" htmlFor="shared-title"><span>{text("标题（必填）","Title (required)")}</span><small>{content.title.length} / 100</small></label>
              <input id="shared-title" maxLength={100} value={content.title} placeholder={text("选择文件后自动使用文件名","Uses the filename after selection")} onChange={(event)=>updatePlatformContent("tiktok","title",event.target.value)}/>
              <label className="label field-label" htmlFor="shared-caption"><span>{text("文案（必填）","Caption (required)")}</span><small>{combined} / 2,200 · {captionBytes} / 5,000 bytes</small></label>
              <textarea id="shared-caption" maxLength={2200} value={content.caption} placeholder={text("输入共用文案","Enter the shared caption")} onChange={(event)=>updatePlatformContent("tiktok","caption",event.target.value)}/>
            </section>})():<div className="platform-content-list">
              {platformOptions.filter(platform=>platforms.includes(platform.id)).map((platform)=>{const content=platformContent[platform.id];const combined=content.title.trim().length+(content.caption.trim()?2+content.caption.trim().length:0);const captionBytes=new TextEncoder().encode(content.caption.trim()).length;const connected=Boolean(connection?.connected[platform.id]);return <section className="platform-content-card" key={platform.id}>
                <header><i className={`pi ${platform.className}`}>{platform.icon}</i><strong>{platform.name}</strong><span className={connected?"connected":"disconnected"}>{connected?text("已连接","Connected"):text("未连接","Not connected")}</span></header>
                <label className="label field-label" htmlFor={`${platform.id}-title`}><span>{text("标题（必填）","Title (required)")}</span><small>{content.title.length} / 100</small></label>
                <input id={`${platform.id}-title`} maxLength={100} value={content.title} placeholder={text("选择文件后自动使用文件名","Uses the filename after selection")} onChange={(event)=>updatePlatformContent(platform.id,"title",event.target.value)}/>
                <label className="label field-label" htmlFor={`${platform.id}-caption`}><span>{text("文案（必填）","Caption (required)")}</span><small>{socialTextLength(platform.id,`${content.title.trim()}\n\n${content.caption.trim()}`)} / {socialTextLimit(platform.id)} · {captionBytes} / 5,000 bytes</small></label>
                <textarea id={`${platform.id}-caption`} maxLength={2200} value={content.caption} placeholder={text(`输入 ${platform.name} 文案`,`Enter the ${platform.name} caption`)} onChange={(event)=>updatePlatformContent(platform.id,"caption",event.target.value)}/>
              </section>})}
            </div>}
            <small className={`field-rule${file && validationError ? " invalid" : ""}`}>{file && validationError ? `⚠ ${validationError}` : syncPlatformContent?text("共用标题和文案会保存为所选平台内容；取消勾选后可分别修改。","The shared title and caption are saved for selected platforms; turn sync off to customize them."):text("所选平台标题和文案必须全部填写。标题 1–100 字；每组标题与文案合计 ≤2,200 字；不可包含 < 或 >。", "Selected platforms’ titles and captions are required. Each title is 1–100 chars; each title + caption is ≤2,200 chars; no < or >.")}</small>
            {publishError && <div className="publish-error" role="alert">⚠ {publishError}</div>}
            {connection?.configured && !selectedPlatformsConnected && <div className="publish-error connection-warning">{text("请先在 Upload-Post 连接所有已选择的平台。", "Connect every selected platform in Upload-Post first.")}</div>}
            <button className="publish" disabled={!canPublish} onClick={() => void publish()}>
              ↥ {publishing ? uploadProgress === 100 ? text("视频已上传，正在提交审批…", "Video uploaded, submitting for review…") : text(`正在上传 ${uploadProgress ?? 0}%`, `Uploading ${uploadProgress ?? 0}%`) : text("提交所选平台审批 →", "Submit selected platforms for review →")}
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

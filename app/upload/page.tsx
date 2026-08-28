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

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
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
  message?: string;
  post_url?: string | null;
  url?: string | null;
  fallback_to_inbox?: boolean;
};

type PublishJob = {
  requestId: string;
  status: string;
  results: PlatformResult[];
};

function normalizeResults(value: unknown): PlatformResult[] {
  if (Array.isArray(value)) return value as PlatformResult[];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([platform, result]) => ({ platform, ...(result && typeof result === "object" ? result as PlatformResult : {}) }));
  }
  return [];
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
    if (!job?.requestId || ["completed", "failed"].includes(job.status)) return;
    const delay = ["pending", "queued"].includes(job.status) ? 6000 : 10000;
    const timer = window.setInterval(() => {
      void fetch(`/api/upload-post/status?request_id=${encodeURIComponent(job.requestId)}`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json() as { status?: string; results?: unknown };
          if (response.ok) setJob((current) => current ? { ...current, status: data.status ?? current.status, results: normalizeResults(data.results) } : current);
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
      setPublishError(text("视频不能超过 300 MB。", "Video must be 300 MB or smaller."));
      return;
    }
    if (!acceptedVideoTypes.has(nextFile.type) && !/\.(mp4|mov|webm)$/i.test(nextFile.name)) {
      setPublishError(text("请选择 MP4、MOV 或 WebM 视频。", "Choose an MP4, MOV, or WebM video."));
      return;
    }
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
    const form = new FormData();
    form.append("video", file);
    form.append("title", title.trim());
    form.append("caption", caption.trim());
    form.append("platforms", JSON.stringify(platforms));

    try {
      const data = await new Promise<{ requestId: string; status?: string; results?: unknown }>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", "/api/upload-post/publish");
        request.timeout = 6 * 60 * 1000;
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) setUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        };
        request.onload = () => {
          let payload: { message?: string; requestId?: string; status?: string; results?: unknown } = {};
          try { payload = JSON.parse(request.responseText || "{}"); } catch { /* Preserve the HTTP status below. */ }
          if (request.status < 200 || request.status >= 300 || !payload.requestId) {
            reject(new Error(payload.message || `${text("上传请求失败", "Upload request failed")} (HTTP ${request.status || "—"})`));
            return;
          }
          resolve({ requestId: payload.requestId, status: payload.status, results: payload.results });
        };
        request.onerror = () => reject(new Error(text("上传连接中断，请检查 Lark 网络后重试。", "The upload connection was interrupted. Check the Lark network and try again.")));
        request.ontimeout = () => reject(new Error(text("上传超过 6 分钟，请检查网络后重试。", "The upload exceeded 6 minutes. Check the network and try again.")));
        request.onabort = () => reject(new Error(text("上传已取消。", "The upload was cancelled.")));
        request.send(form);
      });
      setUploadProgress(100);
      setJob({ requestId: data.requestId, status: data.status ?? "queued", results: normalizeResults(data.results) });
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
            <h1>{text("上传并同步发布", "Upload & publish everywhere")}</h1>
            <p>{text("一次上传，同步至 TikTok、Instagram 和 YouTube Shorts。", "Upload once to TikTok, Instagram and YouTube Shorts.")}</p>
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
            <input ref={fileInputRef} className="sr-only" type="file" accept="video/mp4,video/quicktime" onChange={onFileChange} />
            <div className="orbit"><b>↥</b></div>
            <h2>{file ? text("视频已就绪", "Video ready") : text("拖放视频到这里", "Drop your video here")}</h2>
            <p>{file ? `${text("已选择", "Selected")}: ${file.name}` : text("MP4 或 MOV · 最大 300 MB · 推荐 9:16", "MP4 or MOV · Up to 300 MB · 9:16 recommended")}</p>
            {!file && <button className="choose" type="button">{text("选择视频", "Choose video")}</button>}
            {file && (
              <div className="file" style={{ display: "flex" }}>
                <span className="cover">▶</span>
                <div>
                  <strong>{file.name}</strong>
                  <small>{(file.size / 1024 / 1024).toFixed(1)} MB · {text("本地演示文件", "Local demo file")}</small>
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
            <div className="row2">
              <div><span className="label">{text("发布时间", "Publishing time")}</span><button className="select" type="button">◉ <span>{text("立即发布", "Publish now")}</span><b>⌄</b></button></div>
            </div>
            {publishError && <div className="publish-error" role="alert">⚠ {publishError}</div>}
            {connection?.configured && !selectedPlatformsConnected && <div className="publish-error connection-warning">{text("请先在 Upload-Post 连接所有已选择的平台。", "Connect every selected platform in Upload-Post first.")}</div>}
            <button className="publish" disabled={!canPublish} onClick={() => void publish()}>
              ↥ {publishing ? uploadProgress === 100 ? text("视频已上传，正在创建任务…", "Video uploaded, creating jobs…") : text(`正在上传 ${uploadProgress ?? 0}%`, `Uploading ${uploadProgress ?? 0}%`) : text(`同步发布到 ${platforms.length} 个平台 →`, `Publish to ${platforms.length} platforms →`)}
            </button>
            {uploadProgress !== null && <div className="upload-meter" aria-label={text("上传进度", "Upload progress")}><span><i style={{ width: `${uploadProgress}%` }} /></span><small>{uploadProgress === 100 && publishing ? text("服务器正在提交至 Upload-Post", "Server is submitting to Upload-Post") : `${uploadProgress}%`}</small></div>}
          </section>
        </div>
      </section>

      <dialog ref={dialogRef} className="modal" onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
        <div className="dialog">
          <div className={`success${job?.status === "failed" ? " failed" : ""}`}>{job?.status === "failed" ? "!" : job?.status === "completed" ? "✓" : "↻"}</div>
          <h2>{job?.status === "completed" ? text("三平台任务已完成", "Publishing complete") : job?.status === "failed" ? text("发布任务失败", "Publishing failed") : text("发布任务已创建", "Publishing task created")}</h2>
          <p>{job?.status === "completed" ? text("平台结果已经返回。", "Platform results are ready.") : text("Upload-Post 正在后台处理视频，页面会自动更新。", "Upload-Post is processing the video in the background. This view updates automatically.")}</p>
          <div className="job-id">Request ID · {job?.requestId ?? "—"}</div>
          <div className="platform-results">
            {platformOptions.filter((platform) => platforms.includes(platform.id)).map((platform) => {
              const result = job?.results.find((item) => item.platform === platform.id);
              const link = result?.post_url || result?.url;
              return <div key={platform.id}><i className={`pi ${platform.className}`}>{platform.icon}</i><span><strong>{platform.name}</strong><small>{result ? result.success === false ? result.message || text("失败", "Failed") : result.fallback_to_inbox ? text("已发送至 TikTok 草稿箱", "Sent to TikTok inbox") : result.message || text("已完成", "Completed") : text("等待结果", "Waiting for result")}</small></span>{link ? <a href={link} target="_blank" rel="noreferrer">↗</a> : <b className={result?.success === false ? "bad" : ""}>{result ? result.success === false ? "!" : "✓" : "…"}</b>}</div>;
            })}
          </div>
          <button onClick={() => job?.status === "completed" ? router.push("/dashboard") : dialogRef.current?.close()}>{job?.status === "completed" ? text("查看 Dashboard →", "View Dashboard →") : text("关闭并稍后查看", "Close and check later")}</button>
        </div>
      </dialog>
    </AppShell>
  );
}

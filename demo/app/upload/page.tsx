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
  const [title, setTitle] = useState("今天的办公室变身挑战 ✨");
  const [caption, setCaption] = useState("24 小时，我们把空会议室变成了创意空间。你最喜欢哪个细节？ #办公改造 #幕后");
  const [platforms, setPlatforms] = useState<string[]>(platformOptions.map((platform) => platform.id));
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [job, setJob] = useState<PublishJob | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetch("/api/upload-post/profile", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as ConnectionState }))
      .then(({ data }) => { if (!cancelled) setConnection(data); })
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
    if (nextFile) setFile(nextFile);
    else fileInputRef.current?.click();
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
    setPlatforms((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function publish() {
    if (!file || !user) return;
    setPublishError("");
    setPublishing(true);
    const form = new FormData();
    form.append("video", file);
    form.append("title", title.trim());
    form.append("caption", caption.trim());
    form.append("platforms", JSON.stringify(platforms));

    try {
      const response = await fetch("/api/upload-post/publish", { method: "POST", body: form });
      const data = await response.json() as { message?: string; requestId?: string; status?: string; results?: unknown };
      if (!response.ok || !data.requestId) throw new Error(data.message || text("发布请求失败", "Publishing request failed"));
      setJob({ requestId: data.requestId, status: data.status ?? "queued", results: normalizeResults(data.results) });
      dialogRef.current?.showModal();
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : text("发布请求失败", "Publishing request failed"));
    } finally {
      setPublishing(false);
    }
  }

  const connectedCount = platformOptions.filter((platform) => connection?.connected[platform.id]).length;
  const selectedPlatformsConnected = platforms.every((platform) => connection?.connected[platform as keyof ConnectionState["connected"]]);
  const canPublish = Boolean(file && title.trim() && title.trim().length <= 100 && caption.length <= 2200 && platforms.length && user && connection?.configured && selectedPlatformsConnected && !publishing);
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
            <label className="label" htmlFor="video-title">{text("视频标题", "Video title")}</label>
            <input id="video-title" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} />
            <label className="label" htmlFor="caption">{text("文案", "Caption")}</label>
            <textarea id="caption" maxLength={2200} value={caption} onChange={(event) => setCaption(event.target.value)} />
            <span className="label">{text("发布平台", "Publish to")}</span>
            <div className="platforms">
              {platformOptions.map((platform) => {
                const selected = platforms.includes(platform.id);
                return (
                  <button key={platform.id} className={selected ? "selected" : ""} type="button" onClick={() => togglePlatform(platform.id)} aria-pressed={selected}>
                    <i className={`pi ${platform.className}`}>{platform.icon}</i>{platform.name}<b>{selected ? "✓" : "+"}</b>
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
              ↥ {publishing ? text("正在上传并创建任务…", "Uploading & creating jobs…") : text(`同步发布到 ${platforms.length} 个平台 →`, `Publish to ${platforms.length} platforms →`)}
            </button>
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

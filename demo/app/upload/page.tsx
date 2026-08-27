"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";

const platformOptions = [
  { id: "tiktok", name: "TikTok", icon: "♪", className: "tt" },
  { id: "instagram", name: "Instagram", icon: "◎", className: "ig" },
  { id: "youtube", name: "YouTube Shorts", icon: "▶", className: "yt" },
] as const;

export default function UploadPage() {
  const { text } = useLanguage();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("今天的办公室变身挑战 ✨");
  const [caption, setCaption] = useState("24 小时，我们把空会议室变成了创意空间。你最喜欢哪个细节？ #办公改造 #幕后");
  const [platforms, setPlatforms] = useState<string[]>(platformOptions.map((platform) => platform.id));

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

  const canPublish = Boolean(file && title.trim() && platforms.length);

  return (
    <AppShell active="upload" status={{ zh: "三平台已连接", en: "3 platforms connected" }}>
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
            <label className="label" htmlFor="video-title">{text("视频标题", "Video title")}</label>
            <input id="video-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            <label className="label" htmlFor="caption">{text("文案", "Caption")}</label>
            <textarea id="caption" value={caption} onChange={(event) => setCaption(event.target.value)} />
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
            <button className="publish" disabled={!canPublish} onClick={() => dialogRef.current?.showModal()}>
              ↥ {text(`同步发布到 ${platforms.length} 个平台 →`, `Publish to ${platforms.length} platforms →`)}
            </button>
          </section>
        </div>
      </section>

      <dialog ref={dialogRef} className="modal" onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
        <div className="dialog">
          <div className="success">✓</div>
          <h2>{text("发布任务已创建", "Publishing task created")}</h2>
          <p>{text("视频正在同步到已选择的平台。", "Your video is syncing to the selected platforms.")}</p>
          <button onClick={() => router.push("/dashboard")}>{text("查看 Dashboard →", "View Dashboard →")}</button>
        </div>
      </dialog>
    </AppShell>
  );
}

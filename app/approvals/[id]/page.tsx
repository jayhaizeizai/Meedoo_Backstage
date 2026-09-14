"use client";

import Link from "next/link";
import { socialTextLength, socialTextLimit } from "../../../lib/social-platforms";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { useLanguage } from "../../../components/language-provider";

type PostContent = { title: string; caption: string };
type PlatformContent = Record<string, PostContent>;
type Decision = "approved" | "rejected";
type RecordItem = {
  id: string; title: string; caption: string; platform_content: PlatformContent; uploader_name: string | null;
  status: string; review_status: string; review_comment: string | null; submitted_at: string; target_platforms: string[];
  original_filename: string | null; media_size_bytes: string | null; video_width: number | null; video_height: number | null;
  video_duration_seconds: string | null; video_codec: string | null;
};
type History = { decision: string; comment: string | null; created_at: string; reviewer_name: string };

const requiredPlatforms = ["tiktok", "instagram", "youtube"];
const copyFor = (item: RecordItem, platform: string) => item.platform_content?.[platform] ?? { title: item.title, caption: item.caption };
const contentMatches = (content: PlatformContent, platforms: string[]) => platforms.length > 1
  && platforms.every((platform) => JSON.stringify(content[platform]) === JSON.stringify(content[platforms[0]]));

function validateContent(content: PlatformContent) {
  for (const platform of Object.keys(content)) {
    const value = content[platform];
    if (!value?.title.trim() || !value.caption.trim()) return `${platform}: title and caption are required`;
    if (value.title.trim().length > 100) return `${platform}: title must be at most 100 characters`;
    if (/[<>]/.test(value.title) || /[<>]/.test(value.caption)) return `${platform}: < and > are not allowed`;
    if (socialTextLength(platform,`${value.title.trim()}\n\n${value.caption.trim()}`) > socialTextLimit(platform)) return `${platform}: title and caption must total at most ${socialTextLimit(platform)} weighted characters`;
    if (new TextEncoder().encode(value.caption.trim()).length > 5000) return `${platform}: caption must be at most 5,000 bytes`;
  }
  return "";
}

export default function ApprovalDetail() {
  const { language, text } = useLanguage();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<RecordItem | null>(null);
  const [content, setContent] = useState<PlatformContent>({});
  const [sharedContent, setSharedContent] = useState(true);
  const [approver, setApprover] = useState(false);
  const [history, setHistory] = useState<History[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);

  useEffect(() => {
    void fetch(`/api/approvals/${params.id}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      const record = payload.record as RecordItem;
      const initial = Object.fromEntries(record.target_platforms.map((platform) => [platform, copyFor(record, platform)]));
      setItem(record); setContent(initial); setSharedContent(contentMatches(initial, record.target_platforms));
      setApprover(payload.approver); setHistory(payload.history ?? []); setMediaUrl(payload.mediaUrl); setMediaUnavailable(!payload.mediaUrl);
    }).catch((cause) => setError(cause.message));
  }, [params.id]);

  function updatePlatform(platform: string, field: keyof PostContent, value: string) {
    setSaved(false);
    setContent((current) => {
      if (sharedContent) return Object.fromEntries((item?.target_platforms ?? requiredPlatforms).map((id) => [id, { ...current[id], [field]: value }]));
      return { ...current, [platform]: { ...current[platform], [field]: value } };
    });
  }

  function toggleShared(checked: boolean) {
    setSaved(false); setSharedContent(checked);
    if (checked) setContent((current) => {
      const source = current.youtube ?? current[requiredPlatforms[0]];
      return Object.fromEntries((item?.target_platforms ?? requiredPlatforms).map((platform) => [platform, { ...source }]));
    });
  }

  function checkContent() {
    const message = validateContent(content);
    if (message) setError(text(`内容不符合发布规则：${message}`, `Content does not meet publishing rules: ${message}`));
    return !message;
  }

  async function saveContent() {
    if (!checkContent()) return false;
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch(`/api/approvals/${params.id}/content`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platformContent: content }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      setSaved(true); return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed"); return false;
    } finally { setBusy(false); }
  }

  function requestDecision(decision: Decision) {
    if (!checkContent()) return;
    if (decision === "rejected" && !comment.trim()) {
      setError(text("拒绝时必须填写评价。", "A comment is required when rejecting.")); return;
    }
    setError(""); setPendingDecision(decision);
  }

  async function decide(decision: Decision) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/approvals/${params.id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, comment, platformContent: content }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      router.push("/approvals");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed"); setPendingDecision(null); setBusy(false);
    }
  }

  const heading = content.youtube?.title || item?.title;
  const editable = Boolean(item?.review_status === "pending" && approver);
  return <AppShell active={approver ? "approvals" : "records"} status={{ zh: "安全视频预览", en: "Secure video preview" }}>
    <section className="page review-page">
      <Link className="back-link" href={approver ? "/approvals" : "/records"}>← {text("返回", "Back")}</Link>
      {error && <div className="data-message error">⚠ {error}</div>}
      {item && <div className="approval-workspace">
        <section className="review-player card">{mediaUrl && !mediaUnavailable ? <video src={mediaUrl} controls playsInline preload="metadata" onError={() => setMediaUnavailable(true)} /> : <div className="data-message">{text("视频文件不可用，请重新上传原始文件。", "Video unavailable. Please upload the original file again.")}</div>}</section>
        <aside className="review-panel card">
          <span className={`review-badge ${item.review_status}`}>{item.review_status}</span>
          <h1>{heading}</h1>
          <p className="review-by">{item.uploader_name} · {new Date(item.submitted_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</p>
          {contentMatches(content, item.target_platforms) && <div className="copy-match-badge">✓ {text("所选平台内容一致", "Content matches across all platforms")}</div>}
          <dl className="review-metadata">
            <div><dt>{text("目标平台", "Platforms")}</dt><dd>{item.target_platforms.join(" · ")}</dd></div>
            <div><dt>{text("文件", "File")}</dt><dd>{item.original_filename}<small>{item.media_size_bytes ? ` ${(Number(item.media_size_bytes) / 1024 / 1024).toFixed(1)} MB` : ""}</small></dd></div>
            <div><dt>{text("视频规格", "Video specs")}</dt><dd>{item.video_width && item.video_height ? `${item.video_width} × ${item.video_height}` : text("等待检测", "Not detected")} · {item.video_codec ?? "—"} · {item.video_duration_seconds ? `${Math.round(Number(item.video_duration_seconds))}s` : "—"}</dd></div>
          </dl>
          {editable ? <section className="approval-content-editor">
            <header><div><h2>{text("发布内容", "Publishing content")}</h2><p>{text("审批员可以在发布前修正标题和文案。", "Approvers can correct titles and captions before publishing.")}</p></div><label className="approval-sync-toggle"><input type="checkbox" checked={sharedContent} onChange={(event) => toggleShared(event.target.checked)} />{text("三平台同步", "Sync all platforms")}</label></header>
            {sharedContent ? <ContentFields platform="youtube" value={content.youtube} onChange={updatePlatform} text={text} shared />
              : item.target_platforms.map((platform) => <ContentFields key={platform} platform={platform} value={content[platform]} onChange={updatePlatform} text={text} />)}
            <div className="approval-save-row"><button disabled={busy} onClick={() => void saveContent()}>{busy ? text("保存中…", "Saving…") : text("保存内容修改", "Save content changes")}</button>{saved && <span>✓ {text("已保存", "Saved")}</span>}</div>
          </section> : <section className="approval-content-readonly">{contentMatches(content, item.target_platforms) ? <ReadOnlyContent label={text("所选平台共用内容", "Shared across all platforms")} value={content[item.target_platforms[0]]} /> : item.target_platforms.map((platform) => <ReadOnlyContent key={platform} label={platform} value={content[platform]} />)}</section>}
          {editable && <><label>{text("审批评价（拒绝时必填）", "Review comment (required for rejection)")}<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} /></label><div className="review-actions"><button disabled={busy} className="reject" onClick={() => requestDecision("rejected")}>{text("不通过", "Reject")}</button><button disabled={busy} className="approve" onClick={() => requestDecision("approved")}>✓ {text("批准并发布", "Approve & publish")}</button></div></>}
          {history.length > 0 && <section className="review-history"><h2>{text("审批历史", "Review history")}</h2>{history.map((event, index) => <div key={`${event.created_at}-${index}`}><strong>{event.decision}</strong><span>{event.reviewer_name} · {new Date(event.created_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</span>{event.comment && <p>{event.comment}</p>}</div>)}</section>}
        </aside>
      </div>}
    </section>
    {pendingDecision && item && <div className="decision-confirm-backdrop"><section className={`decision-confirm card ${pendingDecision}`} role="dialog" aria-modal="true" aria-labelledby="decision-confirm-title"><span className="decision-confirm-icon">{pendingDecision === "approved" ? "✓" : "!"}</span><h2 id="decision-confirm-title">{pendingDecision === "approved" ? text("确认修改并批准发布？", "Confirm edits and publish?") : text("确认修改并拒绝？", "Confirm edits and reject?")}</h2><p>{pendingDecision === "approved" ? text(`最终标题和文案会被保存，并立即提交到 ${item.target_platforms.length} 个平台。`, `The final titles and captions will be saved and immediately submitted to ${item.target_platforms.length} platform(s).`) : text("最终标题和文案会被保存，上传者也会看到你的拒绝原因。", "The final titles and captions will be saved, and the uploader will see your rejection reason.")}</p>{pendingDecision === "rejected" && <blockquote>{comment.trim()}</blockquote>}<div className="decision-confirm-actions"><button disabled={busy} onClick={() => setPendingDecision(null)}>{text("取消", "Cancel")}</button><button disabled={busy} className={pendingDecision === "approved" ? "confirm-approve" : "confirm-reject"} onClick={() => void decide(pendingDecision)}>{busy ? text("正在提交…", "Submitting…") : pendingDecision === "approved" ? text("确认批准并发布", "Confirm approval") : text("确认拒绝", "Confirm rejection")}</button></div></section></div>}
  </AppShell>;
}

function ContentFields({ platform, value, onChange, text, shared = false }: { platform: string; value?: PostContent; onChange: (platform: string, field: keyof PostContent, value: string) => void; text: (zh: string, en: string) => string; shared?: boolean }) {
  const content = value ?? { title: "", caption: "" };
  const combined = content.title.trim().length + (content.caption.trim() ? 2 + content.caption.trim().length : 0);
  return <div className="approval-content-fields"><strong>{shared ? text("所选平台共用内容", "Shared across all platforms") : platform}</strong><label><span>{text("标题", "Title")} <small>{content.title.length}/100</small></span><input maxLength={100} value={content.title} onChange={(event) => onChange(platform, "title", event.target.value)} /></label><label><span>{text("文案", "Caption")} <small>{socialTextLength(platform,`${content.title.trim()}\n\n${content.caption.trim()}`)}/{socialTextLimit(platform)}</small></span><textarea maxLength={2200} value={content.caption} onChange={(event) => onChange(platform, "caption", event.target.value)} /></label></div>;
}

function ReadOnlyContent({ label, value }: { label: string; value?: PostContent }) {
  return <div className="review-platform-copy shared-review-copy"><strong>{label}</strong><b>{value?.title}</b><span>{value?.caption}</span></div>;
}

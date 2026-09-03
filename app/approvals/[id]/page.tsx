"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "../../../components/app-shell";
import { useLanguage } from "../../../components/language-provider";

type PlatformContent = Record<string, { title: string; caption: string }>;
type Decision = "approved" | "rejected";
type RecordItem = {
  id: string; title: string; caption: string; platform_content: PlatformContent; uploader_name: string | null;
  status: string; review_status: string; review_comment: string | null; submitted_at: string; target_platforms: string[];
  original_filename: string | null; media_size_bytes: string | null; video_width: number | null; video_height: number | null;
  video_duration_seconds: string | null; video_codec: string | null;
};
type History = { decision: string; comment: string | null; created_at: string; reviewer_name: string };

const copyFor = (item: RecordItem, platform: string) => item.platform_content?.[platform] ?? { title: item.title, caption: item.caption };
const allCopyMatches = (item: RecordItem) => item.target_platforms.length > 1
  && item.target_platforms.every((platform) => JSON.stringify(copyFor(item, platform)) === JSON.stringify(copyFor(item, item.target_platforms[0])));

export default function ApprovalDetail() {
  const { language, text } = useLanguage();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<RecordItem | null>(null);
  const [approver, setApprover] = useState(false);
  const [history, setHistory] = useState<History[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);

  useEffect(() => {
    void fetch(`/api/approvals/${params.id}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      setItem(payload.record);
      setApprover(payload.approver);
      setHistory(payload.history ?? []);
      setMediaUrl(payload.mediaUrl);
    }).catch((cause) => setError(cause.message));
  }, [params.id]);

  function requestDecision(decision: Decision) {
    if (decision === "rejected" && !comment.trim()) {
      setError(text("拒绝时必须填写评价。", "A comment is required when rejecting."));
      return;
    }
    setError("");
    setPendingDecision(decision);
  }

  async function decide(decision: Decision) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/approvals/${params.id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, comment }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      router.push("/approvals");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
      setPendingDecision(null);
      setBusy(false);
    }
  }

  return <AppShell active={approver ? "approvals" : "records"} status={{ zh: "安全视频预览", en: "Secure video preview" }}>
    <section className="page review-page">
      <Link className="back-link" href={approver ? "/approvals" : "/records"}>← {text("返回", "Back")}</Link>
      {error && <div className="data-message error">⚠ {error}</div>}
      {item && <div className="approval-workspace">
        <section className="review-player card">{mediaUrl
          ? <video src={mediaUrl} controls playsInline preload="metadata" />
          : <div className="data-message">{text("视频文件不可用", "Video unavailable")}</div>}
        </section>
        <aside className="review-panel card">
          <span className={`review-badge ${item.review_status}`}>{item.review_status}</span>
          <h1>{item.title}</h1>
          <p className="review-by">{item.uploader_name} · {new Date(item.submitted_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</p>
          {allCopyMatches(item) && <div className="copy-match-badge">✓ {text("三个平台内容一致", "Content matches across all platforms")}</div>}
          <dl>
            <div><dt>{text("目标平台", "Platforms")}</dt><dd>{item.target_platforms.join(" · ")}</dd></div>
            <div><dt>{text("文件", "File")}</dt><dd>{item.original_filename}<small>{item.media_size_bytes ? ` ${(Number(item.media_size_bytes) / 1024 / 1024).toFixed(1)} MB` : ""}</small></dd></div>
            <div><dt>{text("视频规格", "Video specs")}</dt><dd>{item.video_width && item.video_height ? `${item.video_width} × ${item.video_height}` : text("等待检测", "Not detected")} · {item.video_codec ?? "—"} · {item.video_duration_seconds ? `${Math.round(Number(item.video_duration_seconds))}s` : "—"}</dd></div>
            {allCopyMatches(item) ? (() => {
              const content = copyFor(item, item.target_platforms[0]);
              return <div className="review-platform-copy shared-review-copy"><dt>{text("三平台共用内容", "Shared across all platforms")}</dt><dd><strong>{content.title}</strong><span>{content.caption || text("无文案", "No caption")}</span></dd></div>;
            })() : item.target_platforms.map((platform) => {
              const content = copyFor(item, platform);
              return <div className="review-platform-copy" key={platform}><dt>{platform}</dt><dd><strong>{content.title}</strong><span>{content.caption || text("无文案", "No caption")}</span></dd></div>;
            })}
          </dl>
          {item.review_status === "pending" && approver && <>
            <label>{text("审批评价（拒绝时必填）", "Review comment (required for rejection)")}<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} /></label>
            <div className="review-actions">
              <button disabled={busy} className="reject" onClick={() => requestDecision("rejected")}>{text("不通过", "Reject")}</button>
              <button disabled={busy} className="approve" onClick={() => requestDecision("approved")}>✓ {text("批准并发布", "Approve & publish")}</button>
            </div>
          </>}
          {history.length > 0 && <section className="review-history"><h2>{text("审批历史", "Review history")}</h2>{history.map((event, index) => <div key={`${event.created_at}-${index}`}><strong>{event.decision}</strong><span>{event.reviewer_name} · {new Date(event.created_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</span>{event.comment && <p>{event.comment}</p>}</div>)}</section>}
        </aside>
      </div>}
    </section>
    {pendingDecision && item && <div className="decision-confirm-backdrop">
      <section className={`decision-confirm card ${pendingDecision}`} role="dialog" aria-modal="true" aria-labelledby="decision-confirm-title">
        <span className="decision-confirm-icon">{pendingDecision === "approved" ? "✓" : "!"}</span>
        <h2 id="decision-confirm-title">{pendingDecision === "approved" ? text("确认批准并发布？", "Approve and publish?") : text("确认拒绝这个视频？", "Reject this video?")}</h2>
        <p>{pendingDecision === "approved"
          ? text(`确认后将立即提交到 ${item.target_platforms.length} 个平台，提交后无法从 MeeDoo 撤回。`, `This will immediately submit to ${item.target_platforms.length} platform(s). It cannot be recalled from MeeDoo after submission.`)
          : text("确认后上传者会看到你的拒绝原因，可以根据评价重新准备视频。", "The uploader will see your reason and can prepare a revised video.")}</p>
        {pendingDecision === "rejected" && <blockquote>{comment.trim()}</blockquote>}
        <div className="decision-confirm-actions">
          <button disabled={busy} onClick={() => setPendingDecision(null)}>{text("取消", "Cancel")}</button>
          <button disabled={busy} className={pendingDecision === "approved" ? "confirm-approve" : "confirm-reject"} onClick={() => void decide(pendingDecision)}>{busy ? text("正在提交…", "Submitting…") : pendingDecision === "approved" ? text("确认批准并发布", "Confirm approval") : text("确认拒绝", "Confirm rejection")}</button>
        </div>
      </section>
    </div>}
  </AppShell>;
}

"use client";
import { useRouter } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";
import { useUploadWorkflow } from "../../components/upload/use-upload-workflow";
import { PlatformContentForm } from "../../components/upload/platform-content-form";
import {
  platformOptions,
  platformResultState,
  platformFailureReason,
} from "../../components/upload/upload-model";
export default function UploadPage() {
  const { text } = useLanguage();
  const router = useRouter();
  const workflow = useUploadWorkflow();
  const {
    fileInputRef,
    dialogRef,
    file,
    dragging,
    setDragging,
    platforms,
    connection,
    publishing,
    uploadProgress,
    publishError,
    job,
    chooseFile,
    onFileChange,
    onDrop,
    publish,
    selectedPlatformsConnected,
    canPublish,
    shellStatus,
  } = workflow;

  return (
    <AppShell active="upload" status={shellStatus}>
      <section className="page">
        <div className="head">
          <div>
            <p className="eyebrow">ONE VIDEO · EVERY CHANNEL</p>
            <h1>{text("上传并提交审批", "Upload & submit for review")}</h1>
            <p>
              {text(
                "审批通过后，系统才会发布到已启用平台。",
                "Your video is published to the enabled platforms only after approval.",
              )}
            </p>
          </div>
          <div
            className="platform-flow"
            aria-label={platformOptions
              .filter((p) => platforms.includes(p.id))
              .map((p) => p.name)
              .join(", ")}
          >
            {platformOptions
              .filter((p) => platforms.includes(p.id))
              .map((platform) => (
                <i className={`pi ${platform.className}`} key={platform.id}>
                  {platform.icon}
                </i>
              ))}
          </div>
        </div>

        <div className="upload-grid">
          <section
            className={`card drop${dragging ? " dragging" : ""}`}
            onClick={() => chooseFile()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={onFileChange}
            />
            <div className="orbit">
              <b>↥</b>
            </div>
            <h2>
              {file
                ? text("视频已就绪", "Video ready")
                : text("拖放视频到这里", "Drop your video here")}
            </h2>
            <p>
              {file
                ? `${text("已选择", "Selected")}: ${file.name}`
                : text(
                    "MP4、MOV 或 WebM · 最大 1.5 GB · 分片断点续传",
                    "MP4, MOV or WebM · Up to 1.5 GB · resumable chunks",
                  )}
            </p>
            {!file && (
              <button className="choose" type="button">
                {text("选择视频", "Choose video")}
              </button>
            )}
            {file && (
              <div className="file" style={{ display: "flex" }}>
                <span className="cover">▶</span>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {file.size >= 1024 * 1024 * 1024
                      ? `${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB`
                      : `${(file.size / 1024 / 1024).toFixed(1)} MB`}{" "}
                    · {text("等待分片上传", "Ready for chunked upload")}
                  </small>
                  <span className="progress">
                    <i />
                  </span>
                </div>
                <em>100%</em>
              </div>
            )}
          </section>

          <section className="card form">
            <PlatformContentForm {...workflow} />
            {publishError && (
              <div className="publish-error" role="alert">
                ⚠ {publishError}
              </div>
            )}
            {connection?.configured && !selectedPlatformsConnected && (
              <div className="publish-error connection-warning">
                {text(
                  "请先连接所有已启用平台；启用 Facebook 时还需配置公共主页。",
                  "Connect enabled platforms; configure a Page if Facebook is enabled.",
                )}
              </div>
            )}
            <button
              className="publish"
              disabled={!canPublish}
              onClick={() => void publish()}
            >
              ↥{" "}
              {publishing
                ? uploadProgress === 100
                  ? text(
                      "视频已上传，正在提交审批…",
                      "Video uploaded, submitting for review…",
                    )
                  : text(
                      `正在上传 ${uploadProgress ?? 0}%`,
                      `Uploading ${uploadProgress ?? 0}%`,
                    )
                : text(
                    "提交已启用平台审批 →",
                    "Submit enabled platforms for review →",
                  )}
            </button>
            {uploadProgress !== null && (
              <div
                className="upload-meter"
                aria-label={text("上传进度", "Upload progress")}
              >
                <span>
                  <i style={{ width: `${uploadProgress}%` }} />
                </span>
                <small>
                  {uploadProgress === 100 && publishing
                    ? text(
                        "服务器正在创建待审批记录",
                        "Server is creating the review submission",
                      )
                    : `${uploadProgress}%`}
                </small>
              </div>
            )}
          </section>
        </div>
      </section>

      <dialog
        ref={dialogRef}
        className="modal"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current.close();
        }}
      >
        <div className="dialog">
          <div
            className={`success${job?.status === "failed" ? " failed" : ""}`}
          >
            {job?.status === "failed" ? "!" : "✓"}
          </div>
          <h2>
            {job?.status === "pending_review"
              ? text("已提交审批", "Submitted for review")
              : job?.status === "failed"
                ? text("提交失败", "Submission failed")
                : text("提交已完成", "Submission complete")}
          </h2>
          <p>
            {job?.status === "pending_review"
              ? text(
                  "审批通过前不会发布到任何平台。你可以在上传记录中查看状态。",
                  "Nothing will be published until the video is approved. Track it in Upload records.",
                )
              : text("处理结果已经返回。", "The result is ready.")}
          </p>
          <div className="job-id">Submission ID · {job?.requestId ?? "—"}</div>
          {job?.status !== "pending_review" && (
            <div className="platform-results">
              {platformOptions
                .filter((platform) => platforms.includes(platform.id))
                .map((platform) => {
                  const result = job?.results.find(
                    (item) => item.platform === platform.id,
                  );
                  const link = result?.post_url || result?.url;
                  const state = platformResultState(result, job?.status);
                  const message =
                    state === "failed"
                      ? platformFailureReason(
                          result,
                          text(
                            "平台未提供失败原因",
                            "The platform did not provide a failure reason",
                          ),
                        )
                      : state === "completed"
                        ? result?.fallback_to_inbox
                          ? text(
                              "已发送至 TikTok 草稿箱",
                              "Sent to TikTok inbox",
                            )
                          : text("已完成", "Completed")
                        : text("处理中，请稍候", "Processing, please wait");
                  return (
                    <div key={platform.id}>
                      <i className={`pi ${platform.className}`}>
                        {platform.icon}
                      </i>
                      <span>
                        <strong>{platform.name}</strong>
                        <small>{message}</small>
                      </span>
                      {state === "completed" && link ? (
                        <a href={link} target="_blank" rel="noreferrer">
                          ↗
                        </a>
                      ) : (
                        <b className={state === "failed" ? "bad" : ""}>
                          {state === "failed"
                            ? "!"
                            : state === "completed"
                              ? "✓"
                              : "…"}
                        </b>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
          <button
            onClick={() =>
              job?.status === "pending_review"
                ? router.push("/records")
                : dialogRef.current?.close()
            }
          >
            {job?.status === "pending_review"
              ? text("查看上传记录 →", "View upload records →")
              : text("关闭", "Close")}
          </button>
        </div>
      </dialog>
    </AppShell>
  );
}

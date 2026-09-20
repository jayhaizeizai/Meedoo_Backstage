"use client";
import { videoTypes, type VideoType } from "../../lib/video-type";
import { useLanguage } from "../language-provider";
import { socialTextLength, socialTextLimit } from "../../lib/social-platforms";
import { platformOptions } from "./upload-model";
import type { useUploadWorkflow } from "./use-upload-workflow";
type Props = Pick<
  ReturnType<typeof useUploadWorkflow>,
  | "videoType"
  | "setVideoType"
  | "file"
  | "platformContent"
  | "syncPlatformContent"
  | "platforms"
  | "connection"
  | "connectedCount"
  | "validationError"
  | "updatePlatformContent"
  | "toggleContentSync"
>;
export function PlatformContentForm({
  videoType,
  setVideoType,
  file,
  platformContent,
  syncPlatformContent,
  platforms,
  connection,
  connectedCount,
  validationError,
  updatePlatformContent,
  toggleContentSync,
}: Props) {
  const { text } = useLanguage();
  return (
    <>
      <div className="ctitle">
        <div>
          <span>✦</span>
          <div>
            <h2>
              {syncPlatformContent
                ? text("已启用平台共用内容", "Shared content for all platforms")
                : text("各平台独立内容", "Content for each platform")}
            </h2>
            <p>
              {syncPlatformContent
                ? text(
                    "填写一次，用于已启用平台",
                    "Enter once and use it across enabled platforms",
                  )
                : text(
                    "分别填写已启用平台的标题和文案",
                    "Customize the title and caption for each platform",
                  )}
            </p>
          </div>
        </div>
        <small>
          {platforms.length} / {platforms.length}
        </small>
      </div>
      <div
        className={`provider-state${connection?.configured ? " ready" : ""}`}
      >
        <span>{connection?.configured ? "✓" : "…"}</span>
        <div>
          <strong>
            {connection === null
              ? text("正在检查 Upload-Post", "Checking Upload-Post")
              : connection.configured
                ? text(
                    `Profile: ${connection.profile ?? "—"}`,
                    `Profile: ${connection.profile ?? "—"}`,
                  )
                : text(
                    "等待 API Key 与 Profile",
                    "Awaiting API Key and profile",
                  )}
          </strong>
          <small>
            {connection?.configured
              ? text(
                  `${connectedCount} 个平台授权有效`,
                  `${connectedCount} platform connections available`,
                )
              : text(
                  "配置后无需修改前端代码",
                  "No frontend changes needed after setup",
                )}
          </small>
        </div>
      </div>

      {platforms.includes("facebook") && (
        <p className="field-rule">
          {text(
            "Facebook 发布到已配置的公共主页，使用 Reels：3–90 秒，竖屏至少 540 × 960。",
            "Facebook publishes Reels to the configured Page: 3–90 seconds, portrait, at least 540 × 960.",
          )}
        </p>
      )}
      {platforms.includes("x") && (
        <p className="field-rule">
          {text(
            "X 按单帖处理，标题和文案合计最多 280 加权字符（非 ASCII 按 2 计）；Upload-Post 默认移除链接。可关闭内容同步，为 X 单独缩短文案。",
            "X uses a single post with at most 280 weighted characters (non-ASCII counts as 2). Upload-Post removes links by default. Turn off content sync to shorten the X copy.",
          )}
        </p>
      )}
      <label className="video-type-field">
        <span>{text("视频类型（必选）", "Video type (required)")}</span>
        <select value={videoType} onChange={(event) => setVideoType(event.target.value as VideoType | "")} required>
          <option value="">{text("请选择一个主要创作目标", "Select one primary content goal")}</option>
          {videoTypes.map((item) => <option key={item.value} value={item.value}>{text(item.zh, item.en)}</option>)}
        </select>
        <small>{text("转发：表达认同；收藏：留待使用；访问网站：进一步了解。选择本条视频最主要的目标。", "Repost: express shared values. Saves: keep useful content. Website Visit: learn more. Choose the video's primary goal.")}</small>
      </label>
      <button
        className={`content-sync-toggle${syncPlatformContent ? " active" : ""}`}
        type="button"
        onClick={toggleContentSync}
        aria-pressed={syncPlatformContent}
      >
        <span>{syncPlatformContent ? "✓" : ""}</span>
        <div>
          <strong>
            {text("同步已启用平台内容", "Keep platform content in sync")}
          </strong>
          <small>
            {syncPlatformContent
              ? text(
                  "编辑任意一项会同步到已启用平台",
                  "Edits apply to enabled platforms",
                )
              : text("已开启独立编辑", "Platform fields can now differ")}
          </small>
        </div>
      </button>
      {syncPlatformContent ? (
        (() => {
          const content = platformContent.tiktok;
          const combined =
            content.title.trim().length +
            (content.caption.trim() ? 2 + content.caption.trim().length : 0);
          const captionBytes = new TextEncoder().encode(
            content.caption.trim(),
          ).length;
          return (
            <section className="platform-content-card shared-content-card">
              <header>
                <span className="shared-platform-icons">
                  {platformOptions
                    .filter((platform) => platforms.includes(platform.id))
                    .map((platform) => (
                      <i
                        className={`pi ${platform.className}`}
                        key={platform.id}
                      >
                        {platform.icon}
                      </i>
                    ))}
                </span>
                <strong>
                  {text("已启用平台共用", "Shared across enabled platforms")}
                </strong>
              </header>
              <label className="label field-label" htmlFor="shared-title">
                <span>{text("标题（必填）", "Title (required)")}</span>
                <small>{content.title.length} / 100</small>
              </label>
              <input
                id="shared-title"
                maxLength={100}
                value={content.title}
                placeholder={text(
                  "选择文件后自动使用文件名",
                  "Uses the filename after selection",
                )}
                onChange={(event) =>
                  updatePlatformContent("tiktok", "title", event.target.value)
                }
              />
              <label className="label field-label" htmlFor="shared-caption">
                <span>{text("文案（含话题标签，必填）", "Caption(hashtag) (required)")}</span>
                <small>
                  {platforms.includes("x") && (
                    <>
                      {socialTextLength(
                        "x",
                        `${content.title.trim()}\n\n${content.caption.trim()}`,
                      )}{" "}
                      / 280 (X) ·{" "}
                    </>
                  )}
                  {combined} / 2,200
                </small>
              </label>
              <textarea
                id="shared-caption"
                maxLength={2200}
                value={content.caption}
                placeholder={text("输入共用文案", "Enter the shared caption")}
                onChange={(event) =>
                  updatePlatformContent("tiktok", "caption", event.target.value)
                }
              />
            </section>
          );
        })()
      ) : (
        <div className="platform-content-list">
          {platformOptions
            .filter((platform) => platforms.includes(platform.id))
            .map((platform) => {
              const content = platformContent[platform.id];
              const combined =
                content.title.trim().length +
                (content.caption.trim()
                  ? 2 + content.caption.trim().length
                  : 0);
              const captionBytes = new TextEncoder().encode(
                content.caption.trim(),
              ).length;
              const connected = Boolean(connection?.connected[platform.id]);
              return (
                <section className="platform-content-card" key={platform.id}>
                  <header>
                    <i className={`pi ${platform.className}`}>
                      {platform.icon}
                    </i>
                    <strong>{platform.name}</strong>
                    <span className={connected ? "connected" : "disconnected"}>
                      {connected
                        ? text("已连接", "Connected")
                        : text("未连接", "Not connected")}
                    </span>
                  </header>
                  <label
                    className="label field-label"
                    htmlFor={`${platform.id}-title`}
                  >
                    <span>{text("标题（必填）", "Title (required)")}</span>
                    <small>{content.title.length} / 100</small>
                  </label>
                  <input
                    id={`${platform.id}-title`}
                    maxLength={100}
                    value={content.title}
                    placeholder={text(
                      "选择文件后自动使用文件名",
                      "Uses the filename after selection",
                    )}
                    onChange={(event) =>
                      updatePlatformContent(
                        platform.id,
                        "title",
                        event.target.value,
                      )
                    }
                  />
                  <label
                    className="label field-label"
                    htmlFor={`${platform.id}-caption`}
                  >
                    <span>{text("文案（含话题标签，必填）", "Caption(hashtag) (required)")}</span>
                    <small>
                      {socialTextLength(
                        platform.id,
                        `${content.title.trim()}\n\n${content.caption.trim()}`,
                      )}{" "}
                      / {socialTextLimit(platform.id)} · {captionBytes} / 5,000
                      bytes
                    </small>
                  </label>
                  <textarea
                    id={`${platform.id}-caption`}
                    maxLength={2200}
                    value={content.caption}
                    placeholder={text(
                      `输入 ${platform.name} 文案`,
                      `Enter the ${platform.name} caption`,
                    )}
                    onChange={(event) =>
                      updatePlatformContent(
                        platform.id,
                        "caption",
                        event.target.value,
                      )
                    }
                  />
                </section>
              );
            })}
        </div>
      )}
      <small
        className={`field-rule${file && validationError ? " invalid" : ""}`}
      >
        {file && validationError
          ? `⚠ ${validationError}`
          : syncPlatformContent
            ? text(
                "共用标题和文案会保存为已启用平台内容；取消勾选后可分别修改。",
                "The shared title and caption are saved for enabled platforms; turn sync off to customize them.",
              )
            : text(
                "已启用平台标题和文案必须全部填写。标题 1–100 字；每组标题与文案合计 ≤2,200 字；不可包含 < 或 >。",
                "All five platforms’ titles and captions are required. Each title is 1–100 chars; each title + caption is ≤2,200 chars; no < or >.",
              )}
      </small>
    </>
  );
}

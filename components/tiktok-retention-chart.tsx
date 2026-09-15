"use client";

import { useRef, useState } from "react";
import type { TikTokRetention } from "../lib/tiktok-retention";

export function TikTokRetentionChart({
  data,
  capturedAt,
  views,
  language,
  videoId,
}: {
  videoId: string;
  data: TikTokRetention | null;
  capturedAt: string | null;
  views: number | null;
  language: "zh" | "en";
}) {
  const t = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  function nearestIndex(second: number) {
    let nearest = 0;
    for (let i = 1; i < points.length; i++) {
      if (
        Math.abs(points[i].second - second) <
        Math.abs(points[nearest].second - second)
      )
        nearest = i;
    }
    return nearest;
  }
  function seekPoint(nextIndex: number) {
    setIndex(nextIndex);
    const second = points[nextIndex]?.second;
    const video = videoRef.current;
    if (second == null || !video || mediaError) return;
    pendingSeek.current = second;
    if (video.readyState >= 1) applySeek();
  }
  function applySeek() {
    const video = videoRef.current;
    if (
      !video ||
      pendingSeek.current == null ||
      !Number.isFinite(video.duration)
    )
      return;
    video.currentTime = Math.min(
      video.duration,
      Math.max(0, pendingSeek.current),
    );
    setPlaybackTime(video.currentTime);
    pendingSeek.current = null;
  }
  function pointerIndex(
    event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>,
  ) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const second =
      ((((event.clientX - bounds.left) / bounds.width) * width - left) /
        (width - left - right)) *
      duration;
    return nearestIndex(second);
  }
  const points = data?.segments.flat() ?? [];
  const point = points[Math.min(index, points.length - 1)];
  const width = 760,
    height = 260,
    left = 52,
    right = 24,
    top = 18,
    bottom = 38;
  const duration = Math.max(1, data?.duration ?? 0, points.at(-1)?.second ?? 0);
  const x = (seconds: number) =>
    left + (seconds / duration) * (width - left - right);
  const y = (fraction: number) =>
    top + (1 - fraction) * (height - top - bottom);
  const percent = (value: number | null | undefined) =>
    value == null ? "—" : `${value.toFixed(1)}%`;
  const messages = {
    missing_curve: t(
      "平台尚未提供留存曲线。",
      "The platform has not provided a retention curve yet.",
    ),
    missing_duration: t(
      "缺少视频时长，暂不计算曲线分。",
      "Video duration is missing; the curve score is unavailable.",
    ),
    incomplete_curve: t(
      "曲线存在采样缺口或末尾缺少至少 1 秒，暂不计算曲线分。",
      "The curve has gaps or does not cover the full video; the score is unavailable.",
    ),
    invalid_curve: t(
      "平台曲线数据异常，暂不计算曲线分。",
      "The platform curve contains invalid data; the score is unavailable.",
    ),
    complete: "",
  };
  return (
    <section className="card tiktok-retention-card">
      <header>
        <div>
          <p className="eyebrow">TIKTOK RETENTION</p>
          <h2>{t("观众留存曲线", "Audience retention curve")}</h2>
        </div>
        {capturedAt && (
          <small>
            {t("采集于 ", "Captured ")}
            {new Date(capturedAt).toLocaleString(
              language === "zh" ? "zh-CN" : "en-US",
              { timeZone: "Asia/Singapore" },
            )}{" "}
            SGT
          </small>
        )}
      </header>
      <div className="retention-stat-grid">
        <div>
          <small>{t("留存曲线分 / 100", "Curve score / 100")}</small>
          <strong>
            {data?.status === "complete" ? data.score?.toFixed(1) : "—"}
          </strong>
        </div>
        <div>
          <small>{t("3 秒留存", "3-second retention")}</small>
          <strong>{percent(data?.threeSecondRate)}</strong>
        </div>
        <div>
          <small>{t("实际完播率", "Full-video completion")}</small>
          <strong>{percent(data?.completionRate)}</strong>
        </div>
        <div>
          <small>{t("TikTok 播放量", "TikTok views")}</small>
          <strong>
            {views == null
              ? "—"
              : views.toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
          </strong>
        </div>
      </div>
      {(!data || data.status !== "complete") && (
        <p className="retention-status">
          {t("数据不足：", "Insufficient data: ")}
          {data
            ? messages[data.status]
            : t(
                "等待同步留存数据。",
                "Awaiting retention data from the next sync.",
              )}
        </p>
      )}
      <div className="retention-media-layout">
        <div className="retention-video-panel">
          {!mediaError ? (
            <video
              ref={videoRef}
              src={`/api/review-media/${encodeURIComponent(videoId)}`}
              controls
              playsInline
              preload="metadata"
              aria-label={t("留存分析视频", "Video for retention analysis")}
              onLoadedMetadata={applySeek}
              onError={() => setMediaError(true)}
              onTimeUpdate={(event) => {
                const second = event.currentTarget.currentTime;
                setPlaybackTime(second);
                if (points.length) setIndex(nearestIndex(second));
              }}
            />
          ) : (
            <p role="status">
              {t(
                "原视频不可用或无观看权限，仍可查看留存曲线。",
                "The original video is unavailable or access is restricted. You can still view the curve.",
              )}
            </p>
          )}
          <p className="retention-explanation">
            {t(
              "点击曲线或拖动下方滑块，视频会定位到对应时间；播放时曲线同步显示进度。",
              "Click the curve or move the slider to seek the video. The playhead follows video playback.",
            )}
          </p>
        </div>
        {points.length > 0 && (
          <div className="retention-curve-plot">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={t(
                "TikTok 留存率随视频播放秒数变化",
                "TikTok audience retention by second within the video",
              )}
              onPointerMove={(event) => setIndex(pointerIndex(event))}
              onClick={(event) => seekPoint(pointerIndex(event))}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((rate) => (
                <g key={rate}>
                  <line
                    className="retention-grid-line"
                    x1={left}
                    x2={width - right}
                    y1={y(rate)}
                    y2={y(rate)}
                  />
                  <text x={left - 9} y={y(rate) + 4} textAnchor="end">
                    {rate * 100}%
                  </text>
                </g>
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <text
                  key={ratio}
                  x={x(duration * ratio)}
                  y={height - 12}
                  textAnchor="middle"
                >
                  {(duration * ratio).toFixed(1)}s
                </text>
              ))}
              {data?.segments.map((segment, i) => (
                <g key={i}>
                  <polyline
                    className="retention-curve-line"
                    points={segment
                      .map((p) => `${x(p.second)},${y(p.percentage)}`)
                      .join(" ")}
                  />
                  {segment.length === 1 && (
                    <circle
                      cx={x(segment[0].second)}
                      cy={y(segment[0].percentage)}
                      r="3"
                      fill="#168c8c"
                    />
                  )}
                </g>
              ))}
              {!mediaError && (
                <line
                  x1={x(Math.min(duration, playbackTime))}
                  x2={x(Math.min(duration, playbackTime))}
                  y1={top}
                  y2={height - bottom}
                  stroke="#7355e8"
                  strokeWidth="2"
                />
              )}
              {point && (
                <g>
                  <line
                    className="retention-cursor"
                    x1={x(point.second)}
                    x2={x(point.second)}
                    y1={top}
                    y2={height - bottom}
                  />
                  <circle
                    cx={x(point.second)}
                    cy={y(point.percentage)}
                    r="5"
                    fill="#168c8c"
                  />
                </g>
              )}
            </svg>
            <div className="retention-readout">
              <span>{t("视频内播放时间", "Time within video")}</span>
              <output>
                {point?.second.toFixed(1)}s ·{" "}
                {percent(point ? point.percentage * 100 : null)}
              </output>
            </div>
            <input
              type="range"
              aria-label={t(
                "选择留存曲线采样点",
                "Select a reported retention point",
              )}
              min="0"
              max={Math.max(0, points.length - 1)}
              value={Math.min(index, points.length - 1)}
              onChange={(event) => seekPoint(Number(event.target.value))}
            />
          </div>
        )}
      </div>
      <p className="retention-explanation">
        {t(
          "曲线分 = 留存曲线面积 ÷ 视频时长 × 100，表示整段视频的平均留存水平。",
          "Curve score = area under the retention curve ÷ video duration × 100. It measures average retention across the video.",
        )}
      </p>
      {data?.status === "complete" && data.estimatedTailSeconds > 0 && (
        <p className="retention-explanation">
          {t(
            `末尾 ${data.estimatedTailSeconds.toFixed(3)} 秒沿用最后一个采样点的留存率近似计算；图中仅显示平台实际采样点。`,
            `The final ${data.estimatedTailSeconds.toFixed(3)} seconds are estimated using the last reported retention rate. The chart shows reported points only.`,
          )}
        </p>
      )}
      {data?.inferredStart && (
        <p className="retention-explanation">
          {t(
            "计算约定：第 0 秒按 100% 起算；图中只画平台实际返回的采样点。",
            "Calculation convention: retention at second 0 starts at 100%. The chart shows only points actually reported by the platform.",
          )}
        </p>
      )}
    </section>
  );
}

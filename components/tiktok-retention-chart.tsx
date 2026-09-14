"use client";

import { useState } from "react";
import type { TikTokRetention } from "../lib/tiktok-retention";

export function TikTokRetentionChart({
  data,
  capturedAt,
  views,
  language,
}: {
  data: TikTokRetention | null;
  capturedAt: string | null;
  views: number | null;
  language: "zh" | "en";
}) {
  const t = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [index, setIndex] = useState(0);
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
      "曲线未覆盖完整视频或存在缺点，暂不计算曲线分。",
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
      {points.length > 0 && (
        <div className="retention-curve-plot">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={t(
              "TikTok 留存率随视频播放秒数变化",
              "TikTok audience retention by second within the video",
            )}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const second =
                ((((event.clientX - bounds.left) / bounds.width) * width -
                  left) /
                  (width - left - right)) *
                duration;
              let nearest = 0;
              for (let i = 1; i < points.length; i++)
                if (
                  Math.abs(points[i].second - second) <
                  Math.abs(points[nearest].second - second)
                )
                  nearest = i;
              setIndex(nearest);
            }}
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
            onChange={(event) => setIndex(Number(event.target.value))}
          />
        </div>
      )}
      <p className="retention-explanation">
        {t(
          "曲线分 = 留存曲线面积 ÷ 视频时长 × 100，表示整段视频的平均留存水平，不等于完播率。建议比较时长相近的视频；播放量少时先观察。此分数不参与综合分或奖金。",
          "Curve score = area under the retention curve ÷ video duration × 100. It measures average retention across the video, not completion. Compare videos of similar length and treat low-view samples cautiously. Excluded from personal and bonus scores.",
        )}
      </p>
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

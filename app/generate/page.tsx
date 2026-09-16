"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";
import {
  estimateGenerationCost,
  generationRatios,
  type GenerationInput,
} from "../../lib/generation-model";
import "../../styles/generation.css";

type Asset = {
  id: string;
  name: string;
  url: string;
  role: GenerationInput["assets"][number]["role"];
};
type Task = {
  id: string;
  owner_name: string;
  requirement: string;
  input: GenerationInput;
  status: string;
  usage: Record<string, number> | null;
  estimated_cost: string;
  available: boolean;
  error_code: string | null;
  created_at: string;
};
type Summary = {
  owner_name: string;
  requirement: string;
  tasks: number;
  succeeded: number;
  tokens: string | null;
  missing_tokens: number;
  estimated_cost: string | null;
};
export default function GeneratePage() {
  const { text, language } = useLanguage();
  const [mode, setMode] = useState<"reference" | "frames">("reference"),
    [assets, setAssets] = useState<Asset[]>([]),
    [prompt, setPrompt] = useState(""),
    [requirement, setRequirement] = useState(""),
    [duration, setDuration] = useState(6),
    [ratio, setRatio] = useState("9:16"),
    [resolution, setResolution] = useState<"768P" | "2K">("768P");
  const [tasks, setTasks] = useState<Task[]>([]),
    [summary, setSummary] = useState<Summary[]>([]),
    [configured, setConfigured] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [refreshing, setRefreshing] = useState(false);
  const intent = useRef<{ fingerprint: string; id: string } | null>(null),
    pending = useRef(false),
    polling = useRef(false);
  const status = (s: string) =>
    ({
      submitting: text("正在提交", "Submitting"),
      queued: text("排队中", "Queued"),
      running: text("生成中", "Generating"),
      succeeded: text("已生成", "Generated"),
      failed: text("失败", "Failed"),
      cancelled: text("已取消", "Cancelled"),
      submitted_unknown: text(
        "提交结果待核对，请勿重复生成",
        "Submission uncertain; do not resubmit",
      ),
    })[s] || s;
  const message = (code: string) =>
    ({
      NOT_CONFIGURED: text(
        "服务尚未配置，请联系管理员。",
        "Service is not configured. Contact an administrator.",
      ),
      INVALID_IMAGE: text(
        "图片须为 JPG、PNG、WEBP 或 HEIC，最大 30 MB，宽高 256–5760 像素，宽高比 0.4–2.5。",
        "Use JPG, PNG, WEBP or HEIC up to 30 MB, 256–5760 pixels per side, aspect ratio 0.4–2.5.",
      ),
      TOO_MANY_TASKS: text(
        "最多同时处理 3 个任务，请等待当前任务完成。",
        "Up to 3 tasks can run at once. Please wait.",
      ),
      INVALID_INPUT: text(
        "请检查需求名称、提示词和生成参数。",
        "Check the requirement, prompt and generation settings.",
      ),
      UNAUTHORIZED: text("请重新登录。", "Please sign in again."),
      REQUEST_CONFLICT: text(
        "任务参数已变更，请刷新后重试。",
        "Task parameters changed. Refresh and try again.",
      ),
    })[code] ||
    text(
      "暂时无法完成操作，请稍后刷新。",
      "This operation is unavailable. Please refresh later.",
    );
  const load = useCallback(async () => {
    const r = await fetch("/api/generation", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.code);
    setTasks(d.tasks);
    setSummary(d.summary);
    setConfigured(d.configured);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load().catch(() => {
      setLoaded(true);
      setError(
        language === "zh"
          ? "读取生成记录失败，请刷新。"
          : "Could not load generation history. Refresh to retry.",
      );
    });
  }, [load, language]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (polling.current || document.hidden) return;
      const active = tasks.filter(
        (t) =>
          ["queued", "running"].includes(t.status) ||
          (t.status === "succeeded" && !t.available),
      );
      if (!active.length) return;
      polling.current = true;
      void (async () => {
        try {
          for (const t of active.slice(0, 3))
            await fetch(`/api/generation/${t.id}/refresh`, { method: "POST" });
          await load();
        } catch {
        } finally {
          polling.current = false;
        }
      })();
    }, 15000);
    return () => clearInterval(timer);
  }, [tasks, load]);
  async function upload(files: FileList | null, role: Asset["role"]) {
    if (!files?.length || uploading || busy) return;
    const limit = role === "reference_image" ? 9 - assets.length : 1;
    if (files.length > limit) {
      setError(
        text(
          "参考图最多 9 张，首帧和尾帧各 1 张。",
          "Up to 9 references, or one image per frame.",
        ),
      );
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        if (file.size > 30 * 1024 * 1024) throw Error("INVALID_IMAGE");
        const form = new FormData();
        form.set("file", file);
        const r = await fetch("/api/generation/assets", {
          method: "POST",
          body: form,
        });
        const d = await r.json();
        if (!r.ok) throw Error(d.code);
        setAssets((a) => [
          ...(role === "reference_image"
            ? a
            : a.filter((x) => x.role !== role)),
          { ...d.asset, role },
        ]);
      }
    } catch (e) {
      setError(message(e instanceof Error ? e.message : ""));
    } finally {
      setUploading(false);
    }
  }
  async function submit() {
    if (pending.current || uploading) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const params = {
      requirement,
      prompt,
      mode,
      duration,
      resolution,
      ratio,
      assets: assets.map(({ id, role }) => ({ id, role })),
    };
    const fingerprint = JSON.stringify(params);
    if (intent.current?.fingerprint !== fingerprint)
      intent.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const r = await fetch("/api/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, requestId: intent.current.id }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.code);
      setSelected(d.id);
      await load();
    } catch (e) {
      setError(message(e instanceof Error ? e.message : ""));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const current = tasks.find((t) => t.id === selected) || tasks[0];
  const estimate = estimateGenerationCost(duration, resolution, assets.length);
  const input = (role: Asset["role"], label: string, multiple = false) => (
    <label className="generation-drop">
      <span>{label}</span>
      <small>
        {text("选择图片 · 最大 30 MB", "Choose images · up to 30 MB")}
      </small>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        multiple={multiple}
        disabled={busy || uploading}
        onChange={(e) => {
          void upload(e.target.files, role);
          e.target.value = "";
        }}
      />
    </label>
  );
  return (
    <AppShell
      active="generate"
      status={{
        zh: "MiniMax H3 · 视频生成",
        en: "MiniMax H3 · Video generation",
      }}
    >
      <section className="page generation-page">
        <header className="generation-header">
          <div>
            <p className="eyebrow">CREATE · REVIEW · PUBLISH</p>
            <h1>{text("生成视频", "Generate video")}</h1>
            <p>
              {text(
                "从分镜与参考图开始，把创意变成视频。",
                "Turn storyboards and reference images into video.",
              )}
            </p>
          </div>
          <span className="generation-badge">
            MiniMax H3 · {text("国内站", "China")}
          </span>
        </header>
        {error && (
          <p role="alert" className="data-message error">
            {error}
          </p>
        )}
        {loaded && !configured && (
          <p className="data-message">
            {text(
              "生成服务尚未配置，请联系管理员。",
              "Generation service is not configured. Contact an administrator.",
            )}
          </p>
        )}
        <div className="generation-workspace">
          <section className="card generation-form">
            <h2>{text("创作设置", "Creation settings")}</h2>
            <label>
              {text("需求名称", "Requirement")}
              <input
                maxLength={160}
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                placeholder={text(
                  "例如：比熊犬系列 · 第 3 集",
                  "e.g. Bichon series · Episode 3",
                )}
              />
            </label>
            <div
              className="generation-tabs"
              role="group"
              aria-label={text("素材模式", "Input mode")}
            >
              {(["reference", "frames"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  disabled={busy || uploading}
                  className={mode === m ? "active" : ""}
                  onClick={() => {
                    if (m !== mode) {
                      setMode(m);
                      setAssets([]);
                    }
                  }}
                >
                  {m === "reference"
                    ? text("参考图", "Reference images")
                    : text("首尾帧", "First & last frame")}
                </button>
              ))}
            </div>
            {mode === "reference" ? (
              input(
                "reference_image",
                text(
                  "添加参考图（最多 9 张）",
                  "Add reference images (up to 9)",
                ),
                true,
              )
            ) : (
              <div className="generation-frame-inputs">
                {input(
                  "first_frame",
                  text("首帧（必填）", "First frame (required)"),
                )}
                {input(
                  "last_frame",
                  text("尾帧（可选）", "Last frame (optional)"),
                )}
              </div>
            )}
            {uploading && (
              <small role="status">
                {text("正在上传图片…", "Uploading images…")}
              </small>
            )}
            <div className="generation-assets">
              {assets.map((a, i) => (
                <div key={a.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setPrompt(
                        (p) =>
                          `${p} ${mode === "reference" ? `图片${i + 1}` : a.role === "first_frame" ? "首帧" : "尾帧"} `,
                      )
                    }
                    title={text("插入图片引用", "Insert image reference")}
                  >
                    <img src={a.url} alt={a.name} />
                    <span>
                      {mode === "reference"
                        ? `${text("图片", "Image ")}${i + 1}`
                        : a.role === "first_frame"
                          ? text("首帧", "First frame")
                          : text("尾帧", "Last frame")}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || uploading}
                    className="generation-remove"
                    aria-label={text("移除图片", "Remove image")}
                    onClick={() =>
                      setAssets((v) => v.filter((x) => x.id !== a.id))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <label>
              {text("视频提示词", "Video prompt")}
              <textarea
                rows={6}
                maxLength={7000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={text(
                  "描述角色、动作、场景和镜头。点击参考图可插入图片编号。",
                  "Describe the characters, action, setting and camera. Click a reference to insert its number.",
                )}
              />
              <small>{prompt.length} / 7000</small>
            </label>
            <div className="generation-settings">
              <label>
                {text("时长（秒）", "Duration (seconds)")}
                <input
                  type="number"
                  min={4}
                  max={15}
                  step={1}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </label>
              <label>
                {text("画面比例", "Aspect ratio")}
                <select
                  value={ratio}
                  disabled={mode === "frames"}
                  onChange={(e) => setRatio(e.target.value)}
                >
                  {generationRatios.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                {text("清晰度", "Resolution")}
                <select
                  value={resolution}
                  onChange={(e) =>
                    setResolution(e.target.value as "768P" | "2K")
                  }
                >
                  <option>768P</option>
                  <option>2K</option>
                </select>
              </label>
            </div>
            {mode === "frames" && (
              <small>
                {text(
                  "首尾帧模式的画面比例由图片决定。",
                  "In frame mode, the input images determine the aspect ratio.",
                )}
              </small>
            )}
            <div className="generation-estimate">
              <span>{text("本次预估费用", "Estimated cost")}</span>
              <strong>
                ¥{Number.isFinite(estimate) ? estimate.toFixed(2) : "—"}
              </strong>
            </div>
            <small>
              {text(
                "按国内公开单价估算，实际扣费以 MiniMax 账单为准。",
                "Estimate based on China list prices. Actual charges follow your MiniMax bill.",
              )}
            </small>
            <button
              className="primary generation-submit"
              disabled={
                !configured ||
                busy ||
                uploading ||
                !requirement.trim() ||
                !prompt.trim() ||
                duration < 4 ||
                duration > 15 ||
                (mode === "frames" &&
                  !assets.some((a) => a.role === "first_frame"))
              }
              onClick={() => void submit()}
            >
              {busy
                ? text("正在提交…", "Submitting…")
                : text("生成视频", "Generate video")}
            </button>
            {current && (
              <button
                type="button"
                className="generation-new"
                onClick={() => {
                  intent.current = null;
                  setPrompt("");
                  setSelected(null);
                }}
              >
                {text("开始新的创作", "Start a new creation")}
              </button>
            )}
          </section>
          <section className="card generation-output">
            <div className="generation-output-heading">
              <h2>{text("生成预览", "Generated preview")}</h2>
              <button
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void (async () => {
                    try {
                      if (current)
                        await fetch(`/api/generation/${current.id}/refresh`, {
                          method: "POST",
                        });
                      await load();
                    } catch {
                      setError(message(""));
                    } finally {
                      setRefreshing(false);
                    }
                  })();
                }}
              >
                {refreshing
                  ? text("刷新中…", "Refreshing…")
                  : text("刷新", "Refresh")}
              </button>
            </div>
            {current ? (
              <>
                <h3>{current.requirement}</h3>
                <p>{status(current.status)}</p>
                {current.available ? (
                  <>
                    <video
                      key={current.id}
                      controls
                      playsInline
                      preload="metadata"
                      src={`/api/generation/${current.id}/media`}
                    />
                    <a
                      className="generation-download"
                      href={`/api/generation/${current.id}/media?download=1`}
                    >
                      {text("下载视频", "Download video")} ↓
                    </a>
                    <p className="generation-help">
                      {text(
                        "下载后可在“上传视频”中提交审批；仅支持符合现有发布规格的视频。",
                        "Download and submit through Upload video for approval. Existing publishing requirements still apply.",
                      )}
                    </p>
                  </>
                ) : (
                  <div className="generation-placeholder">
                    <span>✦</span>
                    <p>
                      {current.status === "succeeded"
                        ? text(
                            "正在保存成片，请稍后刷新。",
                            "Saving the generated video. Refresh shortly.",
                          )
                        : status(current.status)}
                    </p>
                  </div>
                )}
                {current.error_code && (
                  <p className="data-message">
                    {current.error_code === "OUTPUT_SAVE_PENDING"
                      ? text(
                          "成片已生成，服务器保存待重试。请刷新。",
                          "Video generated; saving needs another attempt. Refresh to retry.",
                        )
                      : current.status === "submitted_unknown"
                        ? text(
                            "平台可能已接收任务，请联系管理员核对，避免重复扣费。",
                            "The provider may have accepted this task. Ask an administrator to reconcile it before resubmitting.",
                          )
                        : text(
                            `任务未完成（${current.error_code}）。`,
                            `Task not completed (${current.error_code}).`,
                          )}
                  </p>
                )}
                <div className="generation-usage">
                  <div>
                    <small>{text("总 Token", "Total tokens")}</small>
                    <strong>
                      {current.usage?.total_tokens?.toLocaleString() ??
                        text("未返回", "Not reported")}
                    </strong>
                  </div>
                  <div>
                    <small>{text("输出秒数", "Output seconds")}</small>
                    <strong>{current.usage?.output_seconds ?? "—"}</strong>
                  </div>
                  <div>
                    <small>{text("预估费用", "Estimated cost")}</small>
                    <strong>
                      ¥{Number(current.estimated_cost).toFixed(2)}
                    </strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="generation-placeholder">
                <span>✦</span>
                <h3>
                  {text("成片会显示在这里", "Your video will appear here")}
                </h3>
                <p>
                  {text(
                    "添加素材、填写提示词，开始创作。",
                    "Add your images and prompt to start creating.",
                  )}
                </p>
              </div>
            )}
          </section>
        </div>
        <section className="card generation-history">
          <h2>{text("生成记录", "Generation history")}</h2>
          <p>
            {text(
              "记录按登录账号归属；审批人可查看团队记录。",
              "Records belong to the signed-in account; approvers can view the team.",
            )}
          </p>
          <div className="generation-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    text("需求", "Requirement"),
                    text("创建人", "Creator"),
                    text("时间", "Created"),
                    text("状态", "Status"),
                    text("Token", "Tokens"),
                    text("预估费用", "Estimated cost"),
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button onClick={() => setSelected(t.id)}>
                        {t.requirement}
                      </button>
                    </td>
                    <td>{t.owner_name}</td>
                    <td>
                      {new Date(t.created_at).toLocaleString(
                        language === "zh" ? "zh-CN" : "en-US",
                        { timeZone: "Asia/Singapore" },
                      )}
                    </td>
                    <td>{status(t.status)}</td>
                    <td>{t.usage?.total_tokens?.toLocaleString() ?? "—"}</td>
                    <td>¥{Number(t.estimated_cost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!tasks.length && (
            <p>{text("暂无生成记录。", "No generation history yet.")}</p>
          )}
        </section>
        <section className="card generation-history">
          <h2>{text("按需求汇总用量", "Usage by requirement")}</h2>
          <small>
            {text(
              "累计记录；费用只汇总成功任务的预估值。Token 未返回的任务不按零计算。",
              "All-time records; costs sum successful-task estimates. Missing token usage is not counted as zero.",
            )}
          </small>
          <div className="generation-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    text("创建人／需求", "Creator / requirement"),
                    text("成功／总任务", "Succeeded / total"),
                    text("已报告 Token", "Reported tokens"),
                    text("Token 未返回", "Tokens missing"),
                    text("预估费用", "Estimated cost"),
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.map((s, i) => (
                  <tr key={i}>
                    <td>
                      {s.owner_name} · {s.requirement}
                    </td>
                    <td>
                      {s.succeeded} / {s.tasks}
                    </td>
                    <td>
                      {s.tokens === null
                        ? "—"
                        : Number(s.tokens).toLocaleString()}
                    </td>
                    <td>{s.missing_tokens}</td>
                    <td>
                      {s.estimated_cost === null
                        ? "—"
                        : `¥${Number(s.estimated_cost).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </AppShell>
  );
}

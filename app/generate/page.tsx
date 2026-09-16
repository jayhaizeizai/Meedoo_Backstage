"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";
import { useReferenceCompression } from "../../components/generation-image-compression";
import {
  generationRatios,
  generationModels,
  generationModel,
  type GenerationModel,
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
  available: boolean;
  expired: boolean;
  media_expires_at: string | null;
  error_code: string | null;
  provider_error?: { code?: string; request_id?: string; parameter?: string; http_status?: number } | null;
  created_at: string;
};
export default function GeneratePage() {
  const { text, language } = useLanguage();
  const compression = useReferenceCompression();
  const [model, setModel] = useState<GenerationModel>("minimax-h3");
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [imageSync, setImageSync] = useState<Record<string, string>>({});
  const settings = generationModel(model);
  const [mode, setMode] = useState<"reference" | "frames">("reference"),
    [assets, setAssets] = useState<Asset[]>([]),
    [prompt, setPrompt] = useState(""),
    [duration, setDuration] = useState(6),
    [ratio, setRatio] = useState("9:16"),
    [resolution, setResolution] =
      useState<GenerationInput["resolution"]>("768P");
  const [tasks, setTasks] = useState<Task[]>([]),
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
      preparing: text("正在准备参考图", "Preparing reference images"),
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
      COMPRESSION_FAILED: text(
        "浏览器无法压缩这张图片。请重新选择图片并保留原图上传，或先转换为 JPG / PNG。",
        "Your browser could not compress this image. Select it again and upload the original, or convert it to JPG / PNG first.",
      ),
      TOO_MANY_TASKS: text(
        "最多同时处理 3 个任务，请等待当前任务完成。",
        "Up to 3 tasks can run at once. Please wait.",
      ),
      INVALID_INPUT: text(
        "请检查提示词和生成参数。",
        "Check the prompt and generation settings.",
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
    setConfigured(d.configured);
    setModels(d.models ?? ["minimax-h3"]);
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
          ["preparing", "queued", "running"].includes(t.status) ||
          (t.status === "succeeded" && !t.available && !t.expired),
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
  const syncImage = useCallback(async (id: string, retry = false, manual = false) => {
    try {
      if (retry) setImageSync((v) => ({ ...v, [id]: "pending" }));
      const response = await fetch(`/api/generation/assets/${id}/sync${manual ? "?retry=1" : ""}`, {
        method: retry ? "POST" : "GET", cache: "no-store",
      });
      if (!response.ok) throw Error("SYNC_UNAVAILABLE");
      const result = await response.json();
      setImageSync((v) => ({ ...v, [id]: result.status }));
    } catch {
      setImageSync((v) => ({ ...v, [id]: "unavailable" }));
    }
  }, []);
  useEffect(() => {
    if (model !== "minimax-h3" || !assets.length) return;
    let active = true, checking = false;
    // Includes images uploaded while another model was selected.
    void (async () => {
      for (const asset of assets) {
        if (!active) break;
        await syncImage(asset.id, true);
      }
    })();
    const timer = setInterval(() => {
      if (!active || checking || document.hidden) return;
      checking = true;
      void (async () => {
        try { for (const asset of assets) { if (!active) break; await syncImage(asset.id); } }
        finally { checking = false; }
      })();
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [assets, model, syncImage]);
  async function upload(files: FileList | null, role: Asset["role"]) {
    if (!files?.length || uploading || busy) return;
    const limit =
      role === "reference_image" ? settings.maxImages - assets.length : 1;
    if (files.length > limit) {
      setError(
        text(
          `参考图最多 ${settings.maxImages} 张，首帧和尾帧各 1 张。`,
          `Up to ${settings.maxImages} references, or one image per frame.`,
        ),
      );
      return;
    }
    setUploading(true);
    setError("");
    try {
      const prepared = await compression.prepareFiles(Array.from(files));
      if (!prepared) return;
      for (const file of prepared) {
        if (file.size > 30 * 1024 * 1024) throw Error("INVALID_IMAGE");
        const form = new FormData();
        form.set("file", file);
        form.set("model", model);
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
      model,
      ...(settings.provider === "ark" ? { generateAudio } : {}),
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
        zh: "AI · 视频生成",
        en: "AI · Video generation",
      }}
    >
      <section className="page generation-page">
        {compression.dialog}
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
            {settings.label} · {text("国内站", "China")}
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
              {text("生成模型", "Generation model")}
              <select
                value={model}
                disabled={busy || uploading}
                onChange={(e) => {
                  const next = e.target.value as GenerationModel;
                  const options = generationModel(next);
                  setModel(next);
                  setResolution(options.provider === "ark" ? "720p" : "768P");
                  setDuration((d) => Math.min(d, options.maxDuration));
                  intent.current = null;
                }}
              >
                {(Object.keys(generationModels) as GenerationModel[]).map(
                  (id) => (
                    <option key={id} value={id} disabled={!models.includes(id)}>
                      {generationModels[id].label}
                      {loaded && !models.includes(id)
                        ? text("（未配置）", " (not configured)")
                        : ""}
                    </option>
                  ),
                )}
              </select>
            </label>
            {settings.provider === "ark" && (
              <label>
                <span>{text("生成声音", "Generate audio")}</span>
                <select
                  value={String(generateAudio)}
                  onChange={(e) => setGenerateAudio(e.target.value === "true")}
                >
                  <option value="true">{text("开启", "On")}</option>
                  <option value="false">{text("关闭", "Off")}</option>
                </select>
              </label>
            )}
            {assets.length > settings.maxImages && (
              <p className="data-message">
                {text(
                  `当前模型最多支持 ${settings.maxImages} 张参考图，请移除多余图片。`,
                  `This model supports up to ${settings.maxImages} reference images. Remove extra images.`,
                )}
              </p>
            )}
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
                  `添加参考图（最多 ${settings.maxImages} 张）`,
                  `Add reference images (up to ${settings.maxImages})`,
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
                {compression.compressing
                  ? text("正在压缩图片…", "Compressing images…")
                  : text("正在准备并上传图片…", "Preparing and uploading images…")}
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
                  {model === "minimax-h3" && (
                    <div className="generation-image-status" aria-live="polite">
                      <small>{imageSync[a.id] === "ready"
                        ? text("已就绪", "Ready")
                        : imageSync[a.id] === "failed"
                          ? text("同步失败", "Sync failed")
                          : imageSync[a.id] === "retrying"
                            ? text("自动重试中", "Retrying")
                            : imageSync[a.id] === "unavailable"
                              ? text("状态读取失败", "Status unavailable")
                              : text("同步中…", "Syncing…")}</small>
                      {["failed", "unavailable"].includes(imageSync[a.id]) &&
                        <button type="button" onClick={() => void syncImage(a.id, true, true)}>
                          {text("重试", "Retry")}
                        </button>}
                    </div>
                  )}
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
                  max={settings.maxDuration}
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
                    setResolution(
                      e.target.value as GenerationInput["resolution"],
                    )
                  }
                >
                  {settings.resolutions.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
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
            <button
              className="primary generation-submit"
              disabled={
                !configured ||
                busy ||
                uploading ||
                !prompt.trim() ||
                duration < 4 ||
                duration > settings.maxDuration ||
                !models.includes(model) ||
                assets.length > settings.maxImages ||
                (model === "minimax-h3" && assets.some((a) => imageSync[a.id] === "failed")) ||
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
                <p>
                  {generationModel(current.input.model).label} ·{" "}
                  {status(current.status)}
                </p>
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
                      {current.expired
                        ? text("文件已过期", "File expired")
                        : current.status === "succeeded"
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
                    {current.error_code === "INPUT_UPLOAD_FAILED"
                      ? text(
                          "参考图上传至生成平台失败，尚未提交视频生成。请重新发起任务。",
                          "Reference upload failed before video generation was submitted. Start a new task to retry.",
                        )
                      : current.error_code === "INPUT_MEDIA_UNREACHABLE"
                        ? text(
                            "生成平台无法读取参考图。请重新发起任务，系统会先缓存参考图。",
                            "The provider could not read a reference image. Start a new task to use cached references.",
                          )
                        : current.error_code === "PROVIDER_ACCESS_DENIED"
                          ? text(
                              "模型调用权限不足，请在对应平台确认模型已开通且密钥有权限。",
                              "Model access denied. Check activation and key permissions with the provider.",
                            )
                          : current.error_code === "PROVIDER_PAYMENT_REQUIRED"
                            ? text(
                                "平台余额或额度不足，请联系管理员。",
                                "Provider balance or quota is insufficient. Contact an administrator.",
                              )
                            : current.error_code === "OUTPUT_SAVE_PENDING"
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
                {current.provider_error && (
                  <p className="data-message" role="status">
                    {current.provider_error.code === "ModelNotOpen"
                      ? text("模型尚未开通，请在火山方舟控制台开通。", "Activate this model in the Ark console.")
                      : text("平台拒绝了本次请求，请根据以下错误信息检查模型权限、参数或素材。", "The provider rejected this request. Check access, parameters or media using the details below.")}
                    {current.provider_error.code && <><br />{text("错误码：", "Error: ")}{current.provider_error.code}</>}
                    {current.provider_error.parameter && <><br />{text("相关参数：", "Parameter: ")}{current.provider_error.parameter}</>}
                    {current.provider_error.request_id && <><br />{text("请求编号：", "Request ID: ")}{current.provider_error.request_id}</>}
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
              "成片保存 14 天后自动清理，请及时下载。生成记录保留；审批人可查看团队记录。",
              "Generated files are automatically deleted after 14 days. Download them in time. Records remain; approvers can view the team.",
            )}
          </p>
          <div className="generation-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    text("视频", "Video"),
                    text("模型", "Model"),
                    text("创建人", "Creator"),
                    text("时间", "Created"),
                    text("状态", "Status"),
                    text("Token", "Tokens"),
                    text("下载", "Download"),
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
                    <td>{generationModel(t.input.model).label}</td>
                    <td>{t.owner_name}</td>
                    <td>
                      {new Date(t.created_at).toLocaleString(
                        language === "zh" ? "zh-CN" : "en-US",
                        { timeZone: "Asia/Singapore" },
                      )}
                    </td>
                    <td>{status(t.status)}</td>
                    <td>{t.usage?.total_tokens?.toLocaleString() ?? "—"}</td>
                    <td>
                      {t.available ? (
                        <a
                          className="generation-record-download"
                          href={`/api/generation/${t.id}/media?download=1`}
                        >
                          {text("下载视频", "Download video")} ↓
                        </a>
                      ) : t.expired ? (
                        text("文件已过期", "File expired")
                      ) : t.status === "succeeded" ? (
                        text("保存中", "Saving")
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!tasks.length && (
            <p>{text("暂无生成记录。", "No generation history yet.")}</p>
          )}
        </section>
      </section>
    </AppShell>
  );
}

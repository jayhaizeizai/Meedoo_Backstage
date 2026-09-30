"use client";
import { uploadChecklistVersion, validUploadChecklist } from "../../lib/upload-checklist";
import { type VideoType } from "../../lib/video-type";
import { prepareVideoUpload } from "./upload-transport";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { socialTextLength, socialTextLimit } from "../../lib/social-platforms";
import { titleForSelectedFile } from "../../lib/upload-title";
import { useAuth } from "../auth-provider";
import { useLanguage } from "../language-provider";
import { usePlatformConnection } from "./use-platform-connection";
import {
  platformOptions,
  MAX_VIDEO_BYTES,
  MAX_TITLE_CHARACTERS,
  MAX_YOUTUBE_DESCRIPTION_BYTES,
  acceptedVideoTypes,
  emptyPlatformContent,
  normalizeResults,
  mergeResults,
  type PlatformId,
  type PlatformPostContent,
  type PlatformContentState,
  type PublishJob,
  type StagedUpload,
} from "./upload-model";
export function useUploadWorkflow() {
  const { text } = useLanguage();
  const { user, enabledPlatforms } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [videoType, setVideoType] = useState<VideoType | "">("");
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const checklist = { version: uploadChecklistVersion, checked: checkedItems };
  const checklistComplete = validUploadChecklist(checklist);
  function toggleChecklist(id: string) {
    if (publishing) return;
    setCheckedItems(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [platformContent, setPlatformContent] =
    useState<PlatformContentState>(emptyPlatformContent);
  const [syncPlatformContent, setSyncPlatformContent] = useState(true);
  const platforms: readonly string[] = enabledPlatforms;
  const connection = usePlatformConnection(user);
  const [publishing, setPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [publishError, setPublishError] = useState("");
  const [job, setJob] = useState<PublishJob | null>(null);
  const [stagedUpload, setStagedUpload] = useState<StagedUpload | null>(null);

  useEffect(() => {
    if (
      !job?.requestId ||
      ["completed", "failed", "pending_review"].includes(job.status)
    )
      return;
    const delay = ["pending", "queued"].includes(job.status) ? 6000 : 10000;
    const timer = window.setInterval(() => {
      void fetch(
        `/api/upload-post/status?request_id=${encodeURIComponent(job.requestId)}`,
        { cache: "no-store" },
      )
        .then(async (response) => {
          const data = (await response.json()) as {
            status?: string;
            results?: unknown;
          };
          if (response.ok)
            setJob((current) =>
              current
                ? {
                    ...current,
                    status: data.status ?? current.status,
                    results: mergeResults(
                      current.results,
                      normalizeResults(data.results),
                    ),
                  }
                : current,
            );
        })
        .catch(() => undefined);
    }, delay);
    return () => window.clearInterval(timer);
  }, [job?.requestId, job?.status]);

  function chooseFile(nextFile?: File) {
    if (publishing) return;
    if (!nextFile) {
      fileInputRef.current?.click();
      return;
    }
    setPublishError("");
    setUploadProgress(null);
    if (nextFile.size > MAX_VIDEO_BYTES) {
      setPublishError(
        text("视频不能超过 1.5 GB。", "Video must be 1.5 GB or smaller."),
      );
      return;
    }
    if (
      !acceptedVideoTypes.has(nextFile.type) &&
      !/\.(mp4|mov|webm)$/i.test(nextFile.name)
    ) {
      setPublishError(
        text(
          "请选择 MP4、MOV 或 WebM 视频。",
          "Choose an MP4, MOV, or WebM video.",
        ),
      );
      return;
    }
    let restored: StagedUpload | null = null;
    if (stagedUpload) {
      void fetch(`/api/uploads/${stagedUpload.id}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      window.localStorage.removeItem("meedoo_staged_upload");
    } else {
      try {
        const saved = JSON.parse(
          window.localStorage.getItem("meedoo_staged_upload") ?? "null",
        ) as {
          id?: string;
          filename?: string;
          size?: number;
          lastModified?: number;
        } | null;
        if (
          saved?.id &&
          saved.filename === nextFile.name &&
          saved.size === nextFile.size &&
          saved.lastModified === nextFile.lastModified
        )
          restored = {
            id: saved.id,
            chunkSize: 0,
            totalChunks: 0,
            expectedSize: nextFile.size,
            receivedChunks: [],
            status: "uploading",
          };
        else window.localStorage.removeItem("meedoo_staged_upload");
      } catch {
        window.localStorage.removeItem("meedoo_staged_upload");
      }
    }
    setStagedUpload(restored);
    setFile(nextFile);
    setCheckedItems([]);
    setPlatformContent(
      (current) =>
        Object.fromEntries(
          platformOptions.map(({ id }) => [
            id,
            {
              ...current[id],
              title: titleForSelectedFile(
                current[id].title,
                file?.name,
                nextFile.name,
              ),
            },
          ]),
        ) as PlatformContentState,
    );
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

  function updatePlatformContent(
    platform: PlatformId,
    field: keyof PlatformPostContent,
    value: string,
  ) {
    setPlatformContent((current) =>
      syncPlatformContent
        ? (Object.fromEntries(
            platformOptions.map(({ id }) => [
              id,
              { ...current[id], [field]: value },
            ]),
          ) as PlatformContentState)
        : { ...current, [platform]: { ...current[platform], [field]: value } },
    );
  }

  function toggleContentSync() {
    setSyncPlatformContent((current) => {
      const next = !current;
      if (next)
        setPlatformContent(
          (content) =>
            Object.fromEntries(
              platformOptions.map(({ id }) => [id, { ...content.tiktok }]),
            ) as PlatformContentState,
        );
      return next;
    });
  }

  async function publish() {
    if (!file || !user) return;
    if (validationError) {
      setPublishError(validationError);
      return;
    }
    setPublishError("");
    setPublishing(true);
    setUploadProgress(0);

    try {
      const stage = await prepareVideoUpload(
        file,
        stagedUpload,
        setStagedUpload,
        setUploadProgress,
        text,
        checklist,
      );
      setUploadProgress(100);
      const publishResponse = await fetch("/api/upload-post/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadSessionId: stage.id,
          checklist,
          videoType,
          platformContent,
          platforms,
        }),
      });
      const data = (await publishResponse.json()) as {
        requestId?: string;
        status?: string;
        results?: unknown;
        message?: string;
      };
      if (!publishResponse.ok || !data.requestId)
        throw new Error(
          data.message || text("发布请求失败", "Publishing request failed"),
        );
      setUploadProgress(100);
      setJob({
        requestId: data.requestId,
        status: data.status ?? "queued",
        results: normalizeResults(data.results),
      });
      setStagedUpload(null);
      setFile(null);
      setCheckedItems([]);
      setVideoType("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      window.localStorage.removeItem("meedoo_staged_upload");
      dialogRef.current?.showModal();
    } catch (cause) {
      setPublishError(
        cause instanceof Error
          ? cause.message
          : text("发布请求失败", "Publishing request failed"),
      );
    } finally {
      setPublishing(false);
    }
  }

  const connectedCount = platformOptions.filter(
    (platform) =>
      platforms.includes(platform.id) && connection?.connected[platform.id],
  ).length;
  const invalidPlatform = platformOptions
    .filter(({ id }) => platforms.includes(id))
    .find(({ id }) => {
      const content = platformContent[id];
      const combined =
        content.title.trim().length +
        (content.caption.trim() ? 2 + content.caption.trim().length : 0);
      return (
        !content.title.trim() ||
        !content.caption.trim() ||
        content.title.trim().length > MAX_TITLE_CHARACTERS ||
        /[<>]/.test(content.title) ||
        /[<>]/.test(content.caption) ||
        socialTextLength(
          id,
          `${content.title.trim()}\n\n${content.caption.trim()}`,
        ) > socialTextLimit(id) ||
        new TextEncoder().encode(content.caption.trim()).length >
          MAX_YOUTUBE_DESCRIPTION_BYTES
      );
    });
  const validationError = !checklistComplete
    ? text("请逐项勾选全部上传前检查项。", "Check every pre-upload checklist item.")
    : !videoType
    ? text("请选择视频类型（创作目标）。", "Choose a video type (content goal).")
    : invalidPlatform
    ? text(
        `${invalidPlatform.name} 的标题和文案均为必填，并且必须符合长度与字符规则。`,
        `${invalidPlatform.name} requires both a valid title and caption.`,
      )
    : !platforms.length
      ? text("当前没有启用的发布平台。", "No publishing platforms are enabled.")
      : "";
  const selectedPlatformsConnected = platforms.every(
    (platform) =>
      (connection?.available ?? connection?.connected)?.[
        platform as PlatformId
      ],
  );
  const canPublish = Boolean(
    file &&
      !validationError &&
      platforms.length > 0 &&
      user &&
      connection?.configured &&
      selectedPlatformsConnected &&
      !publishing,
  );
  const shellStatus =
    connection === null
      ? { zh: "检查平台连接", en: "Checking platform connections" }
      : connection.configured
        ? {
            zh: `${connectedCount}/${platforms.length} 平台已连接`,
            en: `${connectedCount}/${platforms.length} platforms connected`,
          }
        : { zh: "等待 Upload-Post 配置", en: "Awaiting Upload-Post setup" };

  return {
    checkedItems, toggleChecklist, checklistComplete,
    videoType,
    setVideoType,
    fileInputRef,
    dialogRef,
    file,
    dragging,
    setDragging,
    platformContent,
    syncPlatformContent,
    platforms,
    connection,
    publishing,
    uploadProgress,
    publishError,
    job,
    chooseFile,
    onFileChange,
    onDrop,
    updatePlatformContent,
    toggleContentSync,
    publish,
    connectedCount,
    validationError,
    selectedPlatformsConnected,
    canPublish,
    shellStatus,
  };
}

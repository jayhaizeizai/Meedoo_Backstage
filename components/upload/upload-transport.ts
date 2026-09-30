import { validUploadChecklist } from "../../lib/upload-checklist";
import type { StagedUpload } from "./upload-model";
// Browser-only transport; callbacks keep React state out of the upload protocol.
export async function prepareVideoUpload(
  file: File,
  stagedUpload: StagedUpload | null,
  setStagedUpload: (stage: StagedUpload) => void,
  setUploadProgress: (progress: number) => void,
  text: (zh: string, en: string) => string,
  checklist: { version: string; checked: string[] },
) {
  if (!validUploadChecklist(checklist)) throw new Error(text("请完成上传前检查清单。", "Complete the pre-upload checklist."));
  let stage = stagedUpload;
  if (stage) {
    const response = await fetch(`/api/uploads/${stage.id}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as Partial<StagedUpload> & {
      message?: string;
    };
    if (!response.ok) stage = null;
    else stage = { ...stage, ...payload } as StagedUpload;
  }
  if (!stage) {
    const response = await fetch("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    });
    const payload = (await response.json()) as {
      id?: string;
      chunkSize?: number;
      totalChunks?: number;
      message?: string;
    };
    if (
      !response.ok ||
      !payload.id ||
      !payload.chunkSize ||
      !payload.totalChunks
    )
      throw new Error(
        payload.message ||
          text("无法创建上传任务。", "Could not initialize the upload."),
      );
    stage = {
      id: payload.id,
      chunkSize: payload.chunkSize,
      totalChunks: payload.totalChunks,
      expectedSize: file.size,
      receivedChunks: [],
      status: "uploading",
    };
    setStagedUpload(stage);
    window.localStorage.setItem(
      "meedoo_staged_upload",
      JSON.stringify({
        id: stage.id,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
      }),
    );
  }
  if (stage.status === "uploading") {
    const received = new Set(stage.receivedChunks ?? []);
    let completedBytes = [...received].reduce(
      (sum, index) =>
        sum + Math.min(stage!.chunkSize, file.size - index * stage!.chunkSize),
      0,
    );
    setUploadProgress(
      Math.min(100, Math.round((completedBytes / file.size) * 100)),
    );
    for (let index = 0; index < stage.totalChunks; index++) {
      if (received.has(index)) continue;
      const chunk = file.slice(
        index * stage.chunkSize,
        Math.min(file.size, (index + 1) * stage.chunkSize),
      );
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open("PUT", `/api/uploads/${stage!.id}/chunks/${index}`);
            request.timeout = 10 * 60 * 1000;
            request.setRequestHeader(
              "Content-Type",
              "application/octet-stream",
            );
            request.upload.onprogress = (event) => {
              if (event.lengthComputable)
                setUploadProgress(
                  Math.min(
                    99,
                    Math.round(
                      ((completedBytes + event.loaded) / file.size) * 100,
                    ),
                  ),
                );
            };
            request.onload = () =>
              request.status >= 200 && request.status < 300
                ? resolve()
                : reject(
                    new Error(
                      `${text("分片上传失败", "Chunk upload failed")} (HTTP ${request.status})`,
                    ),
                  );
            request.onerror = () =>
              reject(
                new Error(
                  text(
                    "网络连接中断，正在重试分片。",
                    "Connection interrupted; retrying this chunk.",
                  ),
                ),
              );
            request.ontimeout = () =>
              reject(
                new Error(
                  text("单个分片上传超时。", "A single chunk timed out."),
                ),
              );
            request.send(chunk);
          });
          lastError = undefined;
          break;
        } catch (cause) {
          lastError =
            cause instanceof Error ? cause : new Error("Chunk upload failed");
          if (attempt < 2)
            await new Promise((resolve) =>
              window.setTimeout(resolve, 1000 * (attempt + 1)),
            );
        }
      }
      if (lastError) throw lastError;
      completedBytes += chunk.size;
      received.add(index);
      setStagedUpload({ ...stage, receivedChunks: [...received] });
    }
    const completeResponse = await fetch(`/api/uploads/${stage.id}/complete`, {
      method: "POST",
    });
    const completePayload = (await completeResponse.json()) as {
      message?: string;
    };
    if (!completeResponse.ok)
      throw new Error(
        completePayload.message ||
          text("无法合并视频。", "Could not assemble the video."),
      );
    stage = { ...stage, status: "ready", receivedChunks: [...received] };
    setStagedUpload(stage);
  }
  if (stage.status !== "ready")
    throw new Error(
      text(
        "这个视频上传任务已经被使用，请重新选择文件。",
        "This staged upload has already been used. Choose the file again.",
      ),
    );

  return stage;
}

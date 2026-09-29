"use client";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./language-provider";
import { compressReferenceImage, compressionThreshold } from "../lib/image-compression";

export function useReferenceCompression() {
  const { text } = useLanguage();
  const [files, setFiles] = useState<File[] | null>(null);
  const [compressing, setCompressing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const resolve = useRef<((choice: "compress" | "original" | "cancel") => void) | null>(null);
  useEffect(() => {
    if (files) dialog.current?.showModal();
    else dialog.current?.close();
  }, [files]);
  useEffect(() => () => { resolve.current?.("cancel"); resolve.current = null; }, []);
  function choose(choice: "compress" | "original" | "cancel") {
    resolve.current?.(choice);
    resolve.current = null;
    setFiles(null);
  }
  async function prepareFiles(selected: File[]) {
    const large = selected.filter((file) => file.size > compressionThreshold);
    if (!large.length) return selected;
    const choice = await new Promise<"compress" | "original" | "cancel">((done) => {
      resolve.current = done;
      setFiles(large);
    });
    if (choice === "cancel") return null;
    if (choice === "original") return selected;
    setCompressing(true);
    try {
      const result: File[] = [];
      for (const file of selected) result.push(await compressReferenceImage(file));
      return result;
    } finally { setCompressing(false); }
  }
  return {
    prepareFiles, compressing,
    dialog: <dialog ref={dialog} className="generation-compression-dialog"
      aria-labelledby="compression-title" onCancel={(event) => { event.preventDefault(); choose("cancel"); }}>
      <h2 id="compression-title">{text("图片较大，是否压缩？", "Compress large images?")}</h2>
      <p>{text("以下图片超过 5 MB。可将每张压缩至约 1 MB，加快上传；其余图片保持原样。", "These images exceed 5 MB. Compress each to around 1 MB for faster uploads; other images stay unchanged.")}</p>
      <ul>{files?.map((file, index) => <li key={index}><span>{file.name}</span><strong>{(file.size / 1024 / 1024).toFixed(1)} MB</strong></li>)}</ul>
      <p>{text("压缩可能减少细节，透明区域会变成白色。本机原文件不会被修改。", "Compression may reduce detail and makes transparent areas white. Your original local files are unchanged.")}</p>
      <div className="generation-compression-actions">
        <button type="button" onClick={() => choose("cancel")}>{text("取消", "Cancel")}</button>
        <button type="button" autoFocus onClick={() => choose("original")}>{text("保留原图上传", "Upload originals")}</button>
        <button type="button" className="primary" onClick={() => choose("compress")}>{text("压缩至约 1 MB", "Compress to ~1 MB")}</button>
      </div>
    </dialog>,
  };
}

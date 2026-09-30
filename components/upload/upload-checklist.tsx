"use client";
import { useEffect, useId, useRef } from "react";
import { uploadChecklistItems } from "../../lib/upload-checklist";
import { useLanguage } from "../language-provider";
export function UploadChecklist({ checked, toggle, disabled, file }: { checked: string[]; toggle: (id: string) => void; disabled: boolean; file: File | null }) {
  const { text } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const complete = checked.length === uploadChecklistItems.length;
  useEffect(() => {
    if (file) { if (!dialog.current?.open) dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [file]);
  return <>
    <div className="upload-checklist-summary">
      <div><strong>{text("上传前检查", "Pre-upload check")}</strong><span aria-live="polite">{checked.length} / {uploadChecklistItems.length}</span></div>
      <button type="button" className="choose" disabled={disabled} onClick={() => dialog.current?.showModal()}>{complete ? text("查看清单", "Review checklist") : text("打开检查清单", "Open checklist")}</button>
    </div>
    <dialog ref={dialog} className="upload-checklist-dialog" aria-labelledby={titleId} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
      <header><div><h2 id={titleId}>{text("上传前检查清单", "Pre-upload checklist")}</h2><p aria-live="polite">{text(`已完成 ${checked.length} / ${uploadChecklistItems.length} 项，请逐项确认。`, `${checked.length} / ${uploadChecklistItems.length} checked. Confirm each item.`)}</p></div><button type="button" aria-label={text("关闭检查清单", "Close checklist")} onClick={() => dialog.current?.close()}>×</button></header>
      <fieldset className="upload-checklist-dialog-body" disabled={disabled}>
        <legend className="sr-only">{text("内容检查项", "Content checks")}</legend>
        <div className="upload-checklist-items">{uploadChecklistItems.map(item => <label key={item.id}><input type="checkbox" checked={checked.includes(item.id)} onChange={() => toggle(item.id)} /><span>{text(item.zh, item.en)}</span></label>)}</div>
      </fieldset>
      <footer><button type="button" className="choose" onClick={() => dialog.current?.close()}>{text("稍后继续", "Continue later")}</button><button type="button" className="publish" disabled={!complete || disabled} onClick={() => dialog.current?.close()}>{text("完成检查", "Finish checklist")}</button></footer>
    </dialog>
  </>;
}

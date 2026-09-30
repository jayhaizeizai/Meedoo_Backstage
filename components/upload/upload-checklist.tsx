"use client";
import { uploadChecklistItems } from "../../lib/upload-checklist";
import { useLanguage } from "../language-provider";
export function UploadChecklist({ checked, toggle, disabled }: { checked: string[]; toggle: (id: string) => void; disabled: boolean }) {
  const { text } = useLanguage();
  return <fieldset className="upload-checklist card" disabled={disabled}>
    <legend>{text("上传前检查清单", "Pre-upload checklist")}</legend>
    <p aria-live="polite">{text(`已完成 ${checked.length} / ${uploadChecklistItems.length} 项，请逐项确认后再上传。`, `${checked.length} / ${uploadChecklistItems.length} checked. Confirm each item before uploading.`)}</p>
    <div className="upload-checklist-items">{uploadChecklistItems.map(item => <label key={item.id}>
      <input type="checkbox" checked={checked.includes(item.id)} onChange={() => toggle(item.id)} />
      <span>{text(item.zh, item.en)}</span>
    </label>)}</div>
  </fieldset>;
}

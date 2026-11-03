"use client";
import { useState } from "react";
import { useLanguage } from "./language-provider";
import { platformMeta } from "../lib/social-platforms";
import type { VideoUtmLink } from "../lib/video-utm";
export function VideoUtmLinks({ links = [] }: { links?: VideoUtmLink[] }) {
  const { text } = useLanguage();
  const [message, setMessage] = useState("");
  if (!links.length) return null;
  async function copy(link: VideoUtmLink) {
    try { await navigator.clipboard.writeText(link.url); setMessage(text(`${platformMeta[link.platform].name} 链接已复制`, `${platformMeta[link.platform].name} link copied`)); }
    catch { setMessage(text("复制失败，请选中链接手动复制。", "Copy failed. Select the link and copy it manually.")); }
  }
  return <details className="video-utm-links">
    <summary>{text("主页追踪链接（UTM）", "Homepage tracking links (UTM)")}</summary>
    <p>{text("各平台使用对应链接，访客进入 meedoo.fun 首页。", "Use the matching platform link to send visitors to the meedoo.fun homepage.")}</p>
    {links.map(link => <div className="video-utm-row" key={link.platform}>
      <label><span>{platformMeta[link.platform].name}</span><input readOnly value={link.url} onFocus={event => event.currentTarget.select()} aria-label={`${platformMeta[link.platform].name} UTM`} /></label>
      <button type="button" onClick={() => void copy(link)}>{text("复制", "Copy")}</button>
    </div>)}
    <small role="status">{message}</small>
  </details>;
}

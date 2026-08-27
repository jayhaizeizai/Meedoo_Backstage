"use client";

import Link from "next/link";
import { useLanguage } from "./language-provider";

type AppShellProps = {
  active: "upload" | "dashboard";
  status: { zh: string; en: string };
  children: React.ReactNode;
};

export function AppShell({ active, status, children }: AppShellProps) {
  const { language, text, toggleLanguage } = useLanguage();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">M</span>
          <div>
            <strong>MeeDoo</strong>
            <small>{text("短视频管理", "Short video manager")}</small>
          </div>
        </div>
        <nav className="nav" aria-label={text("主导航", "Main navigation")}>
          <Link className={active === "upload" ? "active" : ""} href="/upload">
            <span aria-hidden="true">↥</span><i>{text("上传视频", "Upload video")}</i>
          </Link>
          <Link className={active === "dashboard" ? "active" : ""} href="/dashboard">
            <span aria-hidden="true">⌁</span><i>{text("数据看板", "Dashboard")}</i>
          </Link>
        </nav>
        <div className="side-bottom">
          <div className="lark">
            <span aria-hidden="true">⚡</span>
            <div><b>{text("Lark 工作台", "Lark workspace")}</b><small>ACME Media</small></div>
            <b aria-hidden="true">↗</b>
          </div>
          <div className="user">
            <span className="avatar">MC</span>
            <div><strong>Mia Chen</strong><small>{text("增长团队", "Growth Team")}</small></div>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="live"><i /><span>{text(status.zh, status.en)}</span></div>
          <div className="top-actions">
            <span className="demo">{text("演示数据", "Demo data")}</span>
            <button className="lang" onClick={toggleLanguage} aria-label={text("切换到英文", "Switch to Chinese")}>
              <b>{language === "zh" ? "中" : "EN"}</b>
              <span>{language === "zh" ? "English" : "中文"}</span>
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

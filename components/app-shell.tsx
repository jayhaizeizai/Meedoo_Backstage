"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "./language-provider";
import { useAuth } from "./auth-provider";

type AppShellProps = {
  active: "upload" | "dashboard" | "records" | "approvals";
  status: { zh: string; en: string };
  children: React.ReactNode;
};

export function AppShell({ active, status, children }: AppShellProps) {
  const { language, text, toggleLanguage } = useLanguage();
  const { configured, loading, user, role, logout } = useAuth();
  const userInitials = user?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "LK";
  const [notifications,setNotifications]=useState<{id:string;message:string;created_at:string;read_at:string|null}[]>([]);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  useEffect(()=>{if(!user)return;void fetch("/api/notifications",{cache:"no-store"}).then((response)=>response.json()).then((payload)=>{if(payload.success)setNotifications(payload.notifications);}).catch(()=>undefined);},[user]);
  const unread=notifications.filter((item)=>!item.read_at).length;
  function toggleNotifications(){const next=!notificationsOpen;setNotificationsOpen(next);if(next&&unread){void fetch("/api/notifications",{method:"PATCH"});setNotifications((items)=>items.map((item)=>({...item,read_at:item.read_at??new Date().toISOString()})));}}

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
          <Link className={active === "records" ? "active" : ""} href="/records"><span aria-hidden="true">☷</span><i>{text("上传记录", "Upload records")}</i></Link>
          {role === "approver" && <Link className={active === "approvals" ? "active" : ""} href="/approvals"><span aria-hidden="true">✓</span><i>{text("视频审批", "Video approvals")}</i></Link>}
        </nav>
        <div className="side-bottom">
          <div className="user">
            {user?.avatar ? <img className="avatar auth-avatar" src={user.avatar} alt="" /> : <span className="avatar">{userInitials}</span>}
            <div>
              <strong>{loading ? text("检查登录状态", "Checking session") : user?.name ?? text("尚未登录", "Not signed in")}</strong>
              <small>{user?.email ?? (configured ? "Lark workspace" : text("等待应用配置", "Awaiting app setup"))}</small>
            </div>
            {user ? <button className="user-action" type="button" onClick={() => void logout()} title={text("退出登录", "Sign out")}>↪</button> : <Link className="user-action" href="/login" title={text("登录", "Sign in")}>→</Link>}
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="live"><i /><span>{text(status.zh, status.en)}</span></div>
          <div className="top-actions">
            <div className="notification-wrap"><button className="notification-button" onClick={toggleNotifications} aria-label={text("状态通知","Status notifications")}>♢{unread>0&&<b>{unread}</b>}</button>{notificationsOpen&&<div className="notification-menu"><strong>{text("状态通知","Status notifications")}</strong>{notifications.length?notifications.map((item)=><div key={item.id}><span>{item.message}</span><small>{new Date(item.created_at).toLocaleString(language==="zh"?"zh-CN":"en-US")}</small></div>):<p>{text("暂无通知","No notifications yet")}</p>}</div>}</div>
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

"use client";

import { safeReturnTo } from "../../lib/safe-return-to";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../components/auth-provider";

const errors: Record<string, { zh: string; en: string }> = {
  not_configured: {
    zh: "Lark 应用凭证尚未配置到服务器。",
    en: "Lark app credentials are not configured on the server yet.",
  },
  denied: {
    zh: "你取消了 Lark 授权。",
    en: "Lark authorization was cancelled.",
  },
  state: {
    zh: "登录请求已过期，请重新开始。",
    en: "The sign-in request expired. Please try again.",
  },
  token: {
    zh: "Lark 未能签发访问令牌，请检查应用配置。",
    en: "Lark could not issue an access token. Check the app configuration.",
  },
  profile: {
    zh: "无法读取 Lark 用户资料，请检查权限。",
    en: "MeeDoo could not read the Lark profile. Check app permissions.",
  },
  network: {
    zh: "连接 Lark 时出现网络错误。",
    en: "A network error occurred while connecting to Lark.",
  },
};

export default function LoginPage() {
  const { configured, loading, user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/upload");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setError(params.get("error"));
    const destination = params.get("returnTo");
    setReturnTo(safeReturnTo(destination));
  }, []);
  const message = error ? errors[error] : null;

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="mark">M</span>
          <div>
            <strong>MeeDoo</strong>
            <small>Lark workspace access</small>
          </div>
        </div>
        <p className="eyebrow">SECURE TEAM ACCESS</p>
        <h1>使用 Lark 登录</h1>
        <p className="login-lead">
          Sign in with Lark to publish videos and attribute every upload to the
          right team member.
        </p>
        {message && (
          <div className="login-error">
            <b>{message.zh}</b>
            <span>{message.en}</span>
          </div>
        )}
        {user ? (
          <Link className="lark-login-button" href={returnTo}>
            已登录为 {user.name} · Continue →
          </Link>
        ) : (
          <a
            className={`lark-login-button${!configured || loading ? " disabled" : ""}`}
            href={
              configured
                ? `/api/auth/lark?returnTo=${encodeURIComponent(returnTo)}`
                : undefined
            }
            aria-disabled={!configured || loading}
          >
            <span>⚡</span>
            {loading
              ? "正在检查配置…"
              : configured
                ? "通过 Lark 继续 · Continue with Lark"
                : "等待 Lark 应用配置"}
          </a>
        )}
        <div className="login-notes">
          <span>✓ 获取姓名与头像</span>
          <span>✓ 记录视频上传者</span>
          <span>✓ 不向浏览器暴露密钥</span>
        </div>
        <small className="login-foot">
          MeeDoo only requests the minimum Lark profile permissions needed for
          team attribution.
        </small>
      </section>
    </main>
  );
}

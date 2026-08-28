import type { Metadata } from "next";
import "../style.css";
import "../leaderboard.css";
import "../video-data.css";
import "./globals.css";
import { LanguageProvider } from "../components/language-provider";
import { AuthProvider } from "../components/auth-provider";

export const metadata: Metadata = {
  title: {
    default: "MeeDoo",
    template: "%s · MeeDoo",
  },
  description: "Publish short videos and understand team performance across TikTok, Instagram and YouTube Shorts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <LanguageProvider><AuthProvider>{children}</AuthProvider></LanguageProvider>
      </body>
    </html>
  );
}

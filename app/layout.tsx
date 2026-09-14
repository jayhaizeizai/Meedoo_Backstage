import type { Metadata } from "next";
import "../styles/base.css";
import "../styles/team-performance.css";
import "../styles/video-data.css";
import "./globals.css";
import { LanguageProvider } from "../components/language-provider";
import { AuthProvider } from "../components/auth-provider";

export const metadata: Metadata = {
  title: {
    default: "MeeDoo Backstage",
    template: "%s · MeeDoo Backstage",
  },
  description:
    "Publish short videos and understand team performance across TikTok, Instagram, YouTube Shorts, Facebook and X.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <LanguageProvider>
          <AuthProvider>{children}</AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

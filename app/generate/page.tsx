"use client";
import { useState } from "react";
import { useAuth } from "../../components/auth-provider";
import { clearGenerationDraft } from "../../components/use-generation-draft";
import { GenerationWorkspace } from "../../components/generation-workspace";
import { AppShell } from "../../components/app-shell";
import { useLanguage } from "../../components/language-provider";
export default function GeneratePage() {
  const {user,loading}=useAuth(); const {text}=useLanguage(); const [epoch,setEpoch]=useState(0);
  return user ? <GenerationWorkspace key={`${user.openId}:${epoch}`} ownerId={user.openId} onReset={()=>{clearGenerationDraft(user.openId);setEpoch(v=>v+1);}}/> : <AppShell active="generate" status={{zh:"视频生成",en:"Video generation"}}><p>{loading?text("正在加载…","Loading…"):text("请先登录。","Please sign in.")}</p></AppShell>;
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export const draftKey = (owner: string, kind: string) => `meedoo:generation-draft:v1:${encodeURIComponent(owner)}:${kind}`;
export function clearGenerationDraft(owner: string) {
  for (const kind of ["video", "image"]) { try { localStorage.removeItem(draftKey(owner, kind)); } catch { /* Storage can be disabled. */ } }
}
export function useGenerationDraft<T>(owner: string, kind: string, value: T, restore: (value: unknown) => void) {
  const [ready,setReady]=useState(false), [unavailable,setUnavailable]=useState(false);
  const restoreRef=useRef(restore); restoreRef.current=restore;
  const key=draftKey(owner,kind);
  useEffect(()=>{
    try { const raw=localStorage.getItem(key); if(raw) { try { restoreRef.current(JSON.parse(raw)); } catch { localStorage.removeItem(key); } } }
    catch { setUnavailable(true); }
    setReady(true);
  },[key]);
  const save=useCallback((next:T)=>{try{localStorage.setItem(key,JSON.stringify(next));}catch{setUnavailable(true);}},[key]);
  const serialized=JSON.stringify(value);
  useEffect(()=>{if(ready) {try{localStorage.setItem(key,serialized);}catch{setUnavailable(true);}}},[key,ready,serialized]);
  return {ready,save,unavailable};
}

"use client";
import { useLanguage } from "./language-provider";
export type HistoryPagination = {page:number;pageSize:number;total:number;totalPages:number};
export function GenerationPagination({value,onChange,disabled=false}:{value:HistoryPagination;onChange:(page:number)=>void;disabled?:boolean}) {
 const {text}=useLanguage();
 return <nav className="generation-pagination" aria-label={text("记录分页","History pages")}>
  <span>{text(`共 ${value.total} 条 · 第 ${value.page} / ${value.totalPages} 页`,` ${value.total} records · Page ${value.page} / ${value.totalPages}`)}</span>
  <button type="button" disabled={disabled||value.page<=1} onClick={()=>onChange(value.page-1)}>{text("上一页","Previous")}</button>
  <button type="button" disabled={disabled||value.page>=value.totalPages} onClick={()=>onChange(value.page+1)}>{text("下一页","Next")}</button>
 </nav>;
}

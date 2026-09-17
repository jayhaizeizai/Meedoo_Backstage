"use client";
import {useEffect,useRef,useState} from "react";
import {AppShell} from "../../components/app-shell";
import {useAuth} from "../../components/auth-provider";
import {useLanguage} from "../../components/language-provider";
import {GenerationPagination,type HistoryPagination} from "../../components/generation-pagination";
import {generationModel} from "../../lib/generation-model";
import {seedanceErrorReason} from "../../lib/generation-error-reasons";
import "../../styles/generation.css";
type RecordItem={id:string;kind:"video"|"image";owner_name:string;model:string|null;input:{prompt:string;ratio:string;duration?:number;resolution?:string;quality?:string};status:string;created_at:string;usage:{total_tokens?:number}|null;expired:boolean;mediaUrl:string|null;error_code:string|null;provider_error:{code?:string;request_id?:string}|null};
export default function TeamGenerationHistory(){
 const {text,language}=useLanguage(),{role,loading:authLoading,user}=useAuth();
 const [page,setPage]=useState(1),[kind,setKind]=useState("all"),[loading,setLoading]=useState(false),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 const [tasks,setTasks]=useState<RecordItem[]>([]),[paging,setPaging]=useState<HistoryPagination>({page:1,pageSize:20,total:0,totalPages:1});
 const [detail,setDetail]=useState<RecordItem|null>(null),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(detail)dialog.current?.showModal();},[detail]);
 useEffect(()=>{if(!user||role!=="approver")return;const controller=new AbortController();setLoading(true);setError(false);
 void fetch(`/api/generation/team-history?page=${page}&kind=${kind}`,{cache:"no-store",signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(!controller.signal.aborted){setTasks(d.tasks);setPaging(d.pagination);}}).catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[page,kind,user,role,revision]);
 const status=(value:string)=>({succeeded:text("已生成","Generated"),failed:text("失败","Failed"),queued:text("排队中","Queued"),running:text("生成中","Generating"),preparing:text("准备中","Preparing"),submitting:text("提交中","Submitting"),submitted_unknown:text("结果待核对","Needs review"),cancelled:text("已取消","Cancelled")})[value]??value;
 const modelLabel=(t:RecordItem)=>t.kind==="image"?"Seedream 5.0 Pro":generationModel(t.model??undefined).label;
 return <AppShell active="generation-history" status={{zh:"团队生成记录",en:"Team generation history"}}>
 <section className="page generation-page">
 <header className="generation-header"><div><span className="eyebrow">TEAM · GENERATION HISTORY</span><h1>{text("团队生成记录","Team generation history")}</h1><p>{text("集中查看团队生成的视频与图片。文件保存 14 天，生成记录保留。","Browse team videos and images. Files are saved for 14 days; records remain.")}</p></div></header>
 {authLoading?<p>{text("正在加载…","Loading…")}</p>:role!=="approver"?<p>{text("仅审批人可查看团队生成记录。","Only approvers can view team generation history.")}</p>:<section className="card generation-history">
 <div className="team-generation-filters"><label>{text("内容类型","Content type")} <select aria-label={text("内容类型","Content type")} value={kind} onChange={e=>{setKind(e.target.value);setPage(1);}}><option value="all">{text("全部","All")}</option><option value="video">{text("视频","Video")}</option><option value="image">{text("图片","Image")}</option></select></label><button type="button" disabled={loading} onClick={()=>setRevision(v=>v+1)}>{text("刷新","Refresh")}</button></div>
 {error?<p role="alert">{text("读取失败，请重试。","Could not load history. Retry.")}<button onClick={()=>setRevision(v=>v+1)}>{text("重试","Retry")}</button></p>:loading?<p role="status">{text("正在加载…","Loading…")}</p>:<div className="generation-table-scroll"><table><thead><tr>{[text("类型","Type"),text("内容","Content"),text("模型","Model"),text("创建人","Creator"),text("时间","Created"),text("状态","Status"),"Token",text("操作","Actions")].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{tasks.map(t=><tr key={t.kind+t.id}><td>{t.kind==="video"?text("视频","Video"):text("图片","Image")}</td><td><button onClick={()=>setDetail(t)}>{t.input.prompt.slice(0,60)}{t.input.prompt.length>60?"…":""}</button></td><td>{modelLabel(t)}</td><td>{t.owner_name}</td><td>{new Date(t.created_at).toLocaleString(language==="zh"?"zh-CN":"en-US",{timeZone:"Asia/Singapore"})}</td><td>{status(t.status)}</td><td>{t.usage?.total_tokens?.toLocaleString()??"—"}</td><td><button onClick={()=>setDetail(t)}>{text("查看详情","Details")}</button>{t.mediaUrl?<a className="generation-record-download" href={`${t.mediaUrl}?download=1`}>{text("下载","Download")} ↓</a>:t.expired?<small>{text("文件已过期","File expired")}</small>:null}</td></tr>)}</tbody></table>{!tasks.length&&<p>{text("暂无生成记录。","No generation history yet.")}</p>}</div>}
 <GenerationPagination value={paging} onChange={setPage} disabled={loading||error}/>
 </section>}
 <dialog ref={dialog} className="generation-failure-dialog team-generation-preview" aria-labelledby="team-generation-detail-title" onClose={()=>setDetail(null)}>{detail&&<><h2 id="team-generation-detail-title">{text("生成详情","Generation details")}</h2><p>{detail.owner_name} · {modelLabel(detail)} · {status(detail.status)}</p>{detail.mediaUrl&&(detail.kind==="image"?<img src={detail.mediaUrl} alt={text("生成图片","Generated image")}/>:<video src={detail.mediaUrl} controls preload="metadata"/>)}<p>{detail.input.ratio} · {detail.input.quality??detail.input.resolution}{detail.input.duration?` · ${detail.input.duration}s`:""}</p><p className="team-generation-prompt">{detail.input.prompt}</p>{["failed","submitted_unknown"].includes(detail.status)&&<div role="status"><p>{detail.status==="submitted_unknown"?text("平台结果待核对，请勿直接重复生成。","Check the provider outcome before resubmitting."):text(...seedanceErrorReason(detail.provider_error?.code))}</p><p>{detail.provider_error?.code??detail.error_code}</p>{detail.provider_error?.request_id&&<p>{text("请求编号：","Request ID: ")}{detail.provider_error.request_id}</p>}</div>}{detail.expired&&<p>{text("文件已过期，记录仍保留。","File expired; the record remains.")}</p>}<form method="dialog"><button autoFocus>{text("关闭","Close")}</button></form></>}</dialog>
 </section></AppShell>;
}

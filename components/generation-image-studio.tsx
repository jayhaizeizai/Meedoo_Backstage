"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GenerationPagination, type HistoryPagination } from "./generation-pagination";
import { useGenerationDraft } from "./use-generation-draft";
import { imageDraft } from "../lib/generation-draft";
import { useLanguage } from "./language-provider";
import { generationRatios, type GenerationInput } from "../lib/generation-model";
import { seedreamModel, seedreamMaxReferences, seedreamQualities, type SeedreamQuality, type ImageDraft } from "../lib/seedream-model";
import { seedanceErrorReason } from "../lib/generation-error-reasons";

type Task = { id: string; input: { prompt: string; requestId: string; ratio: string; quality?: SeedreamQuality; baseAssetId: string | null }; status: string; asset: ImageDraft | null; expired: boolean; error_code?: string; provider_error?: {code?:string;request_id?:string}; };
export function GenerationImageStudio({ ownerId, onBusyChange, disabled, onUse, apiBase="/api/generation", readOnly=false, onSubmitted }: {
  apiBase?:string; readOnly?:boolean; onSubmitted?:()=>void; ownerId:string; onBusyChange:(busy:boolean)=>void;
  disabled: boolean;
  onUse: (asset: ImageDraft, role: GenerationInput["assets"][number]["role"]) => void;
}) {
  const {text} = useLanguage();
  const [prompt,setPrompt]=useState(""), [ratio,setRatio]=useState("9:16");
  const [quality,setQuality]=useState<SeedreamQuality>("2K");
  const [historyPage,setHistoryPage]=useState(1), [historyLoading,setHistoryLoading]=useState(false);
  const [paging,setPaging]=useState<HistoryPagination>({page:1,pageSize:12,total:0,totalPages:1});
  const [recentTasks,setRecentTasks]=useState<Task[]>([]);
  const historyRequest=useRef(0);
  const [uploads,setUploads]=useState<ImageDraft[]>([]);
  const [bases,setBases]=useState<ImageDraft[]>([]), [tasks,setTasks]=useState<Task[]>([]);
  const base=bases[0]??null;
  const [busy,setBusy]=useState(false), [uploading,setUploading]=useState(false), [configured,setConfigured]=useState(false);
  const [error,setError]=useState(""), [detail,setDetail]=useState<Task|null>(null);
  const pending=useRef(false), waiting=useRef<string|null>(null), intent=useRef<{id:string;fingerprint:string}|null>(null);
  const snapshot={prompt,ratio,quality,bases,waiting:waiting.current,intent:intent.current};
  const draft=useGenerationDraft(ownerId,"image",snapshot,(raw)=>{const d=imageDraft(raw);if(!d)return;setPrompt(d.prompt);setRatio(d.ratio);setQuality(d.quality);setBases(d.bases);waiting.current=d.waiting;intent.current=d.intent;
    if(d.bases.length)void fetch(`${apiBase}/assets/resolve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:d.bases.map((a:ImageDraft)=>a.id)})}).then(async r=>{if(!r.ok)return;const data=await r.json();setBases(current=>current.flatMap(a=>{if(!d.bases.some((old:ImageDraft)=>old.id===a.id))return [a];const found=data.assets.find((f:ImageDraft & {sourceId?:string})=>(f.sourceId??f.id)===a.id);return found?[found]:[];}));if(data.assets.length<d.bases.length)setError("INVALID_ASSETS");}).catch(()=>{});
  });
  useEffect(()=>{onBusyChange(busy||uploading);return()=>onBusyChange(false);},[busy,uploading,onBusyChange]);
  const load=useCallback(async()=>{
    const requestId=++historyRequest.current;setHistoryLoading(true);
    try {
    const r=await fetch(`${apiBase}/images?page=${historyPage}${waiting.current?`&tracked=${waiting.current}`:""}`,{cache:"no-store"});
    if(!r.ok) throw Error(r.status===401?"UNAUTHORIZED":"UNAVAILABLE");
    const d=await r.json(); if(requestId!==historyRequest.current)return;setPaging(d.pagination);setRecentTasks(d.recentTasks);setTasks(d.tasks); setUploads(d.uploads ?? []); setConfigured(d.configured);
    const finished=(d.recentTasks as Task[]).find(t=>t.id===waiting.current);
    if(finished?.status==="succeeded" && finished.asset){setBases([finished.asset]);setPrompt("");waiting.current=null;intent.current=null;}
    else if(finished && ["failed","submitted_unknown"].includes(finished.status)){setDetail(finished);waiting.current=null;}
    } finally {if(requestId===historyRequest.current)setHistoryLoading(false);}
  },[historyPage,apiBase]);
  const message=(code:string)=>code==="UNAUTHORIZED"?text("登录已过期，请重新登录。","Session expired. Sign in again."):
    code==="TOO_MANY_TASKS"?text("已有图片任务处理中，请等待完成。","Image tasks are already processing. Please wait."):
    code==="TOO_MANY_REFERENCES"?text("最多添加 10 张参考图。","Add up to 10 reference images."):
    code==="INVALID_IMAGE"?text("请选择有效图片，大小不超过 30 MB。","Choose a valid image up to 30 MB."):
    code==="INVALID_ASSETS"?text("原图已过期或不可用，请重新上传。","The source image expired or is unavailable. Upload it again."):
    code==="NOT_CONFIGURED"?text("生图服务尚未配置，请联系管理员。","Image generation is not configured. Contact an administrator."):
    text("暂时无法读取或提交，请刷新后重试。","Unable to load or submit. Refresh and retry.");
  useEffect(()=>{void load().catch(()=>setError("UNAVAILABLE"));},[load]);
  useEffect(()=>{let checking=false;const timer=setInterval(()=>{if(checking||document.hidden)return;checking=true;void load().catch(()=>setError("UNAVAILABLE")).finally(()=>{checking=false;});},5000);return()=>clearInterval(timer);},[load]);
  function selectImage(asset:ImageDraft){waiting.current=null;setBases([asset]);setPrompt("");setDetail(null);setError("");}
  function addReference(asset:ImageDraft) {
    if (busy||uploading||pending.current) return;
    if(bases.some(a=>a.id===asset.id))return;
    if(bases.length>=seedreamMaxReferences){setError("TOO_MANY_REFERENCES");return;}
    waiting.current=null;setBases(current=>[...current,asset]);setError("");
  }
  async function upload(files:File[]){
    if(!files.length||pending.current||uploading)return;
    if(bases.length+files.length>seedreamMaxReferences){setError("TOO_MANY_REFERENCES");return;}
    setUploading(true);setError("");waiting.current=null;
    try{for(const file of files){if(file.size>30*1024*1024)throw Error("INVALID_IMAGE");const form=new FormData();form.set("file",file);
      const r=await fetch("/api/generation/assets",{method:"POST",body:form});const d=await r.json();if(!r.ok)throw Error(d.code);setBases(current=>[...current,d.asset]);}await load();
    }catch(e){setError(e instanceof Error?e.message:"UNAVAILABLE");}finally{setUploading(false);}
  }
  async function submit(){
    if(readOnly||pending.current||uploading||!prompt.trim())return;pending.current=true;setBusy(true);setError("");setDetail(null);
    const params={prompt:prompt.trim(),ratio,quality,baseAssetIds:bases.map(a=>a.id),baseAssetId:base?.id??null}, fingerprint=JSON.stringify(params);
    const previous=recentTasks.find(t=>t.input.requestId===intent.current?.id);
    if(!intent.current||intent.current.fingerprint!==fingerprint||previous?.status==="failed")intent.current={id:crypto.randomUUID(),fingerprint};
    draft.save({...snapshot,intent:intent.current});
    try{const r=await fetch(`${apiBase}/images`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...params,requestId:intent.current.id})});const d=await r.json();if(!r.ok)throw Error(d.code);waiting.current=d.id;onSubmitted?.();draft.save({...snapshot,waiting:d.id,intent:intent.current});await load();}
    catch(e){setError(e instanceof Error?e.message:"UNAVAILABLE");}finally{pending.current=false;setBusy(false);}
  }
  const active=recentTasks.some(t=>["queued","running"].includes(t.status));
  return <section className="card generation-form image-studio" aria-label={text("图片工作台","Image studio")}>
    <div className="image-studio-heading"><div><small>IMAGE STUDIO</small><h2>{text("生成参考图","Create an image")}</h2></div><span className="generation-badge">{seedreamModel.label} · {quality}</span></div>
    <p className="generation-help">{text("先生成图片，再逐步修改；满意后用作视频素材。每次修改保留为新版本。","Generate, refine, then use the image in your video. Each edit saves a new version.")}</p>
    {base ? <div className="image-studio-preview"><img src={base.url} alt={text("当前编辑图片","Current editing image")}/><div className="image-studio-actions">
      <a href={`${base.url}?download=1`}>{text("下载图片","Download")}</a>
      <button type="button" disabled={readOnly||busy||uploading||active} onClick={()=>{waiting.current=null;setBases([]);setPrompt("");}}>{text("重新文生图","Start from text")}</button>
    </div></div> : <div className="image-studio-empty">{text("描述一张新图，或上传图片开始修改","Describe a new image, or upload one to edit")}</div>}
    <div className="image-reference-heading"><strong>{text("生图参考图", "Image references")} · {bases.length} / {seedreamMaxReferences}</strong><small>{text("可组合人物、产品、场景和风格。点击图片编号插入提示词。", "Combine subjects, products, scenes and styles. Click a number to reference it in your prompt.")}</small></div>
    {!!bases.length&&<div className="image-reference-grid">{bases.map((asset,index)=><div key={asset.id}>
      <img src={asset.url} alt={`${text("图片", "Image ")}${index+1}: ${asset.name}`}/>
      <button type="button" disabled={readOnly||busy||active||uploading} onClick={()=>setPrompt(p=>`${p} ${text("图片", "image ")}${index+1} `)}>{text("图片", "Image ")}{index+1}</button>
      <button type="button" className="image-reference-remove" disabled={readOnly||busy||active||uploading} aria-label={`${text("移除图片", "Remove image ")}${index+1}`} onClick={()=>{waiting.current=null;setBases(current=>current.filter(a=>a.id!==asset.id));}}>×</button>
    </div>)}</div>}
    <label className="image-studio-upload">{uploading?text("上传中…","Uploading…"):text("添加参考图（可多选）","Add references (select multiple)")}<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={readOnly||uploading||busy||active||bases.length>=seedreamMaxReferences} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value="";void upload(files);}}/></label>
    {!!uploads.length&&<label>{text("从历史上传添加参考图","Add from upload history")}<select value="" disabled={readOnly||busy||uploading||active||bases.length>=seedreamMaxReferences} onChange={e=>{const asset=uploads.find(a=>a.id===e.target.value);if(asset)addReference(asset);}}><option value="">{text("选择图片…","Select image…")}</option>{uploads.filter(a=>!bases.some(b=>b.id===a.id)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    <label>{base?text("修改要求","Edit instructions"):text("图片描述","Image prompt")}<textarea rows={4} maxLength={4000} value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={busy||active} placeholder={base?text("例如：保留人物和服装，把背景改为夜晚街道","Keep the character and clothing; change the background to a street at night"):text("描述人物、场景、构图和风格…","Describe the subject, scene, composition and style…")}/></label>
    <label>{text("图片比例","Aspect ratio")}<select value={ratio} disabled={busy||active} onChange={e=>setRatio(e.target.value)}>{generationRatios.map(r=><option key={r}>{r}</option>)}</select></label>
    <label>{text("图片质量", "Image quality")}<select value={quality} disabled={busy||active} onChange={e=>setQuality(e.target.value as SeedreamQuality)}>{seedreamQualities.map(q=><option key={q} value={q}>{q}{q==="2K"?text("（默认）"," (default)"):""}</option>)}</select></label>
    {draft.unavailable&&<p className="data-message">{text("浏览器存储不可用，图片草稿可能无法保留。","Browser storage is unavailable; image drafts may not be saved.")}</p>}
    {error&&<p className="data-message" role="alert">{message(error)}</p>}
    <button type="button" className="primary generation-submit" disabled={readOnly||!configured||busy||uploading||active||!prompt.trim()} onClick={()=>void submit()}>{busy?text("提交中…","Submitting…"):active?text("正在生成图片…","Generating image…"):bases.length>1?text("多参考图生成","Generate from references"):base?text("生成修改版本","Generate edited version"):text("生成图片","Generate image")}</button>
    {active&&<small>{text("任务已保存，关闭页面后仍会继续处理。","Your task is saved and will continue if you close this page.")}</small>}
    {base&&<div className="image-studio-actions" aria-label={text("用于视频","Use in video")}>
      {(["first_frame","last_frame","reference_image"] as const).map(role=><button type="button" key={role} disabled={readOnly||disabled||uploading} onClick={()=>onUse(base,role)}>{role==="first_frame"?text("用作首帧","Use as first frame"):role==="last_frame"?text("用作尾帧","Use as last frame"):text("用作参考图","Use as reference")}</button>)}
    </div>}
    {detail&&<div className="data-message" role="status"><strong>{text("图片生成未完成","Image generation incomplete")}</strong><p>{detail.status==="submitted_unknown"?text("平台结果不确定，请联系管理员核对后再生成，避免重复计费。","Provider outcome is uncertain. Ask an administrator to check before generating again."):detail.error_code==="IMAGE_SAVE_FAILED"?text("图片结果保存失败，请联系管理员。","Saving the image failed. Contact an administrator."):text(...seedanceErrorReason(detail.provider_error?.code))}</p><small>{detail.provider_error?.code||detail.error_code}</small>{detail.provider_error?.request_id&&<p>{text("请求编号：","Request ID: ")}{detail.provider_error.request_id}</p>}</div>}
    {!!tasks.length&&<div className="image-studio-history"><h3>{apiBase!=="/api/generation" ? text("当前分镜图片版本","Shot image versions") : text("我的图片版本","My image versions")}</h3><p className="generation-help">{text("图片保存 14 天，请及时下载。","Images are saved for 14 days. Download them in time.")}</p><div className="image-studio-grid">{tasks.map(t=><button type="button" key={t.id} disabled={readOnly||busy||uploading||active} className={t.asset && base?.id===t.asset.id?"selected":""} onClick={()=>{if(t.asset){selectImage(t.asset);setRatio(t.input.ratio);setQuality(t.input.quality ?? "2K");}else if(["failed","submitted_unknown"].includes(t.status)) setDetail(t);}}>
      {t.asset?<img loading="lazy" src={t.asset.url} alt={t.input.prompt}/>:<span>{t.expired?text("已过期","Expired"):t.status==="failed"?text("失败 · 查看原因","Failed · details"):t.status==="submitted_unknown"?text("结果待核对","Needs review"):text("生成中…","Generating…")}</span>}<small>{t.input.prompt}</small>
    </button>)}</div><GenerationPagination value={paging} disabled={historyLoading} onChange={setHistoryPage}/></div>}
  </section>;
}

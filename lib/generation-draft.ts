import { generationModels, generationModel, generationRatios, uuidPattern } from "./generation-model";
import { seedreamQualities } from "./seedream-model";
export function draftAsset(v: any) {
  return v && typeof v.id === "string" && uuidPattern.test(v.id) ? {id:v.id,name:typeof v.name === "string" ? v.name.slice(0,180) : "Image",url:`/api/generation/assets/${v.id}`} : null;
}
export function draftIntent(v: any) {
  return v && typeof v.id === "string" && uuidPattern.test(v.id) && typeof v.fingerprint === "string" && v.fingerprint.length<50000 ? {id:v.id,fingerprint:v.fingerprint} : null;
}
export function videoDraft(v: any) {
  if(!v || !Object.hasOwn(generationModels,v.model))return null;
  const model=generationModel(v.model);
  return {...v, prompt:typeof v.prompt === "string" ? v.prompt.slice(0,14000) : "", mode:v.mode === "frames" ? "frames" : "reference",
    duration:Number.isInteger(v.duration) ? Math.max(model.minDuration,Math.min(model.maxDuration,v.duration)) : 6,
    ratio:(generationRatios as readonly string[]).includes(v.ratio) ? v.ratio : "9:16",
    resolution:(model.resolutions as readonly string[]).includes(v.resolution) ? v.resolution : model.resolutions[0],
    generateAudio:v.generateAudio !== false, rightTab:v.rightTab === "video" ? "video" : "image",
    selected:typeof v.selected === "string" && uuidPattern.test(v.selected) ? v.selected : null,
    assets:Array.isArray(v.assets) ? v.assets.slice(0,30).flatMap((a:any)=>{const item=draftAsset(a);return item && ["first_frame","last_frame","reference_image"].includes(a.role)?[{...item,role:a.role}]:[];}) : [],intent:draftIntent(v.intent)};
}
export function imageDraft(v:any) {
  if(!v || typeof v !== "object") return null;
  return {prompt:typeof v.prompt === "string" ? v.prompt.slice(0,4000) : "",base:draftAsset(v.base),
    ratio:(generationRatios as readonly string[]).includes(v.ratio)?v.ratio:"9:16",
    quality:(seedreamQualities as readonly string[]).includes(v.quality)?v.quality:"2K",intent:draftIntent(v.intent),
    waiting:typeof v.waiting === "string" && uuidPattern.test(v.waiting)?v.waiting:null};
}

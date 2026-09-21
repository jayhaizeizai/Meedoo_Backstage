"use client";
import { useId, useState } from "react";
import { platformMeta, type SocialPlatform } from "../lib/social-platforms";
export type PlatformDay = {day:string;platforms:{platform:SocialPlatform;value:number|null}[]};
export function PlatformDailyChart({rows,platforms,language}:{rows:PlatformDay[];platforms:SocialPlatform[];language:"zh"|"en"}) {
  const id=useId(),[hovered,setHovered]=useState<string|null>(null),[position,setPosition]=useState({left:0,top:0});
  const t=(zh:string,en:string)=>language==="zh"?zh:en;
  const full=new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{maximumFractionDigits:2});
  const compact=new Intl.NumberFormat(language==="zh"?"zh-CN":"en-US",{notation:"compact",maximumFractionDigits:1});
  const data=rows.map(row=>{const values=platforms.map(platform=>({platform,value:row.platforms.find(p=>p.platform===platform)?.value??null}));const known=values.filter(p=>p.value!==null);return {...row,platforms:values,total:known.length?known.reduce((sum,p)=>sum+p.value!,0):null,partial:known.length<values.length};});
  const maximum=Math.max(1,...data.map(row=>row.platforms.reduce((sum,p)=>sum+Math.max(0,p.value??0),0)));
  const active=data.find(row=>row.day===hovered);
  function show(day:string,x:number,y:number){setHovered(day);setPosition({left:Math.max(8,Math.min(x+12,window.innerWidth-276)),top:Math.max(8,Math.min(y+12,window.innerHeight-260))});}
  return <>
    <div className="follower-legend">{platforms.map(p=><span key={p}><i style={{background:platformMeta[p].color}}/>{platformMeta[p].name}</span>)}</div>
    {active&&<div className="follower-tooltip" role="tooltip" id={id} style={position}><b>{active.day}</b>{active.platforms.map(p=><span key={p.platform}><i style={{background:platformMeta[p.platform].color}}/>{platformMeta[p.platform].name}<strong>{p.value===null?t("暂无数据","No data"):full.format(p.value)}</strong></span>)}<b>{active.partial?t("已知合计","Available total"):t("合计","Total")}: {active.total===null?"—":full.format(active.total)}</b></div>}
    <div className="account-followers-chart compact-platform-chart" onMouseLeave={()=>setHovered(null)} onScroll={()=>setHovered(null)}>
      {data.map(row=><button type="button" className="account-followers-column" key={row.day} onMouseMove={e=>show(row.day,e.clientX,e.clientY)} onFocus={e=>{const rect=e.currentTarget.getBoundingClientRect();show(row.day,rect.left,rect.top);}} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();show(row.day,rect.left,rect.top);}} onBlur={()=>setHovered(null)} onKeyDown={e=>{if(e.key==="Escape")setHovered(null);}} aria-describedby={hovered===row.day?id:undefined} aria-label={`${row.day}: ${row.platforms.map(p=>`${platformMeta[p.platform].name} ${p.value===null?t("暂无数据","No data"):full.format(p.value)}`).join(", ")}`}>
        <div className="account-followers-track" aria-hidden="true">{row.platforms.map(p=><div key={p.platform} style={{height:`${Math.max(0,p.value??0)/maximum*100}%`,background:platformMeta[p.platform].color}}/>)}</div>
        <span>{row.day.slice(5)}</span><strong>{row.total===null?"—":compact.format(row.total)}</strong>
      </button>)}
    </div>
  </>;
}

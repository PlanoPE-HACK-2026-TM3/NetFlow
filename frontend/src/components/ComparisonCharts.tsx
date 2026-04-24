"use client";
import type { Property } from "@/lib/types";

interface Props {
  properties: Property[];
  compact?: boolean;
}

function ChartCard({title,sub,icon,children}:{title:string;sub:string;icon:string;children:React.ReactNode}){
  return(
    <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(139,92,246,0.12)",borderRadius:"14px",padding:"18px 20px",boxShadow:"0 1px 8px rgba(0,0,0,0.2)"}}>
      <div style={{marginBottom:"14px"}}>
        <div style={{fontSize:"14px",fontWeight:700,color:"#f1f5f9",display:"flex",alignItems:"center",gap:"6px"}}><span>{icon}</span>{title}</div>
        <div style={{fontSize:"11px",color:"#475569",marginTop:"2px"}}>{sub}</div>
      </div>
      {children}
    </div>
  );
}

function HBar({data,color,unit,max:pm}:{data:{label:string;value:number;rank:number}[];color:(v:number)=>string;unit:string;max?:number}){
  const mv=pm??Math.max(...data.map(d=>Math.abs(d.value)),1);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
      {data.map(d=>{
        const pct=Math.max(0,(Math.abs(d.value)/mv)*100);
        const c=color(d.value);
        return(
          <div key={d.label} style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <div style={{width:"20px",height:"20px",borderRadius:"50%",background:d.rank<=2?"linear-gradient(135deg,#7c3aed,#8b5cf6)":"rgba(255,255,255,0.06)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",fontWeight:800,color:d.rank<=2?"#fff":"#64748b",flexShrink:0}}>{d.rank}</div>
            <div style={{width:"112px",fontSize:"11px",color:"#94a3b8",fontWeight:500,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.label}</div>
            <div style={{flex:1,height:"16px",background:"rgba(255,255,255,0.04)",borderRadius:"4px",overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct}%`,background:c,borderRadius:"4px",transition:"width 0.9s ease",opacity:0.85}}/>
            </div>
            <div style={{width:"68px",textAlign:"right",fontSize:"11px",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:c,flexShrink:0}}>
              {unit==="$"?`$${d.value.toLocaleString()}`:unit==="%"?`${d.value}%`:`${d.value}${unit}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Scatter({properties}:{properties:Property[]}){
  const W=420,H=220,P={t:12,r:12,b:36,l:48};
  const iW=W-P.l-P.r, iH=H-P.t-P.b;
  const xs=properties.map(p=>p.cap_rate), ys=properties.map(p=>p.cash_flow);
  const minX=Math.min(...xs)-0.3, maxX=Math.max(...xs)+0.3;
  const minY=Math.min(...ys)-80, maxY=Math.max(...ys)+80;
  const px=(v:number)=>P.l+((v-minX)/(maxX-minX))*iW;
  const py=(v:number)=>P.t+(1-(v-minY)/(maxY-minY))*iH;
  const dc=(p:Property)=>p.cash_flow>300?"#10b981":p.cash_flow>0?"#f59e0b":"#ef4444";
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      {[0,1,2,3].map(i=>{const v=minY+i*(maxY-minY)/3;const y=py(v);return(<g key={i}><line x1={P.l} y1={y} x2={W-P.r} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1}/><text x={P.l-4} y={y+4} textAnchor="end" fontSize={9} fill="#475569">{v>=0?`$${Math.round(v)}`:'-$'+Math.abs(Math.round(v))}</text></g>);})}
      {minY<0&&<line x1={P.l} y1={py(0)} x2={W-P.r} y2={py(0)} stroke="rgba(255,255,255,0.1)" strokeWidth={1} strokeDasharray="3 3"/>}
      <text x={W/2} y={H-4} textAnchor="middle" fontSize={10} fill="#475569" fontWeight={600}>Cap Rate (%)</text>
      {properties.map(p=>(
        <g key={p.address}>
          <circle cx={px(p.cap_rate)} cy={py(p.cash_flow)} r={p.rank<=2?9:7} fill={dc(p)} opacity={0.8} stroke="rgba(255,255,255,0.15)" strokeWidth={1.5}/>
          <text x={px(p.cap_rate)} y={py(p.cash_flow)-12} textAnchor="middle" fontSize={9} fill="#94a3b8" fontWeight={700}>#{p.rank}</text>
        </g>
      ))}
    </svg>
  );
}

function ScoreGauges({properties}:{properties:Property[]}){
  return(
    <div style={{display:"flex",flexWrap:"wrap",gap:"12px",justifyContent:"center"}}>
      {properties.slice(0,5).map(p=>{
        const r=28, circ=2*Math.PI*r, fill=(p.ai_score/100)*circ;
        const c=p.ai_score>=75?"#10b981":p.ai_score>=55?"#8b5cf6":"#f59e0b";
        const icon=p.ai_score>=85?"🏆":p.ai_score>=70?"⭐":p.ai_score>=55?"✅":"⚠️";
        return(
          <div key={p.address} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"5px",minWidth:"72px"}}>
            <svg width="68" height="68" viewBox="0 0 68 68">
              <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5}/>
              <circle cx="34" cy="34" r={r} fill="none" stroke={c} strokeWidth={5} strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" transform="rotate(-90 34 34)" style={{transition:"stroke-dasharray 0.9s ease"}}/>
              <text x="34" y="30" textAnchor="middle" fontSize={14}>{icon}</text>
              <text x="34" y="46" textAnchor="middle" fontSize={11} fontWeight={800} fill={c}>{p.ai_score}</text>
            </svg>
            <div style={{fontSize:"10px",fontWeight:600,color:"#94a3b8",textAlign:"center",maxWidth:"72px",lineHeight:1.3}}>#{p.rank} {p.address.split(" ").slice(0,2).join(" ")}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function ComparisonCharts({properties}:Props){
  if(!properties?.length) return null;
  const top=properties.slice(0,10);
  const crC=(v:number)=>v>=6?"#10b981":v>=4.5?"#f59e0b":"#8b5cf6";
  const cfC=(v:number)=>v>300?"#10b981":v>0?"#f59e0b":"#ef4444";
  const grC=(v:number)=>v<100?"#10b981":v<130?"#f59e0b":"#ef4444";
  return(
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
        <ChartCard icon="📈" title="Cap Rate Comparison" sub="Net cap rate after 35% expenses">
          <HBar data={top.map(p=>({label:`#${p.rank} ${p.address.split(" ").slice(0,2).join(" ")}`,value:p.cap_rate,rank:p.rank}))} color={crC} unit="%" max={10}/>
        </ChartCard>
        <ChartCard icon="💰" title="Monthly Cash Flow" sub="After PITI + 35% operating expenses">
          <HBar data={top.map(p=>({label:`#${p.rank} ${p.address.split(" ").slice(0,2).join(" ")}`,value:p.cash_flow,rank:p.rank}))} color={cfC} unit="$"/>
        </ChartCard>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:"14px"}}>
        <ChartCard icon="🎯" title="Cap Rate vs Cash Flow" sub="Each dot = 1 property · color = cash flow health">
          <Scatter properties={top}/>
        </ChartCard>
        <ChartCard icon="🏆" title="AI Score — Top 5" sub="NetFlow investment score out of 100">
          <ScoreGauges properties={top}/>
        </ChartCard>
      </div>
      <ChartCard icon="📊" title="Gross Rent Multiplier" sub="Lower = better value · Target below 130x">
        <HBar data={top.map(p=>({label:`#${p.rank} ${p.address.split(" ").slice(0,2).join(" ")}`,value:p.grm,rank:p.rank}))} color={grC} unit="x" max={200}/>
      </ChartCard>
    </div>
  );
}

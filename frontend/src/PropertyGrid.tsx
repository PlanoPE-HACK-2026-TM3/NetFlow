"use client";
import { useState, useRef } from "react";
import { log } from "@/lib/logger";
import type { Property } from "@/lib/types";

interface Props {
  properties: Property[];
  onSelectProperty: (p: Property) => void;
  selectedProperty: Property | null;
}

// ── Score metadata ─────────────────────────────────────────────
function scoreInfo(s: number) {
  if (s >= 85) return { icon:"🏆", label:"Excellent", color:"var(--grn)",    bg:"rgba(34,197,94,0.12)",   bd:"rgba(34,197,94,0.35)"   };
  if (s >= 70) return { icon:"⭐", label:"Strong",    color:"var(--pri-hi)", bg:"rgba(79,158,255,0.12)",  bd:"rgba(79,158,255,0.35)"  };
  if (s >= 55) return { icon:"✅", label:"Good",      color:"var(--cyn)",    bg:"rgba(6,182,212,0.12)",   bd:"rgba(6,182,212,0.32)"   };
  if (s >= 40) return { icon:"⚠️", label:"Fair",      color:"var(--amb)",    bg:"rgba(245,158,11,0.12)",  bd:"rgba(245,158,11,0.32)"  };
  return             { icon:"❌", label:"Weak",       color:"var(--red)",    bg:"rgba(244,63,94,0.12)",   bd:"rgba(244,63,94,0.32)"   };
}

// Note colour class cycles by rank
const NOTE_CLS  = ["note-v","note-g","note-a","note-c","note-p"];
const NOTE_TOPS = ["var(--n1-tp)","var(--n2-tp)","var(--n3-tp)","var(--n4-tp)","var(--n5-tp)"];
const NOTE_GRADS = [
  "linear-gradient(135deg,#4f9eff,#1d4ed8)",
  "linear-gradient(135deg,#10b981,#059669)",
  "linear-gradient(135deg,#f59e0b,#d97706)",
  "linear-gradient(135deg,#f43f5e,#c0273e)",
  "linear-gradient(135deg,#a78bfa,#6d28d9)",
];

const cfColor  = (v:number) => v>300?"var(--grn)":v>0?"var(--amb)":"var(--red)";
const capColor = (v:number) => v>=6?"var(--grn)":v>=4.5?"var(--amb)":"var(--pri-hi)";
const domIcon  = (d:number) => d<14?"🔥":d<30?"⏱️":"🐌";
const cfIcon   = (v:number) => v>400?"💎":v>200?"💚":v>0?"🟡":"🔴";
const capIcon  = (v:number) => v>=6?"🚀":v>=4.5?"📈":"📉";

function tagStyle(t:string):React.CSSProperties {
  if (t.includes("Pick")||t.includes("🏆"))  return {background:"rgba(79,158,255,.15)",border:"1px solid rgba(79,158,255,.35)",color:"var(--pri-hi)"};
  if (t.includes("Hot")||t.includes("🔥"))   return {background:"rgba(251,146,60,.14)",border:"1px solid rgba(251,146,60,.35)",color:"var(--amb)"};
  if (t.includes("Cash+"))                   return {background:"rgba(34,197,94,.13)",border:"1px solid rgba(34,197,94,.32)",color:"var(--grn)"};
  return {background:"rgba(100,120,160,.08)",border:"1px solid var(--bd)",color:"var(--t3)"};
}

// ── Tooltip with keyboard focus + click toggle ─────────────────
function Tip({ children, text, right=false }:{ children:React.ReactNode; text:string; right?:boolean }) {
  const [open,setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`tip-wrap${right?" tip-right":""}${open?" tip-open":""}`}
      tabIndex={0}
      onClick={()=>setOpen(v=>!v)}
      onBlur={()=>setOpen(false)}
      onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setOpen(v=>!v);}if(e.key==="Escape")setOpen(false);}}
      role="button"
      aria-haspopup="true"
      aria-expanded={open}
    >
      {children}
      <div className="tip-box" role="tooltip">{text}</div>
    </div>
  );
}

// ── SVG score ring ─────────────────────────────────────────────
function ScoreRing({ score }:{ score:number }) {
  const { icon, label, color, bg, bd } = scoreInfo(score);
  const R=20, C=2*Math.PI*R, fill=(score/100)*C;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px"}}>
      <div style={{position:"relative",width:"46px",height:"46px"}}>
        <svg width="46" height="46" viewBox="0 0 50 50" style={{transform:"rotate(-90deg)"}}>
          <circle cx="25" cy="25" r={R} fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth={5}/>
          <circle cx="25" cy="25" r={R} fill="none" stroke={color} strokeWidth={5}
            strokeDasharray={`${fill.toFixed(1)} ${C.toFixed(1)}`} strokeLinecap="round"
            style={{transition:"stroke-dasharray .9s ease"}}/>
        </svg>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1px"}}>
          <span style={{fontSize:"12px",lineHeight:1}}>{icon}</span>
          <span style={{fontSize:"9px",fontWeight:800,color,fontFamily:"'JetBrains Mono',monospace",lineHeight:1}}>{score}</span>
        </div>
      </div>
      <div style={{padding:"2px 7px",borderRadius:"8px",background:bg,border:`1px solid ${bd}`,fontSize:"9px",fontWeight:700,color,whiteSpace:"nowrap"}}>{label}</div>
    </div>
  );
}

// ── Map embed ──────────────────────────────────────────────────
function MapEmbed({ address, zip }:{ address:string; zip:string }) {
  const q = encodeURIComponent(`${address}, ${zip}`);
  return (
    <div style={{borderRadius:"8px",overflow:"hidden",border:"1px solid var(--bd-hi)",marginTop:"10px"}}>
      <div style={{padding:"5px 10px",background:"rgba(79,158,255,0.08)",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:"11px",fontWeight:600,color:"var(--pri-hi)"}}>📍 Google Maps</span>
        <a href={`https://maps.google.com/?q=${q}`} target="_blank" rel="noopener noreferrer" style={{fontSize:"10px",color:"var(--t3)",textDecoration:"none"}}>Open ↗</a>
      </div>
      <iframe src={`https://maps.google.com/maps?q=${q}&output=embed&zoom=15`} width="100%" height="185" style={{border:"none",display:"block"}} loading="lazy" referrerPolicy="no-referrer-when-downgrade" title={`Map: ${address}`}/>
    </div>
  );
}

// ── MLS details panel ──────────────────────────────────────────
function MLSPanel({ p }:{ p:Property }) {
  return (
    <div style={{marginTop:"10px",padding:"12px 13px",borderRadius:"9px",background:"var(--bg-raise)",border:"1px solid var(--bd)"}}>
      <div style={{fontSize:"11px",fontWeight:700,color:"var(--pri-hi)",marginBottom:"8px"}}>📋 MLS Listing Details</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px",marginBottom:"10px"}}>
        {[
          ["🏷️","MLS ID",     p.mls_id||"N/A"],
          ["📅","Days Listed",`${p.dom}d`],
          ["🏗️","Year Built", p.year_built?String(p.year_built):"N/A"],
          ["📐","Lot",        p.lot_size?`${p.lot_size.toLocaleString()} sqft`:"N/A"],
          ["🏠","Living Area",`${p.sqft?.toLocaleString()||"N/A"} sqft`],
          ["🛏️","Bed/Bath",  `${p.beds}bd / ${p.baths}ba`],
        ].map(([ic,lbl,val])=>(
          <div key={String(lbl)}>
            <div style={{fontSize:"10px",color:"var(--t3)",fontWeight:500}}>{ic} {lbl}</div>
            <div style={{fontSize:"12px",fontWeight:600,color:"var(--t2)",fontFamily:"'JetBrains Mono',monospace"}}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
        {[
          ["🔗 Zillow",  `https://www.zillow.com/homes/${encodeURIComponent(p.address+" "+p.zip_code)}`],
          ["🔗 Redfin",  `https://www.redfin.com/zipcode/${p.zip_code}`],
          ["🔗 Realtor", `https://www.realtor.com/realestateandhomes-search/${p.zip_code}`],
        ].map(([lbl,url])=>(
          <a key={String(lbl)} href={String(url)} target="_blank" rel="noopener noreferrer"
            style={{padding:"4px 9px",borderRadius:"6px",fontSize:"11px",fontWeight:600,background:"rgba(79,158,255,.12)",border:"1px solid var(--bd-hi)",color:"var(--pri-hi)",textDecoration:"none"}}>
            {lbl}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Score bar + label ──────────────────────────────────────────
function ScoreBar({ score, color }:{ score:number; color:string }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
      <div className="hscore-bar">
        <div className="hscore-fill score-bar-fill" style={{width:`${score}%`,background:`linear-gradient(90deg,var(--pri),${color})`}}/>
      </div>
      <span style={{fontSize:"10px",fontWeight:700,color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace",whiteSpace:"nowrap"}}>{score}/100</span>
    </div>
  );
}

// ── Single property card ───────────────────────────────────────
function PropertyCard({ p, onSelect, selected }:{ p:Property; onSelect:()=>void; selected:boolean }) {
  const [showMap, setShowMap] = useState(false);
  const [showMLS, setShowMLS] = useState(false);
  const ci       = (p.rank-1) % 5;
  const noteClass= NOTE_CLS[ci];
  const topColor = NOTE_TOPS[ci];
  const { color:scoreCol } = scoreInfo(p.ai_score);
  const cfC = cfColor(p.cash_flow);
  const crC = capColor(p.cap_rate);
  const isRight = (p.rank % 5) >= 3; // cols 4,5 → tooltip opens left

  return (
    <div
      className={`sticky ${noteClass} note-in${selected?" sel":""}`}
      style={{ animationDelay:`${(p.rank-1)*0.045}s` }}
      onClick={()=>{ onSelect(); log.ui("Property card selected",{rank:p.rank,address:p.address}); }}
    >
      {/* Coloured top strip */}
      <div className={`sticky-top ${noteClass}`}/>

      <div style={{padding:"16px 15px 12px"}}>

        {/* ── Row 1: Rank badge · Address · Price ── */}
        <div style={{display:"flex",alignItems:"flex-start",gap:"7px",marginBottom:"8px"}}>
          <div style={{width:"28px",height:"28px",borderRadius:"50%",flexShrink:0,
            background:p.rank<=3?`linear-gradient(135deg,${topColor},${topColor}bb)`:"var(--bg-raise)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:"10px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",
            color:p.rank<=3?"#fff":"var(--t3)",
            boxShadow:p.rank<=3?`0 2px 8px ${topColor}55`:"none",
            flexShrink:0}}>
            {p.rank}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:"13px",fontWeight:700,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.address}</div>
            <div style={{fontSize:"9px",color:"var(--t3)",marginTop:"1px",display:"flex",gap:"5px",flexWrap:"wrap",fontFamily:"'JetBrains Mono',monospace"}}>
              <span>📍 {p.zip_code}</span>
              <span>🛏️ {p.beds}bd/{p.baths}ba</span>
              <span>{domIcon(p.dom)} {p.dom}d</span>
            </div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:"15px",fontWeight:800,color:"var(--pri-hi)",fontFamily:"'JetBrains Mono',monospace"}}>${(p.price/1000).toFixed(0)}k</div>
            <div style={{fontSize:"9px",color:"var(--t3)"}}>${p.est_rent.toLocaleString()}/mo</div>
          </div>
        </div>

        {/* ── Row 2: 3 metric tooltips + score ring ── */}
        <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"8px"}}>
          <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px"}}>

            {/* Cap Rate */}
            <Tip right={isRight} text="Cap Rate = NOI ÷ Price × 100. NOI = Rent × 12 × 0.65 (35% expenses deducted). Measures unleveraged return. Target ≥ 6% for strong investment.">
              <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                <div style={{fontSize:"11px",fontWeight:700,color:"var(--t3)",display:"flex",alignItems:"center",gap:"2px"}}>
                  {capIcon(p.cap_rate)} Cap
                  <span style={{fontSize:"8px",color:"var(--pri-hi)",lineHeight:1}}>ℹ</span>
                </div>
                <div style={{fontSize:"15px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:crC}}>{p.cap_rate}%</div>
              </div>
            </Tip>

            {/* Cash Flow */}
            <Tip text="Cash Flow = Rent − PITI − Operating Expenses (35% of rent). PITI = Principal, Interest, Tax, Insurance. Positive = property covers all costs and profits monthly.">
              <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                <div style={{fontSize:"11px",fontWeight:700,color:"var(--t3)",display:"flex",alignItems:"center",gap:"2px"}}>
                  {cfIcon(p.cash_flow)} CF
                  <span style={{fontSize:"8px",color:"var(--pri-hi)",lineHeight:1}}>ℹ</span>
                </div>
                <div style={{fontSize:"15px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:cfC}}>${p.cash_flow}/mo</div>
              </div>
            </Tip>

            {/* GRM */}
            <Tip right text="GRM = Price ÷ Annual Rent. Lower = better value. Under 100× excellent, 100–130× good, 130–160× fair, above 160× overpriced. Quick market comparison tool.">
              <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                <div style={{fontSize:"11px",fontWeight:700,color:"var(--t3)",display:"flex",alignItems:"center",gap:"2px"}}>
                  📊 GRM
                  <span style={{fontSize:"8px",color:"var(--pri-hi)",lineHeight:1}}>ℹ</span>
                </div>
                <div style={{fontSize:"15px",fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:"var(--pri-hi)"}}>{p.grm}×</div>
              </div>
            </Tip>
          </div>

          <ScoreRing score={p.ai_score}/>
        </div>

        {/* ── Row 3: Tags ── */}
        <div style={{display:"flex",gap:"3px",flexWrap:"wrap",marginBottom:"6px"}}>
          {p.tags.map(t=>(
            <span key={t} style={{padding:"1px 5px",borderRadius:"4px",fontSize:"9px",fontWeight:600,...tagStyle(t)}}>{t}</span>
          ))}
        </div>

        {/* ── Row 4: Score bar ── */}
        <div style={{marginBottom:"9px"}}>
          <ScoreBar score={p.ai_score} color={scoreCol}/>
        </div>

        {/* ── Row 5: Sqft + action buttons ── */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingTop:"7px",borderTop:"1px solid var(--bd)"}}
          onClick={e=>e.stopPropagation()}>
          <span style={{fontSize:"9px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}}>📐 {p.sqft?.toLocaleString()||"—"} sqft</span>
          <div style={{display:"flex",gap:"4px"}}>
            {[
              {label:"🗺️",active:showMap,click:()=>{setShowMap(v=>!v);setShowMLS(false);log.ui("Map toggled",{rank:p.rank});}},
              {label:"📋",active:showMLS,click:()=>{setShowMLS(v=>!v);setShowMap(false);log.ui("MLS toggled",{rank:p.rank});}},
            ].map(b=>(
              <button key={b.label} onClick={b.click} style={{padding:"4px 8px",borderRadius:"6px",fontSize:"11px",fontWeight:600,border:`1px solid ${b.active?"var(--bd-hi)":"var(--bd)"}`,color:b.active?"var(--pri-hi)":"var(--t3)",background:b.active?"rgba(124,58,237,.12)":"var(--bg-raise)",cursor:"pointer",transition:"all .15s"}}>
                {b.label}
              </button>
            ))}
            <a href={`https://maps.google.com/?q=${encodeURIComponent(`${p.address}, ${p.zip_code}`)}`} target="_blank" rel="noopener noreferrer"
              onClick={()=>log.ui("Directions link clicked",{rank:p.rank})}
              style={{padding:"4px 8px",borderRadius:"6px",fontSize:"11px",fontWeight:600,border:"1px solid var(--bd)",color:"var(--t3)",background:"var(--bg-raise)",textDecoration:"none"}}>↗</a>
          </div>
        </div>

        {/* Expandable panels */}
        {showMap && <MapEmbed address={p.address} zip={p.zip_code}/>}
        {showMLS && <MLSPanel p={p}/>}

        {/* Chat hint */}
        <div style={{marginTop:"6px",fontSize:"9px",fontWeight:600,color:selected?"var(--pri-hi)":"var(--t3)"}}>
          💬 {selected?"Property Analyst open →":"Tap card to chat"}
        </div>
      </div>
    </div>
  );
}


// ── Rank formula floating sticky note ─────────────────────────
export function RankFormulaNote() {
  const [open, setOpen] = useState(false);
  const dims = [
    { d:"Cap Rate",    w:30, detail:">6%=90-100 · 5-6%=70-89 · <4.5%=0-49", color:"var(--grn)"    },
    { d:"Cash Flow",   w:25, detail:">$400=100 · $0-400=50-99 · <$0=0",      color:"var(--amb)"    },
    { d:"GRM",         w:15, detail:"<100×=100 · 100-130×=67 · >160×=0",     color:"var(--pri-hi)" },
    { d:"Days on Mkt", w:10, detail:"<14d=100 · <30d=60 · >60d=0",           color:"var(--cyn)"    },
    { d:"Strategy Fit",w:20, detail:"LTR/STR/BRRRR/Flip tuned per strategy", color:"var(--pnk)"    },
  ];
  return (
    <div className="rank-note">
      {/* Header */}
      <button onClick={()=>{ setOpen(v=>!v); log.ui("Rank formula note toggled",{open:!open}); }}
        style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",background:`linear-gradient(135deg,var(--pri),var(--pri-hi))`,border:"none",cursor:"pointer",color:"#fff",fontFamily:"inherit"}}>
        <span style={{fontSize:"12px",fontWeight:700}}>🧮 How is Score Calculated?</span>
        <span style={{fontSize:"13px",transform:open?"rotate(180deg)":"none",transition:"transform .2s"}}>▲</span>
      </button>

      {open && (
        <div style={{padding:"13px 14px"}} onClick={e=>e.stopPropagation()}>
          <p style={{fontSize:"11px",color:"var(--t2)",marginBottom:"10px",lineHeight:1.65}}>
            Each property receives a score 0–100 using a weighted rubric with local Ollama (llama3) when available. Ranked #1–10 by score. Falls back to rule-based scoring if Ollama is offline.
          </p>
          {dims.map(r=>(
            <div key={r.d} style={{marginBottom:"9px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"3px"}}>
                <span style={{fontSize:"11px",fontWeight:700,color:r.color}}>{r.d}</span>
                <span style={{fontSize:"11px",fontWeight:700,padding:"1px 6px",borderRadius:"9px",background:"var(--bg-raise)",color:"var(--t2)"}}>{r.w}%</span>
              </div>
              <div style={{height:"3px",background:"var(--bd)",borderRadius:"2px",overflow:"hidden",marginBottom:"3px"}}>
                <div style={{height:"100%",width:`${r.w*3.33}%`,background:r.color,borderRadius:"2px",transition:`width .6s ease`}}/>
              </div>
              <div style={{fontSize:"10px",color:"var(--t3)",lineHeight:1.4}}>{r.detail}</div>
            </div>
          ))}
          <div style={{marginTop:"10px",padding:"9px 11px",borderRadius:"8px",background:"var(--bg-raise)",border:"1px solid var(--bd)",fontSize:"10px",color:"var(--t3)",lineHeight:1.65}}>
            <strong style={{color:"var(--pri-hi)"}}>Formula:</strong> Score = Σ(dimension_score × weight)<br/>
            Ollama llama3 when online · rule-based fallback when offline
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────
export default function PropertyGrid({ properties, onSelectProperty, selectedProperty }: Props) {
  if (!properties?.length) return null;
  return (
    <div className="props-grid">
      {properties.map(p=>(
        <PropertyCard key={p.address} p={p}
          onSelect={()=>onSelectProperty(p)}
          selected={selectedProperty?.address===p.address}/>
      ))}
    </div>
  );
}

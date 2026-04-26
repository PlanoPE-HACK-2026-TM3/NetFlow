"use client";
import { useState } from "react";
import type { Property } from "@/lib/types";

interface Props {
  properties: Property[];
  onSelectProperty: (p: Property) => void;
  selectedProperty: Property | null;
}

function scoreInfo(s: number) {
  if (s >= 85) return { icon:"🏆", label:"Excellent", color:"#10b981", bg:"rgba(16,185,129,0.1)",  border:"rgba(16,185,129,0.3)"  };
  if (s >= 70) return { icon:"⭐", label:"Strong",    color:"#8b5cf6", bg:"rgba(139,92,246,0.1)", border:"rgba(139,92,246,0.3)"  };
  if (s >= 55) return { icon:"✅", label:"Good",      color:"#06b6d4", bg:"rgba(6,182,212,0.1)",   border:"rgba(6,182,212,0.3)"   };
  if (s >= 40) return { icon:"⚠️", label:"Fair",      color:"#f59e0b", bg:"rgba(245,158,11,0.1)",  border:"rgba(245,158,11,0.3)"  };
  return             { icon:"❌", label:"Weak",       color:"#ef4444", bg:"rgba(239,68,68,0.1)",   border:"rgba(239,68,68,0.3)"   };
}

const cfIcon = (cf: number) => cf > 400 ? "💎" : cf > 200 ? "💚" : cf > 0 ? "🟡" : "🔴";
const crIcon = (cr: number) => cr > 6 ? "🚀" : cr > 4.5 ? "📈" : "📉";
const domIcon = (d: number) => d < 14 ? "🔥" : d < 30 ? "⏱️" : "🐌";

const tagSt = (t: string): React.CSSProperties => {
  if (t.includes("Pick") || t.includes("⭐")) return { background:"rgba(139,92,246,0.12)", border:"1px solid rgba(139,92,246,0.3)", color:"#a78bfa" };
  if (t.includes("Hot")  || t.includes("🔥")) return { background:"rgba(245,158,11,0.1)",  border:"1px solid rgba(245,158,11,0.25)", color:"#fbbf24" };
  if (t.includes("Cash+"))                    return { background:"rgba(16,185,129,0.1)",  border:"1px solid rgba(16,185,129,0.25)", color:"#34d399" };
  return { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", color:"#64748b" };
};

function ScoreRing({ score }: { score: number }) {
  const { icon, label, color, bg, border } = scoreInfo(score);
  const r = 22, circ = 2 * Math.PI * r, fill = (score / 100) * circ;
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"4px" }}>
      <div style={{ position:"relative", width:"54px", height:"54px" }}>
        <svg width="54" height="54" viewBox="0 0 54 54" style={{ transform:"rotate(-90deg)" }}>
          <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5}/>
          <circle cx="27" cy="27" r={r} fill="none" stroke={color} strokeWidth={5}
            strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
            style={{ transition:"stroke-dasharray 0.9s ease" }}/>
        </svg>
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
          <span style={{ fontSize:"13px", lineHeight:1 }}>{icon}</span>
          <span style={{ fontSize:"10px", fontWeight:800, color, fontFamily:"'JetBrains Mono',monospace", lineHeight:1, marginTop:"1px" }}>{score}</span>
        </div>
      </div>
      <div style={{ padding:"2px 6px", borderRadius:"8px", background:bg, border:`1px solid ${border}`, fontSize:"9px", fontWeight:700, color }}>{label}</div>
    </div>
  );
}

function MapEmbed({ address, zipCode }: { address: string; zipCode: string }) {
  const query = encodeURIComponent(`${address}, ${zipCode}`);
  const mapUrl = `https://maps.google.com/maps?q=${query}&output=embed&zoom=15`;
  return (
    <div style={{ borderRadius:"10px", overflow:"hidden", border:"1px solid rgba(139,92,246,0.2)", marginTop:"10px" }}>
      <div style={{ padding:"6px 10px", background:"rgba(139,92,246,0.08)", borderBottom:"1px solid rgba(139,92,246,0.15)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:"11px", fontWeight:600, color:"#a78bfa", display:"flex", alignItems:"center", gap:"4px" }}>
          📍 Google Maps
        </span>
        <a href={`https://maps.google.com/?q=${query}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize:"10px", color:"#64748b", textDecoration:"none", display:"flex", alignItems:"center", gap:"3px" }}>
          Open ↗
        </a>
      </div>
      <iframe
        src={mapUrl}
        width="100%"
        height="200"
        style={{ border:"none", display:"block" }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title={`Map: ${address}`}
      />
    </div>
  );
}

function MLSDetails({ p }: { p: Property }) {
  return (
    <div style={{ marginTop:"10px", padding:"12px", borderRadius:"10px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(139,92,246,0.15)" }}>
      <div style={{ fontSize:"11px", fontWeight:700, color:"#8b5cf6", marginBottom:"8px", display:"flex", alignItems:"center", gap:"4px" }}>
        📋 MLS Listing Details
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"5px" }}>
        {[
          ["🏷️","MLS ID",       p.mls_id    || "N/A"],
          ["📅","Days Listed",   `${p.dom} days`],
          ["🏗️","Year Built",    p.year_built ? String(p.year_built) : "N/A"],
          ["📐","Lot Size",      p.lot_size   ? `${p.lot_size.toLocaleString()} sqft` : "N/A"],
          ["🏠","Property Type", p.sqft       ? `${p.sqft.toLocaleString()} sqft` : "N/A"],
          ["🛏️","Bed / Bath",   `${p.beds}bd / ${p.baths}ba`],
        ].map(([icon, label, val]) => (
          <div key={label as string} style={{ display:"flex", flexDirection:"column", gap:"1px" }}>
            <span style={{ fontSize:"10px", color:"#475569", fontWeight:500, display:"flex", alignItems:"center", gap:"2px" }}>
              {icon} {label}
            </span>
            <span style={{ fontSize:"12px", fontWeight:600, color:"#cbd5e1", fontFamily:"'JetBrains Mono',monospace" }}>{val}</span>
          </div>
        ))}
      </div>
      {/* External listing links */}
      <div style={{ marginTop:"10px", display:"flex", gap:"6px", flexWrap:"wrap" }}>
        {[
          { label:"Zillow", url: `https://www.zillow.com/homes/${encodeURIComponent(`${p.address} ${p.zip_code}`)}` },
          { label:"Redfin", url: `https://www.redfin.com/zipcode/${p.zip_code}` },
          { label:"Realtor.com", url: `https://www.realtor.com/realestateandhomes-search/${p.zip_code}` },
        ].map(({ label, url }) => (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer"
            style={{ padding:"4px 10px", borderRadius:"6px", fontSize:"11px", fontWeight:600, background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.25)", color:"#a78bfa", textDecoration:"none", display:"flex", alignItems:"center", gap:"3px", transition:"all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(139,92,246,0.2)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(139,92,246,0.1)"; }}>
            🔗 {label}
          </a>
        ))}
      </div>
    </div>
  );
}

function PropertyCard({ p, onSelect, selected }: { p: Property; onSelect: () => void; selected: boolean }) {
  const [showMap, setShowMap] = useState(false);
  const [showMLS, setShowMLS] = useState(false);
  const isTop = p.rank <= 2;
  const cfC = p.cash_flow > 300 ? "#10b981" : p.cash_flow > 0 ? "#f59e0b" : "#ef4444";
  const crC = p.cap_rate  > 6   ? "#10b981" : p.cap_rate  > 4.5 ? "#f59e0b" : "#8b5cf6";
  const { color: scoreColor } = scoreInfo(p.ai_score);

  return (
    <div style={{
      background: selected ? "rgba(139,92,246,0.08)" : isTop ? "rgba(139,92,246,0.04)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${selected ? "rgba(139,92,246,0.5)" : isTop ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.1)"}`,
      borderRadius:"14px", padding:"14px 16px",
      boxShadow: selected ? "0 0 0 2px rgba(139,92,246,0.3), 0 8px 32px rgba(124,58,237,0.15)" : isTop ? "0 2px 10px rgba(124,58,237,0.07)" : "none",
      transition:"all 0.18s",
    }}>
      {/* Top row — click to select for chat */}
      <div onClick={onSelect} style={{ display:"flex", gap:"12px", alignItems:"flex-start", cursor:"pointer" }}>
        {/* Rank */}
        <div style={{ width:"30px", height:"30px", borderRadius:"50%", flexShrink:0, marginTop:"2px",
          background: isTop ? "linear-gradient(135deg,#7c3aed,#8b5cf6)" : "rgba(255,255,255,0.05)",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:"12px", fontWeight:800, color: isTop ? "#fff" : "#64748b",
          fontFamily:"'JetBrains Mono',monospace",
          boxShadow: isTop ? "0 2px 8px rgba(124,58,237,0.4)" : "none" }}>
          {p.rank}
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          {/* Address + price + score ring */}
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:"8px", marginBottom:"8px" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:"14px", fontWeight:700, color:"#f1f5f9", marginBottom:"3px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {p.address}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"6px", fontSize:"10px", color:"#64748b", fontFamily:"'JetBrains Mono',monospace" }}>
                <span>📍 {p.zip_code}</span>
                <span>🛏️ {p.beds}bd/{p.baths}ba</span>
                <span>📐 {p.sqft?.toLocaleString()} sqft</span>
                <span>{domIcon(p.dom)} {p.dom}d</span>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"4px", flexShrink:0 }}>
              <div style={{ fontSize:"18px", fontWeight:800, color:"#8b5cf6", fontFamily:"'JetBrains Mono',monospace" }}>${p.price.toLocaleString()}</div>
              <div style={{ fontSize:"10px", color:"#64748b" }}>Est. ${p.est_rent.toLocaleString()}/mo</div>
            </div>
          </div>

          {/* Metrics + score ring */}
          <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px" }}>
            <div style={{ display:"flex", gap:"14px", flex:1, flexWrap:"wrap" }}>
              {[
                { val:`${p.cap_rate}%`,     lbl:"Cap Rate",  icon:crIcon(p.cap_rate), c:crC },
                { val:`$${p.cash_flow}/mo`, lbl:"Cash Flow", icon:cfIcon(p.cash_flow), c:cfC },
                { val:`${p.grm}x`,          lbl:"GRM",       icon:"📊", c:"#8b5cf6" },
              ].map(m => (
                <div key={m.lbl}>
                  <div style={{ fontSize:"14px", fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:m.c }}>{m.icon} {m.val}</div>
                  <div style={{ fontSize:"10px", color:"#64748b", textTransform:"uppercase", letterSpacing:"0.4px", fontWeight:600 }}>{m.lbl}</div>
                </div>
              ))}
            </div>
            <ScoreRing score={p.ai_score} />
          </div>

          {/* Tags */}
          <div style={{ display:"flex", gap:"4px", flexWrap:"wrap", marginBottom:"8px" }}>
            {p.tags.map(t => <span key={t} style={{ padding:"2px 7px", borderRadius:"4px", fontSize:"10px", fontWeight:600, ...tagSt(t) }}>{t}</span>)}
          </div>

          {/* Score bar */}
          <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px" }}>
            <div style={{ flex:1, height:"4px", background:"rgba(255,255,255,0.05)", borderRadius:"2px", overflow:"hidden" }}>
              <div className="score-bar-fill" style={{ height:"100%", borderRadius:"2px", background:`linear-gradient(90deg,#7c3aed,${scoreColor})`, width:`${p.ai_score}%` }}/>
            </div>
            <span style={{ fontSize:"10px", color:"#64748b", fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>NetFlow {p.ai_score}/100</span>
          </div>

          {/* Chat hint */}
          <div style={{ fontSize:"11px", fontWeight:600, color: selected ? "#a78bfa" : "#475569", display:"flex", alignItems:"center", gap:"4px" }}>
            <span>💬</span>{selected ? "AI Analyst open →" : "Click to open AI analyst"}
          </div>
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div style={{ display:"flex", gap:"6px", marginTop:"10px", paddingTop:"10px", borderTop:"1px solid rgba(139,92,246,0.1)" }}>
        <ActionBtn
          active={showMap}
          onClick={() => { setShowMap(v => !v); if (showMLS) setShowMLS(false); }}
          icon="🗺️" label="Map"
        />
        <ActionBtn
          active={showMLS}
          onClick={() => { setShowMLS(v => !v); if (showMap) setShowMap(false); }}
          icon="📋" label="MLS Details"
        />
        <a href={`https://maps.google.com/?q=${encodeURIComponent(`${p.address}, ${p.zip_code}`)}`}
          target="_blank" rel="noopener noreferrer"
          style={{ padding:"5px 10px", borderRadius:"7px", fontSize:"11px", fontWeight:600, border:"1px solid rgba(139,92,246,0.2)", color:"#64748b", background:"rgba(255,255,255,0.03)", textDecoration:"none", display:"flex", alignItems:"center", gap:"3px", transition:"all 0.15s" }}>
          📍 Directions
        </a>
        <a href={`https://www.zillow.com/homes/${encodeURIComponent(`${p.address} ${p.zip_code}`)}`}
          target="_blank" rel="noopener noreferrer"
          style={{ padding:"5px 10px", borderRadius:"7px", fontSize:"11px", fontWeight:600, border:"1px solid rgba(139,92,246,0.2)", color:"#64748b", background:"rgba(255,255,255,0.03)", textDecoration:"none", display:"flex", alignItems:"center", gap:"3px", transition:"all 0.15s" }}>
          🏠 Zillow
        </a>
      </div>

      {/* Expandable panels */}
      {showMap && <MapEmbed address={p.address} zipCode={p.zip_code} />}
      {showMLS && <MLSDetails p={p} />}
    </div>
  );
}

function ActionBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button onClick={onClick} style={{
      padding:"5px 10px", borderRadius:"7px", fontSize:"11px", fontWeight:600,
      border: `1px solid ${active ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.2)"}`,
      color:  active ? "#a78bfa" : "#64748b",
      background: active ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.03)",
      cursor:"pointer", display:"flex", alignItems:"center", gap:"3px", transition:"all 0.15s",
    }}>
      {icon} {label}
    </button>
  );
}

export default function PropertyGrid({ properties, onSelectProperty, selectedProperty }: Props) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
      {properties.map(p => (
        <PropertyCard
          key={p.address}
          p={p}
          onSelect={() => onSelectProperty(p)}
          selected={selectedProperty?.address === p.address}
        />
      ))}
    </div>
  );
}

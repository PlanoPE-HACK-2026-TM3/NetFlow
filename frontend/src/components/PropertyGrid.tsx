"use client";
import { useState, memo } from "react";
import { log } from "@/lib/logger";
import type { Property } from "@/lib/types";

const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

interface Props {
  properties:         Property[];
  onSelectProperty:   (p: Property) => void;
  selectedProperty:   Property | null;
  favorites?:         Set<string>;
  onToggleFavorite?:  (p: Property) => void;
}

/* ── Score helpers ─────────────────────────────────────────── */
const scoreInfo = (s: number) =>
  s >= 85 ? { c:"#10b981", label:"Excellent" } :
  s >= 70 ? { c:"#3b82f6", label:"Strong"    } :
  s >= 55 ? { c:"#f59e0b", label:"Good"      } :
            { c:"#f43f5e", label:"Fair"       };

const cfColor  = (v: number) => v > 300 ? "#10b981" : v > 0 ? "#f59e0b" : "#f43f5e";
const capColor = (v: number) => v >= 6  ? "#10b981" : v >= 4.5 ? "#f59e0b" : "#3b82f6";

/* ── Photo palette per rank ────────────────────────────────── */
const PALETTES: [string, string, string][] = [
  ["#071428","#0d2040","#2563eb"],
  ["#061a10","#0d3020","#059669"],
  ["#1c1000","#302000","#d97706"],
  ["#140810","#281020","#7c3aed"],
  ["#180808","#2e1010","#dc2626"],
];

/* ── Tooltip ───────────────────────────────────────────────── */
function Tip({ children, text, right = false }:
  { children: React.ReactNode; text: string; right?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`tip-wrap${right ? " tip-right" : ""}${open ? " tip-open" : ""}`}
      tabIndex={0} role="button" aria-haspopup="true" aria-expanded={open}
      onClick={() => setOpen(v => !v)}
      onBlur={() => setOpen(false)}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(v => !v); }
        if (e.key === "Escape") setOpen(false);
      }}>
      {children}
      <div className="tip-box" role="tooltip">{text}</div>
    </div>
  );
}

/* ── Heart ─────────────────────────────────────────────────── */
function Heart({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      aria-label={active ? "Remove favourite" : "Add to favourites"}
      style={{
        position: "absolute", bottom: 12, right: 12,
        width: 34, height: 34, borderRadius: "50%",
        background: "rgba(255,255,255,.96)",
        border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 12px rgba(0,0,0,.22)",
        transition: "transform .18s ease, box-shadow .18s ease",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.15)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 18px rgba(0,0,0,.28)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(0,0,0,.22)"; }}>
      <svg width="16" height="16" viewBox="0 0 24 24"
        fill={active ? "#f43f5e" : "none"}
        stroke={active ? "#f43f5e" : "#94a3b8"}
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </button>
  );
}

/* ── Property Card ─────────────────────────────────────────── */
const PropertyCard = memo(function PropertyCard({ p, onSelect, selected, isFavorite, onToggleFavorite }:
  { p: Property; onSelect: (p: Property) => void; selected: boolean; isFavorite: boolean; onToggleFavorite: (p: Property) => void }) {

  const [showMap,  setShowMap]  = useState(false);
  const [showMLS,  setShowMLS]  = useState(false);
  const [hitlVote, setHitlVote] = useState<"up"|"down"|null>(null);

  const submitVote = async (vote: "up" | "down") => {
    setHitlVote(vote);
    log.ui("HITL vote", { address: p.address, vote, score: p.ai_score });
    try {
      await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address:        p.address,
          mls_id:         p.mls_id ?? "",
          original_score: p.ai_score,
          vote,
        }),
      });
    } catch (_) { /* non-critical, fire-and-forget */ }
  };

  const [dark, mid, accent] = PALETTES[(p.rank - 1) % 5];
  const { c: scoreC, label: scoreLabel } = scoreInfo(p.ai_score);
  const cfC  = cfColor(p.cash_flow);
  const crC  = capColor(p.cap_rate);
  const isNew = p.dom < 7;

  const metrics = [
    { key:"cap",  val:`${p.cap_rate}%`,   label:"Cap Rate",  c: crC,              tip:"Cap Rate = NOI ÷ Price × 100. Target ≥ 6% for strong investment." },
    { key:"cf",   val:`$${p.cash_flow}`,  label:"Cash Flow", c: cfC,              tip:"Cash Flow = Rent − PITI − 35% opex. Monthly profit after all costs." },
    { key:"grm",  val:`${p.grm}×`,        label:"GRM",       c:"var(--pri-hi)",   tip:"GRM = Price ÷ Annual Rent. Under 100× excellent, 130× fair." },
  ];

  return (
    <article
      className={`prop-card note-in${selected ? " selected" : ""}`}
      style={{ animationDelay: `${(p.rank - 1) * 0.06}s` }}
      onClick={() => { onSelect(p); log.ui("Card selected", { rank: p.rank }); }}>

      {/* ══ PHOTO ═══════════════════════════════════════════ */}
      <div style={{
        position: "relative", width: "100%", paddingTop: "58%",
        background: `linear-gradient(160deg, ${dark} 0%, ${mid} 55%, ${accent}18 100%)`,
        overflow: "hidden",
      }}>
        {/* Subtle grid lines */}
        <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", opacity:.05 }}
          viewBox="0 0 320 186" preserveAspectRatio="xMidYMid slice">
          {[0,1,2,3,4,5].map(i => <line key={`h${i}`} x1="0" y1={i*37} x2="320" y2={i*37} stroke="#fff" strokeWidth=".8"/>)}
          {[0,1,2,3,4,5,6,7,8,9].map(i => <line key={`v${i}`} x1={i*36} y1="0" x2={i*36} y2="186" stroke="#fff" strokeWidth=".8"/>)}
        </svg>

        {/* Architectural house illustration */}
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <svg width="90" height="80" viewBox="0 0 90 80" fill="none" style={{ opacity:.45 }}>
            <path d="M45 5L5 38h9v34h20V52h22v20h20V38h9L45 5z"
              fill={`${accent}35`} stroke={`${accent}70`} strokeWidth="1.5" strokeLinejoin="round"/>
            <rect x="34" y="52" width="22" height="20"
              fill={`${accent}25`} stroke={`${accent}55`} strokeWidth="1"/>
            <rect x="11" y="42" width="13" height="13"
              fill={`${accent}20`} stroke={`${accent}45`} strokeWidth="1"/>
            <rect x="66" y="42" width="13" height="13"
              fill={`${accent}20`} stroke={`${accent}45`} strokeWidth="1"/>
            {/* Windows: small panes */}
            <line x1="17.5" y1="42" x2="17.5" y2="55" stroke={`${accent}35`} strokeWidth=".8"/>
            <line x1="11"   y1="48.5" x2="24" y2="48.5" stroke={`${accent}35`} strokeWidth=".8"/>
            <line x1="72.5" y1="42" x2="72.5" y2="55" stroke={`${accent}35`} strokeWidth=".8"/>
            <line x1="66"   y1="48.5" x2="79" y2="48.5" stroke={`${accent}35`} strokeWidth=".8"/>
          </svg>
        </div>

        {/* Gradient overlay at bottom for text legibility */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: "60%",
          background: "linear-gradient(to top, rgba(0,0,0,.55) 0%, transparent 100%)",
          pointerEvents: "none",
        }}/>

        {/* ── Overlaid badges ── */}

        {/* Rank — top left */}
        {p.rank <= 3 ? (
          /* Medal emoji on a frosted dark pill — no competing colour */
          <div style={{
            position: "absolute", top: 10, left: 10,
            background: "rgba(0,0,0,.62)",
            backdropFilter: "blur(8px)",
            borderRadius: 10,
            padding: "4px 9px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, lineHeight: 1,
            border: "1px solid rgba(255,255,255,.18)",
            boxShadow: "0 2px 12px rgba(0,0,0,.5)",
          }}>
            {["🥇","🥈","🥉"][p.rank - 1]}
          </div>
        ) : (
          /* Plain numbered circle for ranks 4-5 */
          <div style={{
            position: "absolute", top: 12, left: 12,
            width: 28, height: 28, borderRadius: "50%",
            background: "rgba(0,0,0,.55)",
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,.9)",
            fontFamily: "'JetBrains Mono',monospace",
            border: "1px solid rgba(255,255,255,.15)",
          }}>
            {p.rank}
          </div>
        )}

        {/* NEW — next to rank */}
        {isNew && (
          <div style={{
            position: "absolute", top: 12, left: 50,
            background: "#10b981", color: "#fff",
            fontSize: 10, fontWeight: 700, borderRadius: 6,
            padding: "4px 9px", letterSpacing: ".6px", textTransform: "uppercase",
            boxShadow: "0 2px 10px rgba(16,185,129,.5)",
            border: "1px solid rgba(255,255,255,.2)",
          }}>
            New
          </div>
        )}

        {/* Score chip — top right */}
        <div style={{
          position: "absolute", top: 12, right: 12,
          background: "rgba(0,0,0,.60)", backdropFilter: "blur(8px)",
          borderRadius: 10, padding: "5px 10px",
          display: "flex", alignItems: "center", gap: 5,
          border: "1px solid rgba(255,255,255,.12)",
        }}>
          <span style={{
            display: "inline-block", width: 7, height: 7, borderRadius: "50%",
            background: scoreC, flexShrink: 0,
            boxShadow: `0 0 8px ${scoreC}`,
          }}/>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{p.ai_score}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,.65)", letterSpacing: ".3px" }}>{scoreLabel}</span>
        </div>

        {/* DOM indicator — bottom left */}
        <div style={{
          position: "absolute", bottom: 12, left: 12,
          background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)",
          borderRadius: 6, padding: "3px 10px",
          fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,.85)",
          border: "1px solid rgba(255,255,255,.09)",
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <span>{p.dom < 14 ? "🔥" : p.dom < 30 ? "⏱" : "🐌"}</span>
          {p.dom}d on market
        </div>

        <Heart active={isFavorite} onClick={() => onToggleFavorite(p)} />
      </div>

      {/* ══ BODY ════════════════════════════════════════════ */}
      <div style={{ padding: "18px 18px 14px" }}>

        {/* Price + Rent */}
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", marginBottom: 10, gap: 8,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 24, fontWeight: 800, letterSpacing: "-0.8px",
              color: "var(--t1)", lineHeight: 1.05, fontFamily: "'Inter',sans-serif",
            }}>
              ${p.price.toLocaleString()}
            </div>
            <div style={{
              fontSize: 12, color: "var(--t3)", marginTop: 5, lineHeight: 1.45,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {p.address}, {p.zip_code}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#10b981", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>
              ${p.est_rent.toLocaleString()}
            </div>
            <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 4 }}>/month</div>
          </div>
        </div>

        {/* Spec pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            { icon: "🛏", label: `${p.beds} bed` },
            { icon: "🚿", label: `${p.baths} bath` },
            { icon: "📐", label: p.sqft ? `${(p.sqft/1000).toFixed(1)}k sqft` : "—" },
          ].map(s => (
            <span key={s.label} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 12, color: "var(--t2)", fontWeight: 500,
              background: "var(--bg-raise)", borderRadius: 7,
              padding: "4px 10px", border: "1px solid var(--bd)",
              whiteSpace: "nowrap",
            }}>
              <span style={{ fontSize: 11 }}>{s.icon}</span>{s.label}
            </span>
          ))}
        </div>

        {/* Hairline divider */}
        <div style={{ height: 1, background: "var(--bd)", marginBottom: 14 }} />

        {/* Investment metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginBottom: 12 }}>
          {metrics.map((m, i) => (
            <Tip key={m.key} text={m.tip} right={i === 2}>
              <div
                style={{
                  textAlign: "center", padding: "11px 6px 9px", borderRadius: 10,
                  background: "var(--bg-raise)",
                  border: "1px solid var(--bd)",
                  cursor: "help", transition: "border-color .15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--bd-hi)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--bd)"; }}>
                <div style={{
                  fontSize: 16, fontWeight: 800, color: m.c,
                  fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.1,
                }}>
                  {m.val}
                </div>
                <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 5, fontWeight: 600, letterSpacing: ".2px" }}>
                  {m.label}
                </div>
              </div>
            </Tip>
          ))}
        </div>

        {/* Score progress bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div className="score-bar-track" style={{ flex: 1 }}>
            <div className="score-bar-fill"
              style={{ width: `${p.ai_score}%`, background: `linear-gradient(90deg,var(--pri),${scoreC})` }}/>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: "var(--t3)",
            fontFamily: "'JetBrains Mono',monospace",
            minWidth: 36, textAlign: "right",
          }}>
            {p.ai_score}/100
          </span>
        </div>

        {/* LLM Correctness bar */}
        {(p.llm_correctness !== undefined) && (() => {
          const lc    = p.llm_correctness;
          const lcC   = lc >= 80 ? "#10b981" : lc >= 60 ? "#f59e0b" : "#f43f5e";
          const lcLbl = lc >= 80 ? "High" : lc >= 60 ? "Med" : "Low";
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: "var(--t3)", minWidth: 60 }}>
                LLM Conf.
              </span>
              <div style={{ flex: 1, height: 3, background: "var(--bg-raise)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${lc}%`, background: lcC, borderRadius: 2, transition: "width 0.4s" }}/>
              </div>
              <span style={{ fontSize: 9, color: lcC, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", minWidth: 34, textAlign: "right" }}>
                {lcLbl} {lc}%
              </span>
            </div>
          );
        })()}

        {/* Tags */}
        {p.tags.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
            {p.tags.map(t => {
              const cash = t.includes("Cash+");
              const hot  = t.includes("Hot") || t.includes("🔥");
              const pick = t.includes("Pick") || t.includes("🏆");
              const tc   = cash ? "#10b981" : hot ? "#f59e0b" : pick ? "#3b82f6" : "var(--t3)";
              const tbg  = cash ? "rgba(16,185,129,.10)" : hot ? "rgba(245,158,11,.10)" : pick ? "rgba(59,130,246,.10)" : "rgba(100,120,160,.07)";
              const tbd  = cash ? "rgba(16,185,129,.28)" : hot ? "rgba(245,158,11,.28)" : pick ? "rgba(59,130,246,.28)" : "var(--bd)";
              return (
                <span key={t} style={{
                  fontSize: 10, fontWeight: 600, color: tc,
                  background: tbg, border: `1px solid ${tbd}`,
                  borderRadius: 5, padding: "2px 7px", letterSpacing: ".2px",
                }}>
                  {t}
                </span>
              );
            })}
          </div>
        )}

        {/* HITL — human-in-the-loop feedback row */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, paddingTop: 8, borderTop: "1px solid var(--bd)" }}
          onClick={e => e.stopPropagation()}>
          {hitlVote ? (
            <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              {hitlVote === "up" ? "Marked helpful" : "Feedback recorded"}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 10, color: "var(--t3)", flex: 1, fontWeight: 500 }}>Was this ranking helpful?</span>
              {(["up", "down"] as const).map(v => (
                <button key={v} onClick={() => submitVote(v)} title={v === "up" ? "Thumbs up" : "Thumbs down"}
                  style={{
                    width: 28, height: 28, borderRadius: 7, border: "1px solid var(--bd)",
                    background: "var(--bg-raise)", cursor: "pointer", fontSize: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = v === "up" ? "#10b981" : "#f43f5e"; (e.currentTarget as HTMLElement).style.background = v === "up" ? "rgba(16,185,129,.10)" : "rgba(244,63,94,.10)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--bd)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-raise)"; }}>
                  {v === "up" ? "👍" : "👎"}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Action buttons */}
        <div
          style={{ display: "flex", gap: 7, alignItems: "stretch" }}
          onClick={e => e.stopPropagation()}>

          {[
            { label: "🗺", title: "Map",     active: showMap, click: () => { setShowMap(v => !v); setShowMLS(false); } },
            { label: "📋", title: "Details", active: showMLS, click: () => { setShowMLS(v => !v); setShowMap(false); } },
          ].map(b => (
            <button key={b.title} onClick={b.click} title={b.title}
              style={{
                flex: 1, padding: "9px 0",
                borderRadius: 9, fontSize: 13, fontWeight: 600,
                border: `1px solid ${b.active ? "var(--pri)" : "var(--bd)"}`,
                color: b.active ? "var(--pri-hi)" : "var(--t3)",
                background: b.active ? "var(--pri-lo)" : "transparent",
                cursor: "pointer", transition: "all .15s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}>
              <span>{b.label}</span>
              <span style={{ fontSize: 11 }}>{b.title}</span>
            </button>
          ))}

          <button onClick={() => onSelect(p)}
            style={{
              flex: 2, padding: "9px 0", borderRadius: 9,
              fontSize: 13, fontWeight: 700, letterSpacing: ".3px",
              border: "none",
              background: selected
                ? `linear-gradient(135deg,${accent},${accent}cc)`
                : "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color: "#fff", cursor: "pointer",
              boxShadow: selected
                ? `0 3px 14px ${accent}55`
                : "0 3px 12px rgba(37,99,235,.38)",
              transition: "all .18s",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            {selected ? "✓ Chatting" : "💬 Chat"}
          </button>
        </div>

        {/* Expandable map */}
        {showMap && (
          <div style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", border: "1px solid var(--bd)" }}>
            <iframe
              src={`https://maps.google.com/maps?q=${encodeURIComponent(`${p.address}, ${p.zip_code}`)}&output=embed&zoom=15`}
              width="100%" height="175" style={{ border: "none", display: "block" }}
              loading="lazy" title={`Map: ${p.address}`}/>
          </div>
        )}

        {/* Expandable MLS details */}
        {showMLS && (
          <div style={{
            marginTop: 12, padding: "14px 14px 12px",
            borderRadius: 10, background: "var(--bg-raise)", border: "1px solid var(--bd)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pri-hi)", letterSpacing: ".4px", marginBottom: 10 }}>
              MLS Details
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 12 }}>
              {[
                ["MLS ID",      p.mls_id || "N/A"],
                ["Year Built",  p.year_built ? String(p.year_built) : "N/A"],
                ["Living Area", p.sqft ? `${p.sqft.toLocaleString()} sqft` : "N/A"],
                ["Lot Size",    p.lot_size ? `${p.lot_size.toLocaleString()} sqft` : "N/A"],
              ].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: "var(--t3)", fontWeight: 500, marginBottom: 2 }}>{l}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--t2)", fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                ["Zillow",  `https://www.zillow.com/homes/${encodeURIComponent(p.address + " " + p.zip_code)}`],
                ["Redfin",  `https://www.redfin.com/zipcode/${p.zip_code}`],
                ["Realtor", `https://www.realtor.com/realestateandhomes-search/${p.zip_code}`],
              ].map(([l, u]) => (
                <a key={l} href={u} target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: 11, fontWeight: 600, color: "var(--pri-hi)",
                    textDecoration: "none", padding: "5px 12px",
                    borderRadius: 7, border: "1px solid var(--bd-hi)",
                    background: "var(--pri-lo)", transition: "background .15s",
                  }}>
                  {l} ↗
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
});

/* ── Grid export ─────────────────────────────────────────────── */
export default memo(function PropertyGrid({ properties, onSelectProperty, selectedProperty, favorites, onToggleFavorite }: Props) {
  if (!properties?.length) return null;
  const noop = () => {};
  return (
    <div className="props-grid">
      {properties.map(p => (
        <PropertyCard key={p.address} p={p}
          onSelect={onSelectProperty}
          selected={selectedProperty?.address === p.address}
          isFavorite={favorites?.has(p.address) ?? false}
          onToggleFavorite={onToggleFavorite ?? noop} />
      ))}
    </div>
  );
});

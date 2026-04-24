"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchParams, ParsedPrompt } from "@/lib/types";
import type { SearchRecord } from "@/lib/db";
import { silentCorrect } from "@/lib/spellCorrect";

const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

const D = {
  border: "rgba(139,92,246,0.15)", borderHi: "rgba(139,92,246,0.4)",
  text1: "#f1f5f9", text2: "#cbd5e1", text3: "#64748b",
  primaryHi: "#8b5cf6", green: "#10b981", amber: "#f59e0b", red: "#ef4444",
};

const PROP_TYPES = [
  { label:"Single Family", value:"SFH",      icon:"🏠" },
  { label:"Multi-family",  value:"Multi",     icon:"🏢" },
  { label:"Condo",         value:"Condo",     icon:"🏙️" },
  { label:"Townhouse",     value:"Townhouse", icon:"🏘️" },
] as const;

const STRATEGIES = [
  { label:"Long-term",  value:"LTR",   icon:"📅" },
  { label:"Short-term", value:"STR",   icon:"⚡" },
  { label:"BRRRR",      value:"BRRRR", icon:"🔄" },
  { label:"Flip",       value:"Flip",  icon:"🔨" },
] as const;

const EXAMPLES = [
  "75070",
  "3 bed SFH in McKinney TX under $450k",
  "Dallas TX homes under $500k LTR",
  "BRRRR deal 75033 under $400k",
  "condo in Houston under $300k STR",
  "flip in Austin TX under $350k",
];

// ── In-memory search cache (session, 15min TTL) ───────────────
const _cache = new Map<string, { result: unknown; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000;

function _cacheKey(p: SearchParams & { prompt_text?: string }) {
  return JSON.stringify({ z:p.zip_code, b:p.budget, t:p.property_type, d:p.min_beds, s:p.strategy });
}
export function getCachedResult(p: SearchParams & { prompt_text?: string }) {
  const e = _cache.get(_cacheKey(p));
  return e && Date.now() - e.ts < CACHE_TTL ? e.result : null;
}
export function setCachedResult(p: SearchParams & { prompt_text?: string }, result: unknown) {
  _cache.set(_cacheKey(p), { result, ts: Date.now() });
}

function parseBudgetInput(raw: string): number {
  const t = raw.trim();
  if (!t) return 450000;

  const m = t.match(/\$?\s*([\d,.]+)\s*([kKmM])?$/);
  if (!m) {
    const fallback = parseInt(t.replace(/\D/g, ""), 10);
    return fallback > 0 ? fallback : 450000;
  }

  let value = parseFloat(m[1].replace(/,/g, ""));
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") value *= 1000;
  if (suffix === "m") value *= 1_000_000;

  // Treat small naked values like "450" as shorthand for "$450k".
  if (!suffix && value > 0 && value < 10000) value *= 1000;

  const n = Math.round(value);
  return n > 0 ? n : 450000;
}

// ── Web Speech API types ──────────────────────────────────────
declare global {
  interface Window {
    SpeechRecognition: new() => SpeechRecognition;
    webkitSpeechRecognition: new() => SpeechRecognition;
  }
  interface SpeechRecognition extends EventTarget {
    continuous: boolean; interimResults: boolean; lang: string;
    start(): void; stop(): void;
    onresult: ((e: SpeechRecognitionEvent) => void) | null;
    onerror:  ((e: SpeechRecognitionErrorEvent) => void) | null;
    onend:    (() => void) | null;
  }
  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
  }
  interface SpeechRecognitionErrorEvent extends Event { error: string; }
}

interface Props {
  onSearch:       (p: SearchParams & { prompt_text?: string }) => void;
  loading:        boolean;
  statusMsg:      string;
  searchHistory:  SearchRecord[];
  onHistorySelect:(prompt: string) => void;
}

const SH = ({ icon, label }: { icon:string; label:string }) => (
  <div style={{ display:"flex", alignItems:"center", gap:"5px", fontSize:"10px", fontWeight:700, color:D.text3, letterSpacing:"0.8px", textTransform:"uppercase", marginBottom:"8px" }}>
    <span>{icon}</span>{label}
  </div>
);
const FL = ({ children }: { children:string }) => (
  <div style={{ fontSize:"13px", fontWeight:600, color:D.text2, marginBottom:"6px" }}>{children}</div>
);
const Div = () => <div style={{ height:"1px", background:"rgba(139,92,246,0.1)", margin:"6px 0" }} />;
function Pill({ icon, val, color }: { icon:string; val:string; color:string }) {
  return (
    <span style={{ padding:"1px 7px", borderRadius:"5px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(139,92,246,0.2)", fontSize:"11px", fontWeight:600, color, display:"flex", alignItems:"center", gap:"3px" }}>
      {icon} {val}
    </span>
  );
}

export default function SearchPanel({ onSearch, loading, statusMsg, searchHistory, onHistorySelect }: Props) {
  const [prompt,     setPrompt]     = useState("");
  const [parsed,     setParsed]     = useState<ParsedPrompt | null>(null);
  const [parsing,    setParsing]    = useState(false);
  const [phIdx,      setPhIdx]      = useState(0);

  // Voice
  const [listening,  setListening]  = useState(false);
  const [voiceErr,   setVoiceErr]   = useState("");
  const [voiceSupp,  setVoiceSupp]  = useState(false);
  const recognRef = useRef<SpeechRecognition | null>(null);

  // Overrides — all blank/null = not active
  const [zipOver,    setZipOver]    = useState("");
  const [budgetOver, setBudgetOver] = useState("");
  const [typeOver,   setTypeOver]   = useState<SearchParams["property_type"] | "">("");
  const [bedsOver,   setBedsOver]   = useState<number | null>(null);
  const [stratOver,  setStratOver]  = useState<SearchParams["strategy"] | "">("");
  const [showOver,   setShowOver]   = useState(false);

  // History panel
  const [showHist,   setShowHist]   = useState(false);

  const parseTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textaRef     = useRef<HTMLTextAreaElement>(null);
  const parseAbortRef = useRef<AbortController | null>(null);
  const parseSeqRef = useRef(0);

  // Voice support detection
  useEffect(() => {
    setVoiceSupp(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  // Placeholder rotation
  useEffect(() => {
    const t = setInterval(() => setPhIdx(i => (i+1) % EXAMPLES.length), 3200);
    return () => clearInterval(t);
  }, []);

  // Auto-parse prompt (debounced)
  const doParse = useCallback(async (text: string) => {
    if (text.trim().length < 3) { setParsed(null); return; }
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    const seq = ++parseSeqRef.current;
    setParsing(true);
    try {
      const res  = await fetch(`${API_BASE}/api/parse-prompt`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ prompt: text }),
        signal: controller.signal,
      });
      const nextParsed = await res.json();
      if (seq === parseSeqRef.current) {
        setParsed(nextParsed);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setParsed(null);
      }
    } finally  {
      if (seq === parseSeqRef.current) {
        setParsing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current);
    if (prompt.trim().length >= 3) {
      const delay = /^\d{5}$/.test(prompt.trim()) ? 0 : 650;
      parseTimer.current = setTimeout(() => doParse(prompt), delay);
    } else setParsed(null);
    return () => { if (parseTimer.current) clearTimeout(parseTimer.current); };
  }, [prompt, doParse]);

  // ── Silent spell correction on pause (1.5s after last keystroke) ─
  // Applied silently — user only sees corrected text, no indicator shown
  const applyCorrection = useCallback((text: string) => {
    const corrected = silentCorrect(text);
    if (corrected !== text) setPrompt(corrected);
  }, []);

  const handlePromptChange = (val: string) => {
    setPrompt(val);
    // Re-schedule silent correction
    if (correctTimer.current) clearTimeout(correctTimer.current);
    correctTimer.current = setTimeout(() => applyCorrection(val), 1500);
  };

  // Also apply on blur (when user leaves the field)
  const handlePromptBlur = () => {
    if (correctTimer.current) clearTimeout(correctTimer.current);
    applyCorrection(prompt);
  };

  useEffect(() => {
    return () => {
      if (parseTimer.current) clearTimeout(parseTimer.current);
      if (correctTimer.current) clearTimeout(correctTimer.current);
      parseAbortRef.current?.abort();
      recognRef.current?.stop();
    };
  }, []);

  // ── Voice input ───────────────────────────────────────────
  const startVoice = () => {
    setVoiceErr("");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceErr("Voice not supported in this browser."); return; }
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onresult = (e: SpeechRecognitionEvent) => {
      const t = Array.from(e.results).map(x => x[0].transcript).join(" ").trim();
      if (t) { setPrompt(prev => prev ? `${prev} ${t}` : t); textaRef.current?.focus(); }
    };
    r.onerror = (e: SpeechRecognitionErrorEvent) => {
      // Suppress non-errors: "no-speech" = mic timeout (user said nothing),
      // "aborted" = stop() called programmatically — both are expected flows.
      const silent = ["no-speech", "aborted"];
      if (!silent.includes(e.error)) {
        const msg: Record<string, string> = {
          "not-allowed":     "Microphone access denied. Allow mic in browser settings.",
          "audio-capture":   "No microphone found. Check your audio device.",
          "network":         "Network error — voice recognition requires internet.",
          "service-not-allowed": "Voice service not available in this browser.",
        };
        setVoiceErr(msg[e.error] || `Voice error: ${e.error}`);
      }
      setListening(false);
    };
    r.onend = () => setListening(false);
    recognRef.current = r;
    r.start(); setListening(true);

    // Auto-stop after 8s — prevents long silence triggering "no-speech" error
    const autoStop = setTimeout(() => {
      if (recognRef.current) { recognRef.current.stop(); }
    }, 8000);
    // Clear auto-stop if recognition ends naturally first
    r.onend = () => { clearTimeout(autoStop); setListening(false); };
  };
  const stopVoice = () => { recognRef.current?.stop(); setListening(false); };

  // ── Resolved search params ─────────────────────────────────
  const isZip   = /^\d{5}$/.test(prompt.trim());
  const hasText = prompt.trim().length >= 3;

  const finalZip    = zipOver.trim()    || parsed?.zip_code   || (isZip ? prompt.trim() : "75070");
  const finalBudget = budgetOver.trim() ? parseBudgetInput(budgetOver)
                                        : (parsed?.budget || 450000);
  const finalType   = (typeOver  || parsed?.property_type || "SFH") as SearchParams["property_type"];
  const finalBeds   = bedsOver   ?? parsed?.min_beds ?? 3;
  const finalStrat  = (stratOver || parsed?.strategy  || "LTR") as SearchParams["strategy"];

  const price     = finalBudget;
  const down      = price*0.2, loan=price-down, r=0.072/12, n=360;
  const monthly   = Math.round(loan*(r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1));
  const breakEven = Math.round(monthly*1.15);

  const inp: React.CSSProperties = {
    background:"rgba(255,255,255,0.04)", border:`1px solid ${D.border}`,
    borderRadius:"8px", padding:"10px 12px", color:D.text1, fontSize:"14px",
    fontFamily:"Inter,sans-serif", outline:"none", width:"100%", transition:"all 0.18s",
  };
  const chip = (on:boolean): React.CSSProperties => ({
    padding:"5px 10px", borderRadius:"7px", fontSize:"12px", fontWeight:600,
    border:`1px solid ${on ? D.borderHi : D.border}`,
    color: on ? D.primaryHi : D.text3,
    background: on ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.03)",
    cursor:"pointer", transition:"all 0.15s", userSelect:"none",
    display:"flex", alignItems:"center", gap:"4px",
  });

  const overrideCount = [zipOver, budgetOver, typeOver, bedsOver !== null ? "x" : "", stratOver].filter(Boolean).length;

  const handleSearch = () => {
    if (!hasText) return;
    // Apply spell correction one last time before searching
    const correctedPrompt = silentCorrect(prompt.trim());
    if (correctedPrompt !== prompt) setPrompt(correctedPrompt);
    onSearch({
      zip_code:      finalZip,
      budget:        finalBudget,
      property_type: finalType,
      min_beds:      finalBeds,
      strategy:      finalStrat,
      prompt_text:   correctedPrompt,
      location:      parsed?.location_display || "",
    });
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>

      {/* ── SMART PROMPT ─────────────────────────────── */}
      <div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"8px" }}>
          <SH icon="✨" label="Search Prompt" />
          <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
            {parsing && (
              <span style={{ fontSize:"10px", color:D.primaryHi, display:"flex", alignItems:"center", gap:"3px" }}>
                <div style={{ width:"10px", height:"10px", border:"1.5px solid rgba(139,92,246,0.3)", borderTopColor:D.primaryHi, borderRadius:"50%", animation:"spin 0.75s linear infinite" }}/>
                Parsing...
              </span>
            )}
            {!parsing && parsed && hasText && <span style={{ fontSize:"10px", fontWeight:600, color:D.green }}>✅ Parsed</span>}
          </div>
        </div>

        {/* Textarea — Grammarly suppressed, spellCheck off, browser UI disabled */}
        <div style={{ position:"relative" }}>
          <textarea
            ref={textaRef}
            value={prompt}
            onChange={e => handlePromptChange(e.target.value)}
            onBlur={handlePromptBlur}
            onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); handleSearch(); }}}
            placeholder={`Try: "${EXAMPLES[phIdx]}" …\n(ZIP · city + state · or full description)`}
            rows={3}
            // ── Suppress ALL browser/extension spell-checkers ──────
            spellCheck={false}
            autoCorrect="off"
            autoComplete="off"
            autoCapitalize="off"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            data-lt-active="false"
            style={{
              ...inp, resize:"none", lineHeight:1.6,
              paddingRight:"44px",
              borderColor: isZip   ? "rgba(16,185,129,0.45)" :
                           hasText ? "rgba(139,92,246,0.4)"  : D.border,
              boxShadow:   isZip   ? "0 0 0 3px rgba(16,185,129,0.08)" :
                           hasText ? "0 0 0 3px rgba(139,92,246,0.1)"  : "none",
            }}
          />

          {/* Mic button */}
          {voiceSupp && (
            <button
              onClick={listening ? stopVoice : startVoice}
              title={listening ? "Stop recording" : "Speak your search"}
              style={{
                position:"absolute", top:"8px", right:"8px",
                width:"28px", height:"28px", borderRadius:"50%",
                background: listening ? "rgba(239,68,68,0.9)" : "rgba(139,92,246,0.15)",
                border: `1px solid ${listening ? "rgba(239,68,68,0.6)" : D.border}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", transition:"all 0.2s",
                boxShadow: listening ? "0 0 0 4px rgba(239,68,68,0.2)" : "none",
              }}
            >
              {listening ? (
                <div style={{ display:"flex", gap:"2px", alignItems:"center" }}>
                  {[0,1,2].map(i=>(
                    <div key={i} style={{ width:"2px", height:"10px", background:"#fff", borderRadius:"1px",
                      animation:`voiceBar 0.7s ease-in-out ${i*0.12}s infinite alternate` }}/>
                  ))}
                </div>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v4M8 23h8"/>
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Voice status */}
        {listening && (
          <div style={{ marginTop:"5px", fontSize:"11px", fontWeight:600, color:D.red, display:"flex", alignItems:"center", gap:"5px" }}>
            <div style={{ width:"7px", height:"7px", borderRadius:"50%", background:D.red, animation:"blink 1s infinite" }}/>
            Listening… speak now, click 🎤 to stop
          </div>
        )}
        {voiceErr && <div style={{ marginTop:"5px", fontSize:"11px", color:D.amber }}>⚠️ {voiceErr}</div>}

        {/* Auto-parsed pills */}
        {parsed && hasText && (
          <div style={{ marginTop:"7px", padding:"8px 10px", borderRadius:"8px", background:"rgba(139,92,246,0.06)", border:"1px solid rgba(139,92,246,0.2)", display:"flex", flexWrap:"wrap", gap:"5px" }}>
            <span style={{ fontSize:"10px", fontWeight:700, color:D.primaryHi, width:"100%", marginBottom:"2px" }}>✨ Auto-parsed:</span>
            {parsed.zip_code        && <Pill icon="📮" val={parsed.zip_code}         color={D.green}/>}
            {parsed.location_display && parsed.location_display !== parsed.zip_code &&
              <Pill icon="📍" val={parsed.location_display} color={D.primaryHi}/>}
            {parsed.budget          && <Pill icon="💰" val={`$${parsed.budget.toLocaleString()}`} color="#a78bfa"/>}
            {parsed.min_beds        && <Pill icon="🛏️" val={`${parsed.min_beds}+ bd`}  color={D.text2}/>}
            {parsed.property_type   && <Pill icon="🏠" val={parsed.property_type}     color={D.text2}/>}
            {parsed.strategy        && <Pill icon="📅" val={parsed.strategy}           color={D.amber}/>}
          </div>
        )}

        {/* Quick example chips */}
        <div style={{ marginTop:"7px", display:"flex", flexWrap:"wrap", gap:"4px" }}>
          {["75070","Dallas TX $500k","Austin STR $400k","McKinney BRRRR","Houston flip $300k"].map(ex=>(
            <button key={ex} onClick={()=>setPrompt(ex)}
              style={{ padding:"3px 8px", borderRadius:"5px", fontSize:"11px", border:`1px solid ${D.border}`, color:D.text3, background:"rgba(255,255,255,0.02)", cursor:"pointer", transition:"all 0.15s" }}
              onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor=D.borderHi;(e.currentTarget as HTMLButtonElement).style.color=D.primaryHi;}}
              onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor=D.border;(e.currentTarget as HTMLButtonElement).style.color=D.text3;}}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      <Div/>

      {/* ── OVERRIDE FILTERS (collapsible) ────────── */}
      <div>
        <button onClick={()=>setShowOver(v=>!v)}
          style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", cursor:"pointer", padding:0 }}>
          <SH icon="⚙️" label="Override Filters" />
          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"8px" }}>
            {overrideCount > 0 && <span style={{ fontSize:"10px", fontWeight:700, background:D.primaryHi, color:"#fff", borderRadius:"10px", padding:"1px 6px" }}>{overrideCount}</span>}
            <span style={{ fontSize:"12px", color:D.text3, display:"inline-block", transform:showOver?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▼</span>
          </div>
        </button>

        {showOver && (
          <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
            <div>
              <FL>ZIP Code</FL>
              <input style={inp} value={zipOver} onChange={e=>setZipOver(e.target.value.replace(/\D/g,"").slice(0,5))}
                placeholder="e.g. 75070  (blank = from prompt)"
                onFocus={e=>{e.target.style.borderColor=D.borderHi;e.target.style.boxShadow="0 0 0 3px rgba(139,92,246,0.1)";e.target.style.background="rgba(139,92,246,0.06)";}}
                onBlur={e=>{e.target.style.borderColor=D.border;e.target.style.boxShadow="none";e.target.style.background="rgba(255,255,255,0.04)";}}/>
            </div>
            <div>
              <FL>Max Budget</FL>
              <input style={inp} value={budgetOver} onChange={e=>setBudgetOver(e.target.value)}
                placeholder="e.g. 450000  (blank = from prompt)"
                onFocus={e=>{e.target.style.borderColor=D.borderHi;e.target.style.boxShadow="0 0 0 3px rgba(139,92,246,0.1)";e.target.style.background="rgba(139,92,246,0.06)";}}
                onBlur={e=>{e.target.style.borderColor=D.border;e.target.style.boxShadow="none";e.target.style.background="rgba(255,255,255,0.04)";}}/>
            </div>
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"6px" }}>
                <FL>Property Type</FL>
                {typeOver && <button onClick={()=>setTypeOver("")} style={{ fontSize:"10px", color:D.text3, background:"none", border:"none", cursor:"pointer" }}>✕ clear</button>}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                {PROP_TYPES.map(t=><div key={t.value} onClick={()=>setTypeOver(typeOver===t.value?"":t.value)} style={chip(typeOver===t.value)}>{t.icon} {t.label}</div>)}
              </div>
            </div>
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"6px" }}>
                <FL>Min Bedrooms</FL>
                {bedsOver!==null && <button onClick={()=>setBedsOver(null)} style={{ fontSize:"10px", color:D.text3, background:"none", border:"none", cursor:"pointer" }}>✕ clear</button>}
              </div>
              <div style={{ display:"flex", gap:"5px" }}>
                {[1,2,3,4].map(b=><div key={b} onClick={()=>setBedsOver(bedsOver===b?null:b)} style={{...chip(bedsOver===b),flex:1,justifyContent:"center"}}>🛏️ {b}+</div>)}
              </div>
            </div>
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"6px" }}>
                <FL>Strategy</FL>
                {stratOver && <button onClick={()=>setStratOver("")} style={{ fontSize:"10px", color:D.text3, background:"none", border:"none", cursor:"pointer" }}>✕ clear</button>}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
                {STRATEGIES.map(s=><div key={s.value} onClick={()=>setStratOver(stratOver===s.value?"":s.value)} style={chip(stratOver===s.value)}>{s.icon} {s.label}</div>)}
              </div>
            </div>
            {overrideCount > 0 && (
              <button onClick={()=>{setZipOver("");setBudgetOver("");setTypeOver("");setBedsOver(null);setStratOver("");}}
                style={{ fontSize:"12px", color:D.red, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:"7px", padding:"6px 12px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                ✕ Clear all overrides
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── SEARCH BUTTON ─────────────────────────── */}
      <button onClick={handleSearch} disabled={loading||!hasText}
        style={{ width:"100%", padding:"13px", borderRadius:"10px",
          background: loading||!hasText?"rgba(139,92,246,0.3)":"linear-gradient(135deg,#7c3aed,#6d28d9)",
          border:"1px solid rgba(139,92,246,0.4)", color:"#fff", fontSize:"15px", fontWeight:700,
          cursor:loading||!hasText?"not-allowed":"pointer", fontFamily:"inherit",
          display:"flex", alignItems:"center", justifyContent:"center", gap:"8px",
          boxShadow:loading||!hasText?"none":"0 4px 20px rgba(124,58,237,0.4)", transition:"all 0.2s" }}>
        {loading
          ? <><div style={{ width:"15px",height:"15px",border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.75s linear infinite" }}/>{statusMsg||"Analyzing..."}</>
          : <>🔍 Find Top 10 Properties</>}
      </button>

      {/* ── EFFECTIVE PARAMS PREVIEW ─────────────── */}
      {hasText && (
        <div style={{ padding:"8px 10px", borderRadius:"8px", background:"rgba(255,255,255,0.02)", border:`1px solid ${D.border}` }}>
          <div style={{ fontSize:"10px", fontWeight:700, color:D.text3, marginBottom:"5px", textTransform:"uppercase", letterSpacing:"0.6px" }}>Will search with:</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"5px" }}>
            <Pill icon="📮" val={finalZip}              color={zipOver    ? D.amber : D.green}/>
            <Pill icon="💰" val={`$${finalBudget.toLocaleString()}`} color={budgetOver  ? D.amber : D.text2}/>
            <Pill icon="🛏️" val={`${finalBeds}+ bd`}   color={bedsOver!==null ? D.amber : D.text2}/>
            <Pill icon="🏠" val={finalType}             color={typeOver   ? D.amber : D.text2}/>
            <Pill icon="📅" val={finalStrat}            color={stratOver  ? D.amber : D.text2}/>
          </div>
          <div style={{ fontSize:"10px", color:D.text3, marginTop:"4px" }}>🟡 amber = override &nbsp;|&nbsp; 🟢 green = from prompt</div>
        </div>
      )}

      <Div/>

      {/* ── SEARCH HISTORY (from IndexedDB, per user) ─ */}
      <div>
        <button onClick={()=>setShowHist(v=>!v)}
          style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", cursor:"pointer", padding:0 }}>
          <SH icon="🕑" label="Search History" />
          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"8px" }}>
            {searchHistory.length > 0 && (
              <span style={{ fontSize:"10px", fontWeight:700, background:"rgba(139,92,246,0.3)", color:"#fff", borderRadius:"10px", padding:"1px 6px" }}>
                {searchHistory.length}
              </span>
            )}
            <span style={{ fontSize:"12px", color:D.text3, display:"inline-block", transform:showHist?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▼</span>
          </div>
        </button>

        {showHist && (
          <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
            {searchHistory.length === 0 ? (
              <div style={{ fontSize:"12px", color:D.text3, padding:"8px 0" }}>No searches yet this session.</div>
            ) : (
              <>
                {searchHistory.slice(0, 15).map((h, i) => (
                  <div key={h.id ?? i}
                    onClick={() => { setPrompt(h.prompt); onHistorySelect(h.prompt); setShowHist(false); }}
                    style={{ padding:"9px 11px", borderRadius:"8px", background:"rgba(255,255,255,0.03)", border:`1px solid ${D.border}`, cursor:"pointer", transition:"all 0.15s" }}
                    onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.background="rgba(139,92,246,0.08)";(e.currentTarget as HTMLDivElement).style.borderColor=D.borderHi;}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.background="rgba(255,255,255,0.03)";(e.currentTarget as HTMLDivElement).style.borderColor=D.border;}}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"6px" }}>
                      <div style={{ fontSize:"12px", fontWeight:600, color:D.text1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
                        🔍 {h.prompt}
                      </div>
                      <div style={{ fontSize:"10px", color:D.text3, flexShrink:0 }}>{h.resultCount} results</div>
                    </div>
                    <div style={{ display:"flex", gap:"5px", marginTop:"5px", flexWrap:"wrap", alignItems:"center" }}>
                      <Pill icon="📮" val={(h.params as Record<string,string>).zip_code || "—"} color={D.text3}/>
                      <Pill icon="💰" val={`$${((h.params as Record<string,number>).budget||0).toLocaleString()}`} color={D.text3}/>
                      <Pill icon="📅" val={(h.params as Record<string,string>).strategy || "—"} color={D.text3}/>
                      <span style={{ fontSize:"10px", color:D.text3, marginLeft:"auto", fontFamily:"'JetBrains Mono',monospace" }}>
                        {new Date(h.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <Div/>

      {/* ── MARKET SNAPSHOT ──────────────────────── */}
      <div>
        <SH icon="📊" label="Market Snapshot"/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"7px" }}>
          {[{icon:"🏦",val:"7.2%",lbl:"30yr Rate",c:D.red},{icon:"📈",val:"5.8%",lbl:"Avg Cap",c:D.green},{icon:"💰",val:"$2,140",lbl:"Median Rent",c:D.primaryHi},{icon:"📅",val:"28d",lbl:"Avg DOM",c:D.amber}].map(s=>(
            <div key={s.lbl} style={{ padding:"11px",borderRadius:"9px",background:"rgba(255,255,255,0.03)",border:`1px solid ${D.border}` }}>
              <div style={{ fontSize:"15px",marginBottom:"2px" }}>{s.icon}</div>
              <div style={{ fontSize:"16px",fontWeight:800,color:s.c,fontFamily:"'JetBrains Mono',monospace" }}>{s.val}</div>
              <div style={{ fontSize:"10px",color:D.text3,fontWeight:500 }}>{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      <Div/>

      {/* ── MORTGAGE CALCULATOR ──────────────────── */}
      <div>
        <SH icon="🧮" label="Mortgage Calculator"/>
        <div style={{ background:"rgba(255,255,255,0.03)",border:`1px solid ${D.border}`,borderRadius:"9px",padding:"12px" }}>
          {[["🏷️","Price",`$${price.toLocaleString()}`,false],["⬇️","Down 20%",`$${Math.round(down).toLocaleString()}`,false],["🏦","Loan",`$${Math.round(loan).toLocaleString()}`,false],["💳","Monthly P&I",`$${monthly.toLocaleString()}`,true],["⚖️","Break-even",`$${breakEven.toLocaleString()}`,true]].map(([ic,l,v,b],i)=>(
            <div key={l as string} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:i<4?"1px solid rgba(139,92,246,0.07)":"none" }}>
              <span style={{ fontSize:"12px",color:D.text3,display:"flex",alignItems:"center",gap:"4px" }}><span>{ic}</span>{l}</span>
              <span style={{ fontSize:"12px",fontFamily:"'JetBrains Mono',monospace",fontWeight:b?700:500,color:b?D.primaryHi:D.text2 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { SearchParams, ParsedPrompt } from "@/lib/types";
import type { SearchRecord } from "@/lib/db";
import { silentCorrect } from "@/lib/spellCorrect";

const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

const D = {
  border: "var(--bd)", borderHi: "var(--bd-hi)",
  text1: "var(--t1)", text2: "var(--t2)", text3: "var(--t3)",
  primaryHi: "var(--pri-hi)", green: "var(--grn)", amber: "var(--amb)", red: "var(--red)",
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


// ── Synchronously extract budget from prompt text ─────────────
// Mirrors backend parse_prompt_to_params budget logic so the frontend
// doesn't depend on the debounced /api/parse-prompt response.
function parseBudgetFromText(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, "");
  // $300k  or  $300K
  let m = t.match(/\$(\d+(?:\.\d+)?)k\b/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  // under/below/max/budget 300k
  m = t.match(/(?:under|below|max|budget|up\s+to)[^$\d]*\$?(\d+(?:\.\d+)?)k\b/);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  // $300000  (5+ digit dollar amount)
  m = t.match(/\$(\d{5,})/);
  if (m) return parseInt(m[1]);
  // under/below/max/budget $300000
  m = t.match(/(?:under|below|max|budget|up\s+to)[^$\d]*\$?(\d{5,})/);
  if (m) return parseInt(m[1]);
  return null;
}

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
    onerror:  ((e: Event) => void) | null;
    onend:    (() => void) | null;
  }
}

interface Props {
  onSearch:       (p: SearchParams & { prompt_text?: string }) => void;
  loading:        boolean;
  statusMsg:      string;
  searchHistory:  SearchRecord[];
  onHistorySelect:(prompt: string) => void;
}

const SH = ({ icon, label }: { icon:string; label:string }) => (
  <div style={{ display:"flex", alignItems:"center", gap:"5px", fontSize:"10px", fontWeight:700, color:D.text3, letterSpacing:"0.8px", marginBottom:"8px" }}>
    <span>{icon}</span>{label}
  </div>
);
const FL = ({ children }: { children:string }) => (
  <div style={{ fontSize:"13px", fontWeight:600, color:D.text2, marginBottom:"6px" }}>{children}</div>
);
const Div = () => <div style={{ height:"1px", background:"rgba(79,158,255,0.10)", margin:"6px 0" }} />;

const INP: React.CSSProperties = {
  background:"var(--bg-raise)", border:`1px solid ${D.border}`,
  borderRadius:"8px", padding:"10px 12px", color:D.text1, fontSize:"14px",
  fontFamily:"Inter,sans-serif", outline:"none", width:"100%", transition:"all 0.18s",
};
const chip = (on:boolean): React.CSSProperties => ({
  padding:"5px 10px", borderRadius:"7px", fontSize:"12px", fontWeight:600,
  border:`1px solid ${on ? D.borderHi : D.border}`,
  color: on ? D.primaryHi : D.text3,
  background: on ? "rgba(79,158,255,0.12)" : "var(--bg-surf)",
  cursor:"pointer", transition:"all 0.15s", userSelect:"none",
  display:"flex", alignItems:"center", gap:"4px",
});

export default function SearchPanel({ onSearch, loading, statusMsg, searchHistory, onHistorySelect }: Props) {
  const [prompt,     setPrompt]     = useState("");
  const [parsed,     setParsed]     = useState<ParsedPrompt | null>(null);

  // Voice
  const [listening,  setListening]  = useState(false);
  const [voiceErr,   setVoiceErr]   = useState("");
  const [voiceSupp,  setVoiceSupp]  = useState(false);
  const recognRef = useRef<SpeechRecognition | null>(null);

  // Overrides — all blank/null = not active
  const [zipOver,    setZipOver]    = useState("");
  const [cityOver,   setCityOver]   = useState("");
  const [stateOver,  setStateOver]  = useState("");
  const [budgetOver, setBudgetOver] = useState("");
  const [typeOver,   setTypeOver]   = useState<SearchParams["property_type"] | "">("");
  const [bedsOver,   setBedsOver]   = useState<number | null>(null);
  const [stratOver,  setStratOver]  = useState<SearchParams["strategy"] | "">("");
  const [showOver,   setShowOver]   = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);

  const recentGroups = useMemo(() => {
    const todayMs = new Date().setHours(0,0,0,0);
    const yestMs  = todayMs - 864e5;
    const weekMs  = todayMs - 7 * 864e5;
    return [
      { label:"Today",           items: searchHistory.filter(h => h.ts >= todayMs) },
      { label:"Yesterday",       items: searchHistory.filter(h => h.ts >= yestMs && h.ts < todayMs) },
      { label:"Previous 7 days", items: searchHistory.filter(h => h.ts >= weekMs  && h.ts < yestMs) },
      { label:"Older",           items: searchHistory.filter(h => h.ts < weekMs) },
    ].filter(g => g.items.length > 0);
  }, [searchHistory]);


  const parseTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textaRef     = useRef<HTMLTextAreaElement>(null);
  const parseAbort   = useRef<AbortController | null>(null);

  // Voice support detection
  useEffect(() => {
    setVoiceSupp(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);


  // Auto-parse prompt (debounced)
  const doParse = useCallback(async (text: string) => {
    if (text.trim().length < 3) { setParsed(null); return; }
    parseAbort.current?.abort();
    const ctrl = new AbortController();
    parseAbort.current = ctrl;
    try {
      const res = await fetch(`${API_BASE}/api/parse-prompt`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ prompt: text }),
        signal: ctrl.signal,
      });
      if (!ctrl.signal.aborted) { setParsed(await res.json()); }
    } catch(e) {
      if ((e as Error).name !== "AbortError") { setParsed(null); }
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

  // ── Voice input ───────────────────────────────────────────
  const startVoice = () => {
    setVoiceErr("");
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceErr("Voice not supported in this browser."); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = false; r.lang = "en-US";
    r.onresult = (e: SpeechRecognitionEvent) => {
      const t = Array.from(e.results).map(x => x[0].transcript).join(" ").trim();
      if (t) { setPrompt(prev => prev ? `${prev} ${t}` : t); textaRef.current?.focus(); }
    };
    r.onerror = (e: Event) => {
      const err = (e as Event & { error: string }).error;
      const silent = ["no-speech", "aborted"];
      if (!silent.includes(err)) {
        const msg: Record<string, string> = {
          "not-allowed":         "Microphone access denied. Allow mic in browser settings.",
          "audio-capture":       "No microphone found. Check your audio device.",
          "network":             "Network error — voice recognition requires internet.",
          "service-not-allowed": "Voice service not available in this browser.",
        };
        setVoiceErr(msg[err] || `Voice error: ${err}`);
      }
      setListening(false);
    };
    recognRef.current = r;
    r.start(); setListening(true);
    r.onend = () => setListening(false);
  };
  const stopVoice = () => { recognRef.current?.stop(); setListening(false); };

  // ── Resolved search params ─────────────────────────────────
  const isZip   = /^\d{5}$/.test(prompt.trim());
  const hasText = prompt.trim().length >= 3;

  const finalZip    = zipOver.trim() || (cityOver.trim() ? "" : (parsed?.zip_code || (isZip ? prompt.trim() : "75070")));
  const finalBudget = budgetOver.trim()
    ? (parseInt(budgetOver.replace(/\D/g,"")) || 450000)
    : (parseBudgetFromText(prompt) ?? parsed?.budget ?? 450000);
  const finalType   = (typeOver  || parsed?.property_type || "SFH") as SearchParams["property_type"];
  const finalBeds   = bedsOver   ?? parsed?.min_beds ?? 3;
  const finalStrat  = (stratOver || parsed?.strategy  || "LTR") as SearchParams["strategy"];

  const price     = finalBudget;
  const down      = price*0.2, loan=price-down, r=0.072/12, n=360;
  const pn        = Math.pow(1+r,n);
  const monthly   = Math.round(loan*(r*pn)/(pn-1));
  const breakEven = Math.round(monthly*1.15);
  const inp       = INP;

  const overrideCount = useMemo(
    () => [zipOver, cityOver, stateOver, budgetOver, typeOver, bedsOver !== null ? "x" : "", stratOver].filter(Boolean).length,
    [zipOver, cityOver, stateOver, budgetOver, typeOver, bedsOver, stratOver]
  );

  const hasOverride = overrideCount > 0;

  const handleSearch = () => {
    // Allow search with EITHER prompt text OR active override filters
    if (!hasText && !hasOverride) return;
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
      city:          cityOver.trim() || parsed?.city || "",
      state:         stateOver.trim() || parsed?.state || "",
    });
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>

      {/* ── SMART PROMPT ─────────────────────────────── */}
      <div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"8px" }}>
          
          <div style={{ display:"flex", alignItems:"center", gap:"6px" }}/>
        </div>

        {/* Textarea — Grammarly suppressed, spellCheck off, browser UI disabled */}
        <div style={{ position:"relative" }}>
          <textarea
            ref={textaRef}
            value={prompt}
            onChange={e => handlePromptChange(e.target.value)}
            onBlur={handlePromptBlur}
            onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); handleSearch(); }}}
            placeholder="ZIP, city + state, or describe what you're looking for..."
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
              borderColor: isZip       ? "rgba(16,185,129,0.50)" :
                           hasText    ? "rgba(79,158,255,0.45)" :
                           hasOverride? "rgba(245,158,11,0.45)" : D.border,
              boxShadow:   isZip       ? "0 0 0 3px rgba(16,185,129,0.09)" :
                           hasText    ? "0 0 0 3px rgba(79,158,255,0.11)" :
                           hasOverride? "0 0 0 3px rgba(245,158,11,0.09)" : "none",
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
                background: listening ? "rgba(239,68,68,0.9)" : "rgba(79,158,255,0.14)",
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




      </div>

      <Div/>

      {/* ── ADVANCED SEARCH (collapsible) ────────── */}
      <div>
        <button onClick={()=>setShowOver(v=>!v)}
          style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", cursor:"pointer", padding:"8px 12px", background:`linear-gradient(135deg,rgba(37,99,235,.13) 0%,rgba(99,102,241,.08) 100%)`, border:`1.5px solid ${D.primaryHi}44`, borderRadius:"10px", marginBottom:"4px", transition:"border-color .2s,box-shadow .2s", boxShadow:`0 0 0 ${showOver?"3px":"0px"} ${D.primaryHi}22` }}>
          <div style={{ display:"flex", alignItems:"center", gap:"7px" }}>
            <span style={{ fontSize:"16px", lineHeight:1 }}>🔍</span>
            <span style={{ fontSize:"14px", fontWeight:800, color:D.primaryHi, letterSpacing:".3px" }}>Advanced Search</span>
            {overrideCount > 0 && <span style={{ fontSize:"11px", fontWeight:700, background:D.primaryHi, color:"#fff", borderRadius:"10px", padding:"1px 7px" }}>{overrideCount}</span>}
          </div>
          <span style={{ fontSize:"13px", color:D.primaryHi, display:"inline-block", transform:showOver?"rotate(180deg)":"none", transition:"transform 0.2s" }}>▼</span>
        </button>

        {showOver && (
          <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
            <div>
              <FL>ZIP Code</FL>
              <input style={inp} value={zipOver} onChange={e=>setZipOver(e.target.value.replace(/\D/g,"").slice(0,5))}
                placeholder="e.g. 75070  (blank = from prompt)"
                onFocus={e=>{e.target.style.borderColor=D.borderHi;e.target.style.boxShadow="0 0 0 3px rgba(79,158,255,0.10)";e.target.style.background="rgba(37,99,235,0.06)";}}
                onBlur={e=>{e.target.style.borderColor=D.border;e.target.style.boxShadow="none";e.target.style.background="var(--bg-raise)";}}/>
            </div>
            <div style={{ display:"flex", gap:"8px" }}>
              <div style={{ flex:2 }}>
                <FL>City</FL>
                <input style={inp} value={cityOver} onChange={e=>setCityOver(e.target.value)}
                  placeholder="e.g. Austin"
                  onFocus={e=>{e.target.style.borderColor=D.borderHi;e.target.style.boxShadow="0 0 0 3px rgba(79,158,255,0.10)";e.target.style.background="rgba(37,99,235,0.06)";}}
                  onBlur={e=>{e.target.style.borderColor=D.border;e.target.style.boxShadow="none";e.target.style.background="var(--bg-raise)";}}/>
              </div>
              <div style={{ flex:1 }}>
                <FL>State</FL>
                <input style={inp} value={stateOver} onChange={e=>setStateOver(e.target.value.toUpperCase().slice(0,2))}
                  placeholder="TX"
                  onFocus={e=>{e.target.style.borderColor=D.borderHi;e.target.style.boxShadow="0 0 0 3px rgba(79,158,255,0.10)";e.target.style.background="rgba(37,99,235,0.06)";}}
                  onBlur={e=>{e.target.style.borderColor=D.border;e.target.style.boxShadow="none";e.target.style.background="var(--bg-raise)";}}/>
              </div>
            </div>
            <div>
              <FL>Max Budget</FL>
              <input style={inp} value={budgetOver} onChange={e=>setBudgetOver(e.target.value)}
                placeholder="e.g. 450000  (blank = from prompt)"
                onFocus={e=>{e.target.style.borderColor=D.borderHi;e.target.style.boxShadow="0 0 0 3px rgba(79,158,255,0.10)";e.target.style.background="rgba(37,99,235,0.06)";}}
                onBlur={e=>{e.target.style.borderColor=D.border;e.target.style.boxShadow="none";e.target.style.background="var(--bg-raise)";}}/>
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
              <button onClick={()=>{setZipOver("");setCityOver("");setStateOver("");setBudgetOver("");setTypeOver("");setBedsOver(null);setStratOver("");}}
                style={{ fontSize:"12px", color:D.red, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:"7px", padding:"6px 12px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                ✕ Clear all overrides
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── SEARCH BUTTON ─────────────────────────── */}
      <button onClick={handleSearch} disabled={loading||(!hasText&&!hasOverride)}
        style={{ width:"100%", padding:"13px", borderRadius:"10px",
          background: (loading||(!hasText&&!hasOverride))?"rgba(79,158,255,0.28)":"linear-gradient(135deg,#2563eb,#1e40af)",
          border:"1px solid rgba(79,158,255,0.40)", color:"#fff", fontSize:"15px", fontWeight:700,
          cursor:(loading||(!hasText&&!hasOverride))?"not-allowed":"pointer", fontFamily:"inherit",
          display:"flex", alignItems:"center", justifyContent:"center", gap:"8px",
          boxShadow:(loading||(!hasText&&!hasOverride))?"none":"0 4px 20px rgba(37,99,235,0.38)", transition:"all 0.2s" }}>
        {loading
          ? <><div style={{ width:"15px",height:"15px",border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.75s linear infinite" }}/>{statusMsg||"Analyzing..."}</>
          : <>{hasOverride&&!hasText?`🔍 Search (${overrideCount} filter${overrideCount>1?'s':''})`:"🔍 Search Properties"}</>}
      </button>



      <Div/>

      {/* ── MORTGAGE CALCULATOR ──────────────────── */}
      <div>
        <SH icon="🧮" label="Mortgage Calculator"/>
        <div style={{ background:"var(--bg-surf)",border:`1px solid ${D.border}`,borderRadius:"9px",padding:"12px" }}>
          {[["🏷️","Price",`$${price.toLocaleString()}`,false],["⬇️","Down 20%",`$${Math.round(down).toLocaleString()}`,false],["🏦","Loan",`$${Math.round(loan).toLocaleString()}`,false],["💳","Monthly P&I",`$${monthly.toLocaleString()}`,true],["⚖️","Break-even",`$${breakEven.toLocaleString()}`,true]].map(([ic,l,v,b],i)=>(
            <div key={l as string} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:i<4?"1px solid rgba(79,158,255,0.07)":"none" }}>
              <span style={{ fontSize:"12px",color:D.text3,display:"flex",alignItems:"center",gap:"4px" }}><span>{ic}</span>{l}</span>
              <span style={{ fontSize:"12px",fontFamily:"'JetBrains Mono',monospace",fontWeight:b?700:500,color:b?D.primaryHi:D.text2 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── RECENT ───────────────────────────────────── */}
      {recentGroups.length > 0 && (
          <div>
            <button onClick={()=>setRecentOpen(v=>!v)} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%", background:"none", border:"none", cursor:"pointer", padding:"2px 6px 4px", borderRadius:"6px" }}
              onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.background="rgba(255,255,255,0.05)"}
              onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.background="transparent"}>
              <span style={{ fontSize:"11px", fontWeight:600, color:D.text3, letterSpacing:"0.6px" }}>Recent</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={D.text3} strokeWidth={1.8} strokeLinecap="round"
                style={{ transform:recentOpen?"rotate(0deg)":"rotate(-90deg)", transition:"transform 0.18s" }}>
                <polyline points="2,4 6,8 10,4"/>
              </svg>
            </button>
            {recentOpen && (
              <div style={{ display:"flex", flexDirection:"column" }}>
                {recentGroups.map(g => (
                  <div key={g.label}>
                    <div style={{ fontSize:"10px", fontWeight:600, color:D.text3, padding:"6px 8px 2px", opacity:0.7 }}>{g.label}</div>
                    {g.items.slice(0,7).map((h, i) => (
                      <div key={h.id ?? i}
                        onClick={() => { setPrompt(h.prompt); onHistorySelect(h.prompt); }}
                        title={h.prompt}
                        style={{ padding:"5px 8px", borderRadius:"6px", cursor:"pointer", transition:"background 0.12s" }}
                        onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.background="rgba(255,255,255,0.06)"}
                        onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.background="transparent"}>
                        <div style={{ fontSize:"13px", color:D.text2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", lineHeight:1.45 }}>
                          {h.prompt || (h.params as Record<string,string>).zip_code || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
      )}

    </div>
  );
}

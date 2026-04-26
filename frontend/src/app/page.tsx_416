"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import SearchPanel, { getCachedResult, setCachedResult } from "@/components/SearchPanel";
import PropertyGrid from "@/components/PropertyGrid";
import AIAnalysisCard from "@/components/AIAnalysisCard";
import ComparisonCharts from "@/components/ComparisonCharts";
import PropertyChat from "@/components/PropertyChat";
import type { SearchParams, SearchResult, Property } from "@/lib/types";
import {
  seedDefaultUser, validateLogin, recordLogin, recordSearch,
  getLoginHistory, getSearchHistory, clearSearchHistory,
  type LoginRecord, type SearchRecord, type DBUser,
} from "@/lib/db";

const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

const D = {
  border: "rgba(139,92,246,0.15)", borderHi: "rgba(139,92,246,0.4)",
  text1:"#f1f5f9", text2:"#cbd5e1", text3:"#64748b",
  primary:"#7c3aed", primaryHi:"#8b5cf6",
  green:"#10b981", amber:"#f59e0b", red:"#ef4444",
};

// ── LOGIN PAGE ─────────────────────────────────────────────────
function LoginPage({ onLogin }: { onLogin: (user: DBUser) => void }) {
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [showPw,     setShowPw]     = useState(false);
  const [err,        setErr]        = useState("");
  const [loading,    setLoading]    = useState(false);
  const [loginHist,  setLoginHist]  = useState<LoginRecord[]>([]);
  const [showHist,   setShowHist]   = useState(false);
  const [dbReady,    setDbReady]    = useState(false);

  useEffect(() => {
    seedDefaultUser().then(() => {
      setDbReady(true);
      getLoginHistory().then(h => setLoginHist(h.slice(0,10)));
    });
  }, []);

  const doLogin = async () => {
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) { setErr("Username and password are required."); return; }
    setErr(""); setLoading(true);
    try {
      const user = await validateLogin(u, p);
      if (user) {
        await recordLogin({ username: u, ts: Date.now(), success: true });
        onLogin(user);
      } else {
        await recordLogin({ username: u, ts: Date.now(), success: false, reason: "Invalid credentials" });
        setErr("Invalid username or password.");
        setLoginHist(await getLoginHistory().then(h => h.slice(0,10)));
      }
    } catch (e) {
      setErr("Login error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inp: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${err ? "rgba(239,68,68,0.4)" : "rgba(139,92,246,0.2)"}`,
    borderRadius: "10px", padding: "12px 14px",
    color: "#f1f5f9", fontSize: "15px",
    fontFamily: "Inter,sans-serif", outline: "none", width: "100%", transition: "all 0.18s",
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0d0f1a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"Inter,sans-serif", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:"-100px", left:"50%", transform:"translateX(-50%)", width:"700px", height:"500px", borderRadius:"50%", background:"radial-gradient(ellipse,rgba(124,58,237,0.12) 0%,transparent 65%)", pointerEvents:"none" }}/>

      <div style={{ width:"100%", maxWidth:"440px", background:"#131620", border:"1px solid rgba(139,92,246,0.2)", borderRadius:"20px", padding:"44px 40px", boxShadow:"0 8px 50px rgba(0,0,0,0.6)", position:"relative", zIndex:1 }}>
        <div style={{ position:"absolute", top:0, left:0, right:0, height:"2px", background:"linear-gradient(90deg,#7c3aed,#8b5cf6,#06b6d4)", borderRadius:"20px 20px 0 0" }}/>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:"32px" }}>
          <div style={{ width:"68px", height:"68px", borderRadius:"18px", background:"linear-gradient(135deg,#7c3aed,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"30px", margin:"0 auto 14px", boxShadow:"0 6px 24px rgba(124,58,237,0.5)" }}>🏘️</div>
          <div style={{ fontSize:"32px", fontWeight:800, color:"#f1f5f9", marginBottom:"4px" }}>Net<span style={{ color:"#8b5cf6" }}>Flow</span></div>
          <div style={{ fontSize:"12px", color:"#64748b", fontWeight:500 }}>AI-Powered Real Estate Intelligence</div>
        </div>

        <div style={{ fontSize:"18px", fontWeight:700, color:"#f1f5f9", marginBottom:"3px" }}>Welcome back</div>
        <div style={{ fontSize:"13px", color:"#64748b", marginBottom:"22px" }}>Sign in to your account</div>

        {/* Username */}
        <div style={{ marginBottom:"14px" }}>
          <label style={{ fontSize:"13px", fontWeight:600, color:"#94a3b8", display:"block", marginBottom:"6px" }}>👤 Username</label>
          <input type="text" value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="Enter username" style={inp} autoComplete="username"
            onFocus={e=>{e.target.style.borderColor="rgba(139,92,246,0.5)";e.target.style.boxShadow="0 0 0 3px rgba(124,58,237,0.15)";e.target.style.background="rgba(139,92,246,0.06)";}}
            onBlur={e=>{e.target.style.borderColor=err?"rgba(239,68,68,0.4)":"rgba(139,92,246,0.2)";e.target.style.boxShadow="none";e.target.style.background="rgba(255,255,255,0.05)";}}/>
        </div>

        {/* Password */}
        <div style={{ marginBottom:"20px" }}>
          <label style={{ fontSize:"13px", fontWeight:600, color:"#94a3b8", display:"block", marginBottom:"6px" }}>🔒 Password</label>
          <div style={{ position:"relative" }}>
            <input type={showPw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="Enter password" style={{...inp,paddingRight:"44px"}} autoComplete="current-password"
              onFocus={e=>{e.target.style.borderColor="rgba(139,92,246,0.5)";e.target.style.boxShadow="0 0 0 3px rgba(124,58,237,0.15)";e.target.style.background="rgba(139,92,246,0.06)";}}
              onBlur={e=>{e.target.style.borderColor=err?"rgba(239,68,68,0.4)":"rgba(139,92,246,0.2)";e.target.style.boxShadow="none";e.target.style.background="rgba(255,255,255,0.05)";}}/>
            <button onClick={()=>setShowPw(!showPw)} style={{ position:"absolute", right:"12px", top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:"16px" }}>{showPw?"🙈":"👁"}</button>
          </div>
        </div>

        {err && <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:"8px", padding:"10px 14px", fontSize:"13px", color:"#f87171", marginBottom:"14px" }}>⚠️ {err}</div>}

        <button onClick={doLogin} disabled={loading||!dbReady}
          style={{ width:"100%", padding:"13px", borderRadius:"10px", background:loading?"rgba(139,92,246,0.4)":"linear-gradient(135deg,#7c3aed,#6d28d9)", border:"1px solid rgba(139,92,246,0.4)", color:"#fff", fontSize:"15px", fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px", boxShadow:loading?"none":"0 4px 22px rgba(124,58,237,0.5)", transition:"all 0.2s" }}>
          {loading?<><div style={{ width:"16px",height:"16px",border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.75s linear infinite"}}/>Signing in...</>:<>🔐 Sign In</>}
        </button>

        {/* Recent login attempts */}
        {loginHist.length > 0 && (
          <div style={{ marginTop:"20px" }}>
            <button onClick={()=>setShowHist(v=>!v)}
              style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", background:"none", border:"none", cursor:"pointer", padding:0 }}>
              <span style={{ fontSize:"11px", fontWeight:700, color:D.text3, letterSpacing:"0.6px", textTransform:"uppercase" }}>🕑 Recent Login Activity</span>
              <span style={{ fontSize:"11px", color:D.text3 }}>{showHist?"▲":"▼"}</span>
            </button>
            {showHist && (
              <div style={{ marginTop:"8px", display:"flex", flexDirection:"column", gap:"4px", maxHeight:"160px", overflowY:"auto" }}>
                {loginHist.map((h,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 10px", borderRadius:"7px", background:h.success?"rgba(16,185,129,0.06)":"rgba(239,68,68,0.06)", border:`1px solid ${h.success?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)"}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                      <span style={{ fontSize:"12px" }}>{h.success?"✅":"❌"}</span>
                      <span style={{ fontSize:"12px", fontWeight:600, color:h.success?D.green:D.red }}>{h.username}</span>
                      {!h.success && h.reason && <span style={{ fontSize:"11px", color:D.text3 }}>— {h.reason}</span>}
                    </div>
                    <span style={{ fontSize:"10px", color:D.text3, fontFamily:"'JetBrains Mono',monospace" }}>
                      {new Date(h.ts).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop:"20px", paddingTop:"16px", borderTop:"1px solid rgba(139,92,246,0.1)", display:"flex", justifyContent:"space-around" }}>
          {[{icon:"✨",l:"Smart Search"},{icon:"🏆",l:"AI Scores"},{icon:"🗺️",l:"Maps & MLS"},{icon:"💬",l:"AI Chat"}].map(f=>(
            <div key={f.l} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:"4px" }}>
              <span style={{ fontSize:"18px" }}>{f.icon}</span>
              <span style={{ fontSize:"10px",color:"#475569",fontWeight:500 }}>{f.l}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop:"18px",fontSize:"12px",color:"#1e293b",fontFamily:"'JetBrains Mono',monospace",textAlign:"center" }}>
        NetFlow v1.0 · The Prompt Engineers Spring 2026
      </div>
    </div>
  );
}

// ── USER MENU ──────────────────────────────────────────────────
function UserMenu({
  user, onLogout, loginHistory, searchHistory, onClearSearch,
}: {
  user: DBUser;
  onLogout: () => void;
  loginHistory: LoginRecord[];
  searchHistory: SearchRecord[];
  onClearSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab,  setTab]  = useState<"logins"|"searches">("logins");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={menuRef} style={{ position:"relative" }}>
      <button onClick={() => setOpen(v=>!v)}
        style={{ display:"flex", alignItems:"center", gap:"8px", padding:"6px 12px", borderRadius:"10px", background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.25)", color:"#f1f5f9", cursor:"pointer", fontFamily:"inherit", transition:"all 0.18s" }}
        onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(139,92,246,0.2)";}}
        onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(139,92,246,0.1)";}}>
        <div style={{ width:"26px", height:"26px", borderRadius:"50%", background:"linear-gradient(135deg,#7c3aed,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"13px" }}>
          {(user.displayName||user.username)[0].toUpperCase()}
        </div>
        <div style={{ textAlign:"left" }}>
          <div style={{ fontSize:"13px", fontWeight:600 }}>{user.displayName||user.username}</div>
          <div style={{ fontSize:"10px", color:D.text3 }}>{user.role}</div>
        </div>
        <span style={{ fontSize:"11px", color:D.text3 }}>▼</span>
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, width:"340px", background:"#1a1d2e", border:"1px solid rgba(139,92,246,0.25)", borderRadius:"14px", boxShadow:"0 8px 40px rgba(0,0,0,0.5)", zIndex:200, overflow:"hidden" }}>
          {/* Header */}
          <div style={{ padding:"14px 16px", borderBottom:"1px solid rgba(139,92,246,0.1)", display:"flex", alignItems:"center", gap:"10px" }}>
            <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:"linear-gradient(135deg,#7c3aed,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px" }}>
              {(user.displayName||user.username)[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize:"14px", fontWeight:700, color:"#f1f5f9" }}>{user.displayName||user.username}</div>
              <div style={{ fontSize:"11px", color:D.text3 }}>@{user.username} · {user.role}</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", borderBottom:"1px solid rgba(139,92,246,0.1)" }}>
            {(["logins","searches"] as const).map(t => (
              <button key={t} onClick={()=>setTab(t)}
                style={{ flex:1, padding:"9px", fontSize:"12px", fontWeight:600, border:"none", cursor:"pointer", fontFamily:"inherit", background:tab===t?"rgba(139,92,246,0.15)":"transparent", color:tab===t?"#a78bfa":D.text3, borderBottom:tab===t?`2px solid ${D.primaryHi}`:"2px solid transparent", transition:"all 0.15s" }}>
                {t==="logins"?"🔐 Login History":"🔍 Search History"}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ maxHeight:"240px", overflowY:"auto", padding:"8px" }}>
            {tab==="logins" && (
              loginHistory.length === 0
                ? <div style={{ fontSize:"12px", color:D.text3, padding:"12px 8px" }}>No login history yet.</div>
                : loginHistory.slice(0,15).map((h,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 8px", borderRadius:"7px", marginBottom:"3px", background:h.success?"rgba(16,185,129,0.05)":"rgba(239,68,68,0.05)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
                      <span>{h.success?"✅":"❌"}</span>
                      <span style={{ fontSize:"12px", fontWeight:600, color:h.success?D.green:D.red }}>{h.success?"Success":"Failed"}</span>
                      {!h.success && <span style={{ fontSize:"11px", color:D.text3 }}>— {h.reason}</span>}
                    </div>
                    <span style={{ fontSize:"10px", color:D.text3, fontFamily:"'JetBrains Mono',monospace" }}>
                      {new Date(h.ts).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                    </span>
                  </div>
                ))
            )}
            {tab==="searches" && (
              searchHistory.length === 0
                ? <div style={{ fontSize:"12px", color:D.text3, padding:"12px 8px" }}>No searches yet.</div>
                : <>
                  {searchHistory.slice(0,15).map((h,i) => (
                    <div key={i} style={{ padding:"8px", borderRadius:"7px", marginBottom:"3px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(139,92,246,0.1)" }}>
                      <div style={{ fontSize:"12px", fontWeight:600, color:"#f1f5f9", marginBottom:"3px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        🔍 {h.prompt}
                      </div>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:"10px", color:D.text3 }}>
                        <span>{h.resultCount} results</span>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace" }}>
                          {new Date(h.ts).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                        </span>
                      </div>
                    </div>
                  ))}
                  <button onClick={onClearSearch}
                    style={{ width:"100%", marginTop:"4px", fontSize:"11px", color:D.text3, background:"none", border:`1px solid ${D.border}`, borderRadius:"6px", padding:"5px", cursor:"pointer", fontFamily:"inherit" }}>
                    🗑️ Clear search history
                  </button>
                </>
            )}
          </div>

          {/* Sign out */}
          <div style={{ padding:"8px", borderTop:"1px solid rgba(139,92,246,0.1)" }}>
            <button onClick={onLogout}
              style={{ width:"100%", padding:"9px", borderRadius:"8px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", color:D.red, fontSize:"13px", fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:"6px" }}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN DASHBOARD ─────────────────────────────────────────────
export default function Home() {
  const [currentUser, setCurrentUser] = useState<DBUser | null>(null);
  const [result,      setResult]      = useState<SearchResult | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [statusMsg,   setStatusMsg]   = useState("");
  const [aiText,      setAiText]      = useState("");
  const [streaming,   setStreaming]   = useState(false);
  const [chatProp,    setChatProp]    = useState<Property | null>(null);
  const [lastQuery,   setLastQuery]   = useState("");
  const [tab,         setTab]         = useState<"list"|"charts">("list");
  const [loginHist,   setLoginHist]   = useState<LoginRecord[]>([]);
  const [searchHist,  setSearchHist]  = useState<SearchRecord[]>([]);
  const aiTextRef = useRef("");

  // Load histories after login
  const loadHistories = useCallback(async (username: string) => {
    const [lh, sh] = await Promise.all([
      getLoginHistory(username),
      getSearchHistory(username),
    ]);
    setLoginHist(lh);
    setSearchHist(sh);
  }, []);

  const handleLogin = useCallback(async (user: DBUser) => {
    setCurrentUser(user);
    await loadHistories(user.username);
  }, [loadHistories]);

  const handleLogout = useCallback(async () => {
    if (currentUser) {
      await recordLogin({ username: currentUser.username, ts: Date.now(), success: false, reason: "User signed out" });
    }
    setCurrentUser(null);
    setResult(null);
    setAiText("");
    setChatProp(null);
    setLastQuery("");
  }, [currentUser]);

  const handleClearSearchHistory = useCallback(async () => {
    if (!currentUser) return;
    await clearSearchHistory(currentUser.username);
    setSearchHist([]);
  }, [currentUser]);

  if (!currentUser) return <LoginPage onLogin={handleLogin} />;

  const handleSearch = async (params: SearchParams & { prompt_text?: string }) => {
    setLastQuery(params.prompt_text || params.zip_code || "");

    // ── Check cache ──────────────────────────────────────────
    const cached = getCachedResult(params);
    if (cached) {
      const r = cached as SearchResult;
      setResult(r);
      setAiText(r.market_summary || "");
      setStreaming(false); setStatusMsg(""); setChatProp(null);
      return;
    }

    setLoading(true); setResult(null); setAiText(""); setStreaming(false);
    setChatProp(null); aiTextRef.current = "";
    setStatusMsg("Starting search...");

    try {
      const res = await fetch(`${API_BASE}/api/search/stream`, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      if (!res.body) return;

      const reader = res.body.getReader(); const decoder = new TextDecoder();
      let partial: Partial<SearchResult> = {};

      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        const lines = decoder.decode(value).split("\n").filter(l=>l.startsWith("data: "));
        for (const line of lines) {
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type==="status")      setStatusMsg(ev.msg);
            else if (ev.type==="properties") {
              partial = {...partial, properties:ev.data, mortgage_rate:ev.mortgage_rate, zip_code:ev.zip_code, location_display:ev.location_display};
              setResult(partial as SearchResult);
              setLoading(false); setStreaming(true); setTab("list");
              setCachedResult(params, partial as SearchResult);
              // Record to DB search history
              if (currentUser) {
                recordSearch({
                  username:    currentUser.username,
                  prompt:      params.prompt_text || params.zip_code || "",
                  params:      params as unknown as Record<string,unknown>,
                  resultCount: ev.data?.length || 0,
                  ts:          Date.now(),
                }).then(() => getSearchHistory(currentUser.username).then(setSearchHist));
              }
            }
            else if (ev.type==="ai_token") {
              setAiText(p => { const t = p + ev.token; aiTextRef.current = t; return t; });
            }
            else if (ev.type==="done") {
              setStatusMsg(""); setStreaming(false);
              setResult(prev => {
                if (prev) {
                  const updated = {...prev, market_summary: aiTextRef.current};
                  setCachedResult(params, updated);
                  return updated;
                }
                return prev;
              });
            }
            else if (ev.type==="error") { setStatusMsg(`❌ ${ev.msg}`); setLoading(false); }
          } catch(_) {}
        }
      }
    } catch (e: unknown) {
      setStatusMsg(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
      setLoading(false);
    }
  };

  const H = "60px";

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column", background:"#0d0f1a", fontFamily:"Inter,sans-serif", color:"#e2e8f0" }}>

      {/* HEADER */}
      <div style={{ height:H, padding:"0 24px", borderBottom:"1px solid rgba(139,92,246,0.12)", display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(19,22,32,0.98)", position:"sticky", top:0, zIndex:100, backdropFilter:"blur(12px)", flexShrink:0, boxShadow:"0 1px 20px rgba(0,0,0,0.4)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ width:"34px", height:"34px", borderRadius:"9px", background:"linear-gradient(135deg,#7c3aed,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"17px", boxShadow:"0 2px 10px rgba(124,58,237,0.4)" }}>🏘️</div>
          <div>
            <div style={{ fontSize:"20px", fontWeight:800, letterSpacing:"-0.3px", color:"#f1f5f9", lineHeight:1 }}>Net<span style={{ color:"#8b5cf6" }}>Flow</span></div>
            <div style={{ fontSize:"10px", color:"#475569", fontFamily:"'JetBrains Mono',monospace" }}>AI-powered real estate intelligence</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          {result && (
            <div style={{ display:"flex", alignItems:"center", gap:"5px", padding:"4px 11px", borderRadius:"20px", background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)", fontSize:"12px", fontWeight:600, color:"#34d399" }}>
              <div style={{ width:"6px", height:"6px", borderRadius:"50%", background:"#10b981" }}/>
              {result.properties.length} properties · {result.location_display||result.zip_code}
            </div>
          )}
          <UserMenu
            user={currentUser}
            onLogout={handleLogout}
            loginHistory={loginHist}
            searchHistory={searchHist}
            onClearSearch={handleClearSearchHistory}
          />
        </div>
      </div>

      {/* BODY */}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* SIDEBAR */}
        <div style={{ width:"300px", minWidth:"300px", padding:"18px 14px", borderRight:"1px solid rgba(139,92,246,0.12)", background:"#131620", height:`calc(100vh - ${H})`, overflowY:"auto", position:"sticky", top:H, flexShrink:0 }}>
          <SearchPanel
            onSearch={handleSearch}
            loading={loading}
            statusMsg={statusMsg}
            searchHistory={searchHist}
            onHistorySelect={(p) => {
                // Re-trigger search when history item clicked
                handleSearch({ zip_code:"75070", budget:450000, property_type:"SFH", min_beds:3, strategy:"LTR", prompt_text: p });
              }}
          />
        </div>

        {/* MAIN CONTENT */}
        <div style={{ flex:1, padding:"18px 20px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"16px", minWidth:0 }}>

          {!result && !loading && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:"16px", padding:"80px 40px", textAlign:"center", border:"1px dashed rgba(139,92,246,0.15)", borderRadius:"16px", background:"rgba(255,255,255,0.01)" }}>
              <div style={{ fontSize:"56px", opacity:0.2 }}>🏘️</div>
              <div style={{ fontSize:"20px", fontWeight:700, color:"#475569" }}>Smart Property Search</div>
              <div style={{ fontSize:"14px", color:"#334155", lineHeight:1.8, maxWidth:"440px" }}>
                Type a <strong style={{ color:"#8b5cf6" }}>ZIP</strong>, <strong style={{ color:"#8b5cf6" }}>city/state</strong>, or <strong style={{ color:"#8b5cf6" }}>full description</strong> in the sidebar — or use the 🎤 mic button to speak your search.
              </div>
            </div>
          )}

          {loading && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"16px", padding:"80px 40px", background:"rgba(255,255,255,0.01)", borderRadius:"16px", border:"1px solid rgba(139,92,246,0.1)" }}>
              <div className="spinner"/>
              <div style={{ fontSize:"14px", color:"#64748b", fontFamily:"'JetBrains Mono',monospace" }}>{statusMsg}</div>
            </div>
          )}

          {result && (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap" }}>
                {lastQuery && (
                  <div style={{ padding:"4px 12px", borderRadius:"20px", background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.25)", fontSize:"12px", fontWeight:600, color:"#a78bfa", display:"flex", alignItems:"center", gap:"4px" }}>
                    <span>✨</span>"{lastQuery}"
                  </div>
                )}
                <div style={{ fontSize:"11px", color:"#475569", fontFamily:"'JetBrains Mono',monospace" }}>
                  {result.location_display||result.zip_code} · ${result.search_params?.budget?.toLocaleString()} · {new Date().toLocaleDateString()}
                </div>
              </div>

              <AIAnalysisCard text={aiText} mortgageRate={result.mortgage_rate} streaming={streaming}/>

              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"10px" }}>
                <div>
                  <div style={{ fontSize:"17px", fontWeight:700, color:"#f1f5f9" }}>🏆 Top 10 Investment Properties</div>
                  <div style={{ fontSize:"11px", color:"#475569", fontFamily:"'JetBrains Mono',monospace", marginTop:"1px" }}>Sorted by AI score · click a card for 🗺️ map + 📋 MLS + 💬 AI chat</div>
                </div>
                <div style={{ display:"flex", gap:"4px", background:"rgba(255,255,255,0.04)", padding:"4px", borderRadius:"10px", border:"1px solid rgba(139,92,246,0.12)" }}>
                  {(["list","charts"] as const).map(t=>(
                    <button key={t} onClick={()=>setTab(t)} style={{ padding:"6px 14px", borderRadius:"7px", fontSize:"12px", fontWeight:600, border:"none", cursor:"pointer", fontFamily:"inherit", background:tab===t?"rgba(139,92,246,0.2)":"transparent", color:tab===t?"#a78bfa":"#64748b", boxShadow:tab===t?"0 1px 6px rgba(124,58,237,0.2)":"none", transition:"all 0.18s" }}>
                      {t==="list"?"📋 Properties":"📊 Charts"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display:"flex", gap:"16px", alignItems:"flex-start" }}>
                <div style={{ flex: chatProp?"0 0 52%":"1", minWidth:0, transition:"all 0.3s" }}>
                  {tab==="list" && (
                    <PropertyGrid
                      properties={result.properties}
                      onSelectProperty={p=>setChatProp(chatProp?.address===p.address?null:p)}
                      selectedProperty={chatProp}
                    />
                  )}
                  {tab==="charts" && <ComparisonCharts properties={result.properties} compact={!!chatProp}/>}
                </div>

                {!chatProp && tab==="list" && (
                  <div style={{ flex:1, minWidth:0, position:"sticky", top:`calc(${H} + 18px)`, maxHeight:`calc(100vh - ${H} - 36px)`, overflowY:"auto" }}>
                    <ComparisonCharts properties={result.properties} compact={true}/>
                  </div>
                )}
                {chatProp && (
                  <div style={{ flex:"0 0 46%", minWidth:"340px", height:"calc(100vh - 110px)", position:"sticky", top:`calc(${H} + 18px)` }}>
                    <PropertyChat property={chatProp} mortgageRate={result.mortgage_rate||7.2} onClose={()=>setChatProp(null)}/>
                  </div>
                )}
              </div>

              {tab==="list" && (
                <div style={{ padding:"10px 14px", borderRadius:"10px", background:"rgba(139,92,246,0.06)", border:"1px solid rgba(139,92,246,0.15)", fontSize:"12px", color:"#a78bfa", fontWeight:500, display:"flex", alignItems:"center", gap:"8px" }}>
                  <span>💡</span>
                  Click <strong style={{ color:"#c4b5fd" }}>🗺️ Map</strong> to see location · <strong style={{ color:"#c4b5fd" }}>📋 MLS</strong> for listing details · any card for AI analyst
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

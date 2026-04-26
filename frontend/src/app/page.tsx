"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { log, logger } from "@/lib/logger";
import SearchPanel, { getCachedResult, setCachedResult } from "@/components/SearchPanel";
import PropertyGrid from "@/components/PropertyGrid";
import ComparisonCharts from "@/components/ComparisonCharts";
import PropertyChat from "@/components/PropertyChat";
import type { SearchParams, SearchResult, Property } from "@/lib/types";
import AgentPanel from "@/components/AgentPanel";
import {
  seedDefaultUser, validateLogin, recordLogin, recordSearch,
  getLoginHistory, getSearchHistory, clearSearchHistory,
  getFavorites, addFavorite, removeFavorite,
  type LoginRecord, type SearchRecord, type DBUser,
} from "@/lib/db";

const API_BASE = typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

// ─── Theme Toggle ────────────────────────────────────────────────
function ThemeToggle({ theme, onToggle }:{ theme:string; onToggle:()=>void }) {
  return (
    <button onClick={onToggle} title={`Switch to ${theme==="dark"?"light":"dark"} mode`}
      aria-label="Toggle theme"
      style={{width:"36px",height:"36px",borderRadius:"9px",background:"var(--bg-raise)",border:"1px solid var(--bd)",color:"var(--t2)",cursor:"pointer",fontSize:"17px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
      {theme==="dark"?"☀️":"🌙"}
    </button>
  );
}

// ─── Login Page ───────────────────────────────────────────────────
function LoginPage({ onLogin, theme, onToggleTheme }:{
  onLogin:(u:DBUser)=>void; theme:string; onToggleTheme:()=>void;
}) {
  const [user,  setUser]  = useState("");
  const [pw,    setPw]    = useState("");
  const [showPw,setShowPw]= useState(false);
  const [err,   setErr]   = useState("");
  const [busy,  setBusy]  = useState(false);
  const [hist,  setHist]  = useState<LoginRecord[]>([]);
  const [showH, setShowH] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(()=>{
    log.auth("LoginPage mounted");
    seedDefaultUser().then(()=>{ setReady(true); getLoginHistory().then(h=>setHist(h.slice(0,10))); });
  },[]);

  const doLogin = async()=>{
    const u=user.trim(), p=pw.trim();
    if(!u||!p){ setErr("Username and password required."); return; }
    setErr(""); setBusy(true);
    log.auth("Login attempt",{username:u});
    try {
      const dbUser = await validateLogin(u,p);
      if(dbUser){
        await recordLogin({username:u,ts:Date.now(),success:true});
        log.auth("Login success",{username:u,role:dbUser.role});
        onLogin(dbUser);
      } else {
        await recordLogin({username:u,ts:Date.now(),success:false,reason:"Invalid credentials"});
        log.warn("auth","Login failed",{username:u});
        setErr("Invalid username or password.");
        setHist(await getLoginHistory().then(h=>h.slice(0,10)));
      }
    } catch(e){ log.err("auth","Login error",{e:String(e)}); setErr("Login error — try again."); }
    finally { setBusy(false); }
  };

  const inp:React.CSSProperties={background:"var(--bg-raise)",border:`1px solid ${err?"var(--red)":"var(--bd)"}`,borderRadius:"10px",padding:"12px 14px",color:"var(--t1)",fontSize:"15px",fontFamily:"Inter,sans-serif",outline:"none",width:"100%"};

  return (
    <div style={{minHeight:"100vh",background:"var(--bg-base)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px",position:"relative"}}>
      <div style={{position:"fixed",top:"16px",right:"16px",zIndex:100}}><ThemeToggle theme={theme} onToggle={onToggleTheme}/></div>

      <div style={{width:"100%",maxWidth:"420px",background:"var(--bg-surf)",border:"1px solid var(--bd)",borderRadius:"20px",padding:"clamp(24px,5vw,44px) clamp(20px,5vw,40px)",boxShadow:"var(--shd)",position:"relative"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:"linear-gradient(90deg,#2563eb,#4f9eff,#06b6d4)",borderRadius:"20px 20px 0 0"}}/>
        <div style={{textAlign:"center",marginBottom:"26px"}}>
          <div style={{width:"62px",height:"62px",borderRadius:"17px",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"28px",margin:"0 auto 12px",boxShadow:"0 6px 20px rgba(124,58,237,0.4)"}}>🏘️</div>
          <div style={{fontSize:"30px",fontWeight:800,color:"var(--t1)"}}>Net<span style={{color:"var(--pri-hi)"}}>Flow</span></div>
          <div style={{fontSize:"12px",color:"var(--t3)",fontWeight:500,marginTop:"2px"}}>Real Estate Investment Intelligence</div>
        </div>

        <div style={{fontSize:"16px",fontWeight:700,color:"var(--t1)",marginBottom:"3px"}}>Welcome back</div>
        <div style={{fontSize:"13px",color:"var(--t3)",marginBottom:"18px"}}>Sign in to your dashboard</div>

        <div style={{marginBottom:"13px"}}>
          <label style={{fontSize:"13px",fontWeight:600,color:"var(--t2)",display:"block",marginBottom:"6px"}}>👤 Username</label>
          <input type="text" value={user} onChange={e=>setUser(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="Enter username" style={inp} autoComplete="username"
            onFocus={e=>{e.target.style.borderColor="var(--bd-hi)";e.target.style.boxShadow="0 0 0 3px rgba(37,99,235,.14)";}}
            onBlur={e=>{e.target.style.borderColor=err?"var(--red)":"var(--bd)";e.target.style.boxShadow="none";}}/>
        </div>

        <div style={{marginBottom:"18px"}}>
          <label style={{fontSize:"13px",fontWeight:600,color:"var(--t2)",display:"block",marginBottom:"6px"}}>🔒 Password</label>
          <div style={{position:"relative"}}>
            <input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="Enter password" style={{...inp,paddingRight:"44px"}} autoComplete="current-password"
              onFocus={e=>{e.target.style.borderColor="var(--bd-hi)";e.target.style.boxShadow="0 0 0 3px rgba(37,99,235,.14)";}}
              onBlur={e=>{e.target.style.borderColor=err?"var(--red)":"var(--bd)";e.target.style.boxShadow="none";}}/>
            <button onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:"12px",top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:"16px"}}>{showPw?"🙈":"👁"}</button>
          </div>
        </div>

        {err && <div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",borderRadius:"8px",padding:"10px 14px",fontSize:"13px",color:"var(--red)",marginBottom:"14px"}}>⚠️ {err}</div>}

        <button onClick={doLogin} disabled={busy||!ready} style={{width:"100%",padding:"13px",borderRadius:"10px",background:busy?"rgba(37,99,235,.4)":"linear-gradient(135deg,var(--pri),#1e40af)",border:"1px solid var(--bd-hi)",color:"#fff",fontSize:"15px",fontWeight:700,cursor:busy?"not-allowed":"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",boxShadow:busy?"none":"0 4px 22px rgba(37,99,235,.4)"}}>
          {busy?<><div style={{width:"16px",height:"16px",border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .75s linear infinite"}}/>Signing in...</>:<>🔐 Sign In</>}
        </button>

        {hist.length>0&&(
          <div style={{marginTop:"18px"}}>
            <button onClick={()=>setShowH(v=>!v)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"none",border:"none",cursor:"pointer",padding:0}}>
              <span style={{fontSize:"11px",fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".6px"}}>🕑 Recent Login Activity</span>
              <span style={{fontSize:"11px",color:"var(--t3)"}}>{showH?"▲":"▼"}</span>
            </button>
            {showH&&(
              <div style={{marginTop:"8px",display:"flex",flexDirection:"column",gap:"4px",maxHeight:"140px",overflowY:"auto"}}>
                {hist.map((h,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 9px",borderRadius:"7px",background:h.success?"rgba(16,185,129,.06)":"rgba(239,68,68,.06)",border:`1px solid ${h.success?"rgba(34,197,94,.22)":"rgba(239,68,68,.2)"}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
                      <span style={{fontSize:"11px"}}>{h.success?"✅":"❌"}</span>
                      <span style={{fontSize:"11px",fontWeight:600,color:h.success?"var(--grn)":"var(--red)"}}>{h.username}</span>
                      {!h.success&&<span style={{fontSize:"10px",color:"var(--t3)"}}>— {h.reason}</span>}
                    </div>
                    <span style={{fontSize:"10px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}}>{new Date(h.ts).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{marginTop:"20px",paddingTop:"16px",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"space-around"}}>
          {[{icon:"✨",l:"Smart Search"},{icon:"🏆",l:"Scores"},{icon:"🗺️",l:"Maps"},{icon:"💬",l:"Chat"}].map(f=>(
            <div key={f.l} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"4px"}}>
              <span style={{fontSize:"18px"}}>{f.icon}</span>
              <span style={{fontSize:"10px",color:"var(--t3)",fontWeight:500}}>{f.l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── User Menu ─────────────────────────────────────────────────
function UserMenu({ user,onLogout,loginHistory,searchHistory,onClearSearch }:{
  user:DBUser;onLogout:()=>void;loginHistory:LoginRecord[];searchHistory:SearchRecord[];onClearSearch:()=>void;
}) {
  const [open,setOpen]=useState(false);
  const [tab, setTab] =useState<"logins"|"searches">("logins");
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:MouseEvent)=>{ if(ref.current&&!ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h);
  },[]);
  return(
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(v=>!v)} style={{display:"flex",alignItems:"center",gap:"7px",padding:"5px 10px",borderRadius:"9px",background:"var(--bg-raise)",border:"1px solid var(--bd)",color:"var(--t1)",cursor:"pointer",fontFamily:"inherit"}}>
        <div style={{width:"24px",height:"24px",borderRadius:"50%",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",color:"#fff",fontWeight:700}}>
          {(user.displayName||user.username)[0].toUpperCase()}
        </div>
        <span style={{fontSize:"13px",fontWeight:600,maxWidth:"90px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} className="hide-mob">
          {user.displayName||user.username}
        </span>
        <span style={{fontSize:"10px",color:"var(--t3)"}} className="hide-mob">▼</span>
      </button>
      {open&&(
        <div className="pop-in" style={{position:"absolute",top:"calc(100% + 8px)",right:0,width:"310px",background:"var(--bg-raise)",border:"1px solid var(--bd-hi)",borderRadius:"14px",boxShadow:"var(--shd)",zIndex:500,overflow:"hidden"}}>
          <div style={{padding:"12px 14px",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",gap:"10px"}}>
            <div style={{width:"33px",height:"33px",borderRadius:"50%",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",color:"#fff",fontWeight:700}}>
              {(user.displayName||user.username)[0].toUpperCase()}
            </div>
            <div>
              <div style={{fontSize:"13px",fontWeight:700,color:"var(--t1)"}}>{user.displayName||user.username}</div>
              <div style={{fontSize:"11px",color:"var(--t3)"}}>@{user.username} · {user.role}</div>
            </div>
          </div>
          <div style={{display:"flex",borderBottom:"1px solid var(--bd)"}}>
            {(["logins","searches"] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"8px",fontSize:"11px",fontWeight:600,border:"none",cursor:"pointer",fontFamily:"inherit",background:tab===t?"rgba(37,99,235,.10)":"transparent",color:tab===t?"var(--pri-hi)":"var(--t3)",borderBottom:tab===t?"2px solid var(--pri-hi)":"2px solid transparent"}}>
                {t==="logins"?"🔐 Logins":"🔍 Searches"}
              </button>
            ))}
          </div>
          <div style={{maxHeight:"210px",overflowY:"auto",padding:"8px"}}>
            {tab==="logins"&&(loginHistory.length===0
              ?<div style={{fontSize:"12px",color:"var(--t3)",padding:"10px 8px"}}>No login history.</div>
              :loginHistory.slice(0,12).map((h,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 8px",borderRadius:"7px",marginBottom:"3px",background:h.success?"rgba(16,185,129,.05)":"rgba(239,68,68,.05)"}}>
                  <span style={{fontSize:"11px",fontWeight:600,color:h.success?"var(--grn)":"var(--red)"}}>{h.success?"✅ Success":"❌ Failed"}</span>
                  <span style={{fontSize:"10px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}}>{new Date(h.ts).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                </div>
              ))
            )}
            {tab==="searches"&&(searchHistory.length===0
              ?<div style={{fontSize:"12px",color:"var(--t3)",padding:"10px 8px"}}>No searches yet.</div>
              :<>{searchHistory.slice(0,12).map((h,i)=>(
                <div key={i} style={{padding:"7px 8px",borderRadius:"7px",marginBottom:"3px",background:"var(--bg-surf)",border:"1px solid var(--bd)"}}>
                  <div style={{fontSize:"11px",fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🔍 {h.prompt}</div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:"var(--t3)",marginTop:"2px"}}>
                    <span>{h.resultCount} results</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{new Date(h.ts).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                  </div>
                </div>
              ))}
              <button onClick={onClearSearch} style={{width:"100%",marginTop:"4px",fontSize:"11px",color:"var(--t3)",background:"none",border:`1px solid var(--bd)`,borderRadius:"6px",padding:"5px",cursor:"pointer",fontFamily:"inherit"}}>🗑️ Clear search history</button>
              </>
            )}
          </div>
          <div style={{padding:"8px",borderTop:"1px solid var(--bd)"}}>
            <button onClick={onLogout} style={{width:"100%",padding:"9px",borderRadius:"8px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",color:"var(--red)",fontSize:"13px",fontWeight:600,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App Log Viewer ────────────────────────────────────────────
function LogViewer({ onClose }:{ onClose:()=>void }) {
  const [entries, setEntries] = useState<Array<{ts:number;level:string;category:string;message:string}>>([]);
  useEffect(()=>{
    setEntries([...logger.getBuffer()].reverse().slice(0,80));
  },[]);
  return (
    <div className="pop-in" style={{position:"fixed",inset:0,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.6)"}}>
      <div style={{width:"clamp(320px,90vw,700px)",maxHeight:"80vh",background:"var(--bg-surf)",border:"1px solid var(--bd-hi)",borderRadius:"16px",overflow:"hidden",boxShadow:"var(--shd)",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"14px 18px",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:"14px",fontWeight:700,color:"var(--t1)"}}>🪵 Application Log</div>
            <div style={{fontSize:"11px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}}>Last {entries.length} entries (ring buffer 200 max)</div>
          </div>
          <button onClick={onClose} style={{background:"var(--bg-raise)",border:"1px solid var(--bd)",color:"var(--t1)",borderRadius:"8px",padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>✕ Close</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"10px 14px"}}>
          {entries.length===0
            ? <div style={{fontSize:"12px",color:"var(--t3)",padding:"20px",textAlign:"center"}}>No log entries yet.</div>
            : entries.map((e,i)=>(
              <div key={i} className={`log-row log-${e.level}`}>
                <span style={{color:"var(--t3)",marginRight:"8px"}}>{new Date(e.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
                <span style={{color:e.level==="error"?"var(--red)":e.level==="warn"?"var(--amb)":"var(--pri-hi)",fontWeight:700,marginRight:"8px"}}>[{e.category.toUpperCase()}]</span>
                <span style={{color:"var(--t2)"}}>{e.message}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────
export default function Home() {
  const [theme,       setTheme]       = useState("dark");
  const [currentUser, setCurrentUser] = useState<DBUser|null>(null);
  const [result,      setResult]      = useState<SearchResult|null>(null);
  const [loading,     setLoading]     = useState(false);
  const [statusMsg,   setStatusMsg]   = useState("");
  const [chatProp,    setChatProp]    = useState<Property|null>(null);
  const [lastQuery,   setLastQuery]   = useState("");
  const [tab,         setTab]         = useState<"list"|"charts"|"favorites">("list");
  const [favAddresses,setFavAddresses]= useState<Set<string>>(new Set());
  const [favList,     setFavList]     = useState<Property[]>([]);
  const [loginHist,   setLoginHist]   = useState<LoginRecord[]>([]);
  const [searchHist,  setSearchHist]  = useState<SearchRecord[]>([]);
  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [clarifyMsg,     setClarifyMsg]     = useState("");
  const [suggestedPrompt,setSuggestedPrompt]= useState("");
  const [showLog,     setShowLog]     = useState(false);
  const [showAgent,   setShowAgent]   = useState(false);

  // Apply theme to <html>
  useEffect(()=>{
    document.documentElement.setAttribute("data-theme", theme);
    log.ui("Theme changed",{theme});
  },[theme]);

  const toggleTheme = useCallback(()=>setTheme(t=>t==="dark"?"light":"dark"),[]);

  const loadHistories = useCallback(async(username:string)=>{
    const [lh,sh,favs] = await Promise.all([getLoginHistory(username),getSearchHistory(username),getFavorites(username)]);
    setLoginHist(lh); setSearchHist(sh);
    setFavAddresses(new Set(favs.map(f=>f.address)));
    setFavList(favs.map(f=>f.property as unknown as Property));
  },[]);

  const handleLogin = useCallback(async(user:DBUser)=>{
    setCurrentUser(user); await loadHistories(user.username);
  },[loadHistories]);

  const handleLogout = useCallback(async()=>{
    if(currentUser) await recordLogin({username:currentUser.username,ts:Date.now(),success:false,reason:"User signed out"});
    log.auth("User signed out");
    setCurrentUser(null); setResult(null); setChatProp(null); setLastQuery("");
    setFavAddresses(new Set()); setFavList([]);
  },[currentUser]);

  const toggleFavorite = useCallback((p:Property)=>{
    if(!currentUser) return;
    setFavAddresses(prev=>{
      const next=new Set(prev);
      if(next.has(p.address)){
        next.delete(p.address);
        removeFavorite(currentUser.username,p.address);
      } else {
        next.add(p.address);
        addFavorite({username:currentUser.username,address:p.address,property:p as unknown as Record<string,unknown>,ts:Date.now()});
      }
      return next;
    });
    setFavList(prev=>prev.some(f=>f.address===p.address)
      ? prev.filter(f=>f.address!==p.address)
      : [p,...prev]
    );
  },[currentUser]);

  const handleSelectProp       = useCallback((p:Property)=>setChatProp(p),[]);
  const handleSelectPropToggle = useCallback((p:Property)=>setChatProp(prev=>prev?.address===p.address?null:p),[]);

  const handleSearch = useCallback(async(params:SearchParams & {prompt_text?:string})=>{
    const queryLabel = params.prompt_text||params.zip_code||"";
    setLastQuery(queryLabel);
    log.search("Search initiated",{query:queryLabel,params});

    const cached = getCachedResult(params);
    if(cached){
      const r=cached as SearchResult;
      setResult(r); setStatusMsg(""); setChatProp(null);
      log.search("Cache hit",{query:queryLabel});
      return;
    }

    setLoading(true); setResult(null); setChatProp(null);
    setStatusMsg("Starting search..."); setClarifyMsg(""); setSuggestedPrompt("");
    setSidebarOpen(false);

    try {
      const res = await fetch(`${API_BASE}/api/search/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(params)});
      if(!res.ok) throw new Error(`Backend ${res.status}`);
      if(!res.body) return;
      const reader=res.body.getReader(); const dec=new TextDecoder("utf-8",{fatal:false});
      let partial:Partial<SearchResult>={market_summary:"",search_params:params};

      while(true){
        const {done,value}=await reader.read(); if(done) break;
        const lines=dec.decode(value,{stream:true}).split("\n").filter(l=>l.startsWith("data: "));
        for(const line of lines){
          try{
            const ev=JSON.parse(line.slice(6));
            if(ev.type==="clarify"){
              setStatusMsg(""); setLoading(false);
              setClarifyMsg(ev.msg||""); setSuggestedPrompt(ev.suggested_prompt||"");
              log.warn("search","Clarification needed",{msg:ev.msg});
            }
            else if(ev.type==="status")   { setStatusMsg(ev.msg); log.api("SSE status",{msg:ev.msg}); }
            else if(ev.type==="properties"){
              const nextResult: SearchResult = {
                properties: ev.data ?? [],
                mortgage_rate: ev.mortgage_rate ?? 0,
                zip_code: ev.zip_code ?? "",
                location_display: ev.location_display ?? "",
                request_id: ev.request_id ?? "",
                run_id: ev.run_id ?? "",
                market_summary: partial.market_summary ?? "",
                search_params: partial.search_params ?? params,
              };
              partial={...partial,...nextResult};
              setResult(nextResult); setLoading(false); setTab("list");
              setCachedResult(params,nextResult);
              log.search("Properties received",{count:ev.data?.length||0,zip:ev.zip_code});
              if(currentUser) recordSearch({username:currentUser.username,prompt:queryLabel,params:params as unknown as Record<string,unknown>,resultCount:ev.data?.length||0,ts:Date.now()}).then(()=>getSearchHistory(currentUser.username).then(setSearchHist));
            }
            else if(ev.type==="done")  { setStatusMsg(""); log.search("Search complete"); }
            else if(ev.type==="error") {
              const msg = String(ev.msg || "");
              const isGuidance = msg.includes("NetFlow is a real estate investment tool") || msg.includes("Try:");
              setLoading(false);
              if (isGuidance) {
                // Treat guardrail guidance as a clarification UX path, not a runtime error.
                setStatusMsg("");
                setClarifyMsg(msg);
                const tryIdx = msg.indexOf("Try:");
                setSuggestedPrompt(tryIdx >= 0 ? msg.slice(tryIdx + 4).trim() : "");
                log.warn("search", `SSE guidance: ${msg}`);
              } else {
                setStatusMsg(`❌ ${msg}`);
                log.err("search", `SSE error: ${msg}`);
              }
            }
          }catch(_){}
        }
      }
    }catch(e:unknown){
      const msg=e instanceof Error?e.message:"Unknown";
      setStatusMsg(`Error: ${msg}`); setLoading(false);
      log.err("search",`Search failed: ${msg}`);
    }
  },[currentUser]);

  const handleHistorySelect = useCallback((prompt:string)=>
    handleSearch({zip_code:"75070",budget:450000,property_type:"SFH",min_beds:3,strategy:"LTR",prompt_text:prompt})
  ,[handleSearch]);

  const displayProps = useMemo(()=>result?.properties.slice(0,5)??[],[result]);

  if(!currentUser) return <LoginPage onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme}/>;

  return (
    <div className="app-shell" style={{minHeight:"100vh"}}>

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="app-header">
        {/* Left: hamburger (mobile) + logo */}
        <div style={{display:"flex",alignItems:"center",gap:"10px",flexShrink:0}}>
          <button className="mob-btn" onClick={()=>setSidebarOpen(v=>!v)} aria-label="Open menu"
            style={{width:"34px",height:"34px",borderRadius:"8px",background:"var(--bg-raise)",border:"1px solid var(--bd)",color:"var(--t2)",cursor:"pointer",fontSize:"17px",display:"none",alignItems:"center",justifyContent:"center"}}>
            ☰
          </button>
          <div style={{width:"32px",height:"32px",borderRadius:"9px",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",boxShadow:"0 2px 10px rgba(37,99,235,.4)"}}>🏘️</div>
          <div>
            <div style={{fontSize:"18px",fontWeight:800,color:"var(--t1)",lineHeight:1}}>Net<span style={{color:"var(--pri-hi)"}}>Flow</span></div>
            <div style={{fontSize:"10px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}} className="hide-mob">Real estate investment</div>
          </div>
        </div>

        {/* Centre: scrolling market ticker */}
        <div className="hide-mob" style={{flex:1,overflow:"hidden",margin:"0 18px",height:"22px",display:"flex",alignItems:"center"}}>
          <span style={{display:"inline-block",whiteSpace:"nowrap",animation:"mq-ticker 35s linear infinite",fontSize:"11px",fontWeight:700,color:"var(--pri-hi)",letterSpacing:".9px"}}>
            📊&nbsp;MARKET SNAPSHOT&nbsp;·&nbsp;🏦&nbsp;30yr Fixed:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>7.2%</span>&nbsp;·&nbsp;📈&nbsp;Avg Cap Rate:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>5.8%</span>&nbsp;·&nbsp;💰&nbsp;Median Rent:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>$2,140/mo</span>&nbsp;·&nbsp;📅&nbsp;Avg DOM:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>28d</span>&nbsp;·&nbsp;🏠&nbsp;Median List:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>$389K</span>&nbsp;·&nbsp;📉&nbsp;Vacancy:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>5.1%</span>&nbsp;·&nbsp;💵&nbsp;P/R Ratio:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>15.2x</span>&nbsp;·&nbsp;🔑&nbsp;Cash-on-Cash:&nbsp;<span style={{color:"#ef4444",fontWeight:800}}>6.4%</span>&nbsp;&nbsp;&nbsp;
          </span>
        </div>

        {/* Right controls */}
        <div style={{display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
          {result&&(
            <div style={{display:"flex",alignItems:"center",gap:"4px",padding:"3px 9px",borderRadius:"20px",background:"rgba(34,197,94,.12)",border:"1px solid rgba(16,185,129,.25)",fontSize:"11px",fontWeight:600,color:"var(--grn)"}}>
              <div style={{width:"5px",height:"5px",borderRadius:"50%",background:"var(--grn)"}}/>
              <span className="hide-mob">Top {Math.min(result.properties.length,5)} · {result.location_display||result.zip_code}</span>
              <span className="show-mob">Top {Math.min(result.properties.length,5)}</span>
            </div>
          )}
          <button onClick={()=>setShowLog(true)} title="View application log"
            style={{width:"34px",height:"34px",borderRadius:"8px",background:"var(--bg-raise)",border:"1px solid var(--bd)",color:"var(--t3)",cursor:"pointer",fontSize:"14px",display:"flex",alignItems:"center",justifyContent:"center"}} className="hide-mob">
            🪵
          </button>
          <button onClick={()=>setShowAgent(true)} title="Pipeline & observability"
            style={{width:"34px",height:"34px",borderRadius:"8px",background:"var(--bg-raise)",border:"1px solid var(--bd)",color:"var(--t3)",cursor:"pointer",fontSize:"14px",display:"flex",alignItems:"center",justifyContent:"center"}} className="hide-mob">
            🤖
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme}/>
          <UserMenu user={currentUser} onLogout={handleLogout} loginHistory={loginHist} searchHistory={searchHist}
            onClearSearch={async()=>{ if(currentUser){await clearSearchHistory(currentUser.username);setSearchHist([]);log.ui("Search history cleared");}}}/>
        </div>
      </header>

      {/* ── BODY ───────────────────────────────────────────────── */}
      <div className="app-body">

        {/* Mobile overlay */}
        <div className={`mob-overlay${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)}/>

        {/* ── FROZEN LEFT PANEL ──────────────────────────────── */}
        <aside className={`sidebar${sidebarOpen?" open":""}`}>
          {/* Mobile close */}
          <div className="show-mob" style={{display:"none",alignItems:"center",justifyContent:"space-between",marginBottom:"14px",position:"absolute",top:"12px",left:"14px",right:"14px"}}>
            <span style={{fontSize:"14px",fontWeight:700,color:"var(--t1)"}}>Search</span>
            <button onClick={()=>setSidebarOpen(false)} style={{background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:"20px"}}>✕</button>
          </div>
          <SearchPanel onSearch={handleSearch} loading={loading} statusMsg={statusMsg} searchHistory={searchHist}
            onHistorySelect={handleHistorySelect}/>
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────────────── */}
        <main className="main-content">

          {/* Clarification banner */}
          {clarifyMsg&&!loading&&!result&&(
            <div style={{padding:"18px 20px",borderRadius:"14px",background:"rgba(245,158,11,.08)",
              border:"1px solid rgba(245,158,11,.35)",display:"flex",flexDirection:"column",gap:"12px"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:"10px"}}>
                <span style={{fontSize:"22px",flexShrink:0}}>💬</span>
                <div>
                  <div style={{fontSize:"14px",fontWeight:700,color:"var(--amb)",marginBottom:"5px"}}>
                    Need a bit more detail
                  </div>
                  <div style={{fontSize:"13px",color:"var(--t2)",lineHeight:1.7}}>{clarifyMsg}</div>
                </div>
              </div>
              {suggestedPrompt&&(
                <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                  <span style={{fontSize:"12px",color:"var(--t3)"}}>Try:</span>
                  <button
                    onClick={()=>handleSearch({zip_code:"",budget:450000,property_type:"SFH",min_beds:3,strategy:"LTR",prompt_text:suggestedPrompt})}
                    style={{padding:"6px 14px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:"rgba(245,158,11,.12)",border:"1px solid rgba(245,158,11,.35)",
                      color:"var(--amb)",cursor:"pointer",fontFamily:"inherit"}}>
                    ✨ {suggestedPrompt}
                  </button>
                  <button onClick={()=>{setClarifyMsg("");setSuggestedPrompt("");}}
                    style={{padding:"6px 10px",borderRadius:"8px",fontSize:"11px",
                      background:"none",border:"1px solid var(--bd)",color:"var(--t3)",
                      cursor:"pointer",fontFamily:"inherit"}}>
                    ✕ Dismiss
                  </button>
                </div>
              )}
            </div>
          )}


          {/* Loading */}
          {loading&&(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"16px",padding:"80px 24px",background:"var(--bg-surf)",borderRadius:"16px",border:"1px solid var(--bd)",boxShadow:"var(--shd-sm)"}}>
              <div className="spinner" style={{width:"44px",height:"44px",borderWidth:"4px"}}/>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:"14px",fontWeight:600,color:"var(--t2)",marginBottom:"4px"}}>Searching properties...</div>
                <div style={{fontSize:"12px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}}>{statusMsg}</div>
              </div>
            </div>
          )}

          {/* Results */}
          {result&&(
            <>
              {/* Query badge row */}
              <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                {lastQuery&&<div style={{padding:"3px 11px",borderRadius:"20px",background:"rgba(37,99,235,.12)",border:"1px solid rgba(37,99,235,.35)",fontSize:"12px",fontWeight:600,color:"var(--pri-hi)",display:"flex",alignItems:"center",gap:"4px"}}>✨ "{lastQuery}"</div>}
                <div style={{fontSize:"11px",color:"var(--t3)"}}>{result.location_display||result.zip_code} · {new Date().toLocaleDateString()}</div>
              </div>

              {/* Tab bar + title */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"8px"}}>
                <div>
                  <div style={{fontSize:"16px",fontWeight:700,color:"var(--t1)"}}>🏆 Top 5 Investment Properties</div>

                </div>
                <div style={{display:"flex",gap:"4px",background:"var(--bg-raise)",padding:"4px",borderRadius:"10px",border:"1px solid var(--bd)"}}>
                  {(["list","charts","favorites"] as const).map(t=>(
                    <button key={t} onClick={()=>{setTab(t);log.nav("Tab changed",{tab:t});}} style={{padding:"6px 14px",borderRadius:"7px",fontSize:"12px",fontWeight:600,border:"none",cursor:"pointer",fontFamily:"inherit",background:tab===t?"rgba(37,99,235,.18)":"transparent",color:tab===t?"var(--pri-hi)":"var(--t3)"}}>
                      {t==="list"?"📋 Cards":t==="charts"?"📊 Charts":`❤️ Saved${favList.length>0?` (${favList.length})`:""}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cards view */}
              {tab==="list"&&(
                <>
                  {/* Cards + optional chat split */}
                  {!chatProp&&(
                    <PropertyGrid properties={displayProps}
                      onSelectProperty={handleSelectProp}
                      selectedProperty={chatProp}
                      favorites={favAddresses}
                      onToggleFavorite={toggleFavorite}
                      runId={result.run_id}/>
                  )}
                  {chatProp&&(
                    <div style={{display:"flex",gap:"14px",alignItems:"flex-start",flexWrap:"wrap"}}>
                      <div style={{flex:"2 1 320px",minWidth:0,minHeight:0}}>
                        <PropertyGrid properties={displayProps}
                          onSelectProperty={handleSelectPropToggle}
                          selectedProperty={chatProp}
                          favorites={favAddresses}
                          onToggleFavorite={toggleFavorite}
                          runId={result.run_id}/>
                      </div>
                      <div style={{flex:"1 1 340px",minWidth:"320px",height:"calc(100dvh - 80px)",position:"sticky",top:"68px",overflowY:"hidden",display:"flex",flexDirection:"column"}}>
                        <PropertyChat property={chatProp} mortgageRate={result.mortgage_rate||7.2} onClose={()=>{setChatProp(null);log.ui("Chat closed");}}/>
                      </div>
                    </div>
                  )}


                </>
              )}

              {/* Charts view */}
              {tab==="charts"&&<ComparisonCharts properties={displayProps} compact={false}/>}

              {/* Favorites view */}
              {tab==="favorites"&&(
                favList.length===0
                  ? <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"12px",padding:"60px 20px",color:"var(--t3)",textAlign:"center"}}>
                      <div style={{fontSize:"48px"}}>❤️</div>
                      <div style={{fontSize:"16px",fontWeight:700,color:"var(--t2)"}}>No saved properties yet</div>
                      <div style={{fontSize:"13px"}}>Click the heart on any card to save it here</div>
                    </div>
                  : <PropertyGrid properties={favList}
                      onSelectProperty={handleSelectProp}
                      selectedProperty={chatProp}
                      favorites={favAddresses}
                      onToggleFavorite={toggleFavorite}
                      runId={result.run_id}/>
              )}
            </>
          )}
        </main>
      </div>


      {/* ── Log viewer modal ───────────────────────────────── */}
      {showLog&&<LogViewer onClose={()=>setShowLog(false)}/>}
      {showAgent&&<AgentPanel onClose={()=>setShowAgent(false)}/>}
    </div>
  );
}

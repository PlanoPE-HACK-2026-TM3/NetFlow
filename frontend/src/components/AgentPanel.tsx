"use client";
import { useState, useEffect } from "react";

const API_BASE = typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

interface ObsData {
  agents?:     Record<string,{role:string;memory:string;tools:string[];llm:string}>;
  pipeline:    Record<string,{name:string;type:string;tokens:string|number;latency?:string;model?:string}>;
  memory?:     Record<string,string>;
  tools?:      string[];
  security:    Record<string,string>;
  caching:     Record<string,string>;
  reliability: Record<string,string>;
  observability:  Record<string,string>;
  infrastructure: Record<string,string>;
}

function Badge({ v }:{ v:string }) {
  const col =
    v.includes("ollama")||v.includes("Live")||v.includes("Online") ? "#22c55e" :
    v.includes("rule")||v.includes("fallback")||v.includes("Mock")  ? "#f59e0b" :
    v.includes("deterministic")||v.includes("TTL")                  ? "#4f9eff" : "#5e7494";
  return <span style={{padding:"1px 7px",borderRadius:"5px",fontSize:"10px",fontWeight:700,
    background:col+"22",border:`1px solid ${col}55`,color:col}}>{v}</span>;
}

function Section({ title,icon,children }:{ title:string;icon:string;children:React.ReactNode }) {
  return (
    <div style={{marginBottom:"18px"}}>
      <div style={{fontSize:"12px",fontWeight:700,color:"var(--t2)",marginBottom:"9px",
        display:"flex",alignItems:"center",gap:"6px",paddingBottom:"6px",
        borderBottom:"1px solid var(--bd)"}}>
        <span style={{fontSize:"15px"}}>{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}

function KV({ k,v }:{ k:string;v:string }) {
  return (
    <div style={{display:"flex",gap:"8px",alignItems:"flex-start",marginBottom:"5px",flexWrap:"wrap"}}>
      <span style={{fontSize:"11px",fontWeight:600,color:"var(--t3)",minWidth:"140px",flexShrink:0}}>
        {k.replace(/_/g," ")}
      </span>
      <span style={{fontSize:"11px",color:"var(--t2)",flex:1}}>{v}</span>
    </div>
  );
}

const AGENT_ICONS = ["🔍","🏠","🛡️"];
const AGENT_KEYS  = ["market_analyst","property_scorer","risk_advisor"];
const AGENT_NAMES = ["Market Analyst","Property Scorer","Risk Advisor"];
const AGENT_COLORS= ["#4f9eff","#22c55e","#f43f5e"];

export default function AgentPanel({ onClose }:{ onClose:()=>void }) {
  const [data,    setData]    = useState<ObsData|null>(null);
  const [mcpData, setMcpData] = useState<Record<string,unknown>|null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [tab,     setTab]     = useState<"arch"|"pipeline"|"memory"|"security"|"mcp">("arch");

  useEffect(()=>{
    Promise.all([
      fetch(`${API_BASE}/api/observability`).then(r=>r.json()),
      fetch(`${API_BASE}/mcp/health`).then(r=>r.json()).catch(()=>null),
    ]).then(([obs, mcp])=>{
      setData(obs);
      setMcpData(mcp);
      setLoading(false);
    }).catch(e=>{ setError(String(e)); setLoading(false); });
  },[]);

  return (
    <div className="pop-in" style={{position:"fixed",inset:0,zIndex:900,
      display:"flex",alignItems:"center",justifyContent:"center",
      background:"rgba(0,0,0,.65)"}}>
      <div style={{width:"clamp(340px,92vw,900px)",maxHeight:"90vh",
        background:"var(--bg-surf)",border:"1px solid var(--bd-hi)",
        borderRadius:"16px",overflow:"hidden",boxShadow:"var(--shd)",
        display:"flex",flexDirection:"column"}}>

        {/* ── Header ── */}
        <div style={{padding:"15px 20px",borderBottom:"1px solid var(--bd)",
          flexShrink:0,background:"linear-gradient(135deg,rgba(37,99,235,.18),rgba(79,158,255,.08))",
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:"15px",fontWeight:700,color:"var(--t1)",display:"flex",
              alignItems:"center",gap:"8px"}}>
              🤖 NetFlow Agent System — Architecture
            </div>
            <div style={{fontSize:"11px",color:"var(--t3)",marginTop:"2px",
              fontFamily:"'JetBrains Mono',monospace"}}>
              3-agent orchestration · tool registry · memory · retrieval
            </div>
          </div>
          <button onClick={onClose} style={{background:"var(--bg-raise)",
            border:"1px solid var(--bd)",color:"var(--t1)",borderRadius:"8px",
            padding:"6px 13px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>
            ✕ Close
          </button>
        </div>

        {/* ── Tabs ── */}
        <div style={{display:"flex",borderBottom:"1px solid var(--bd)",flexShrink:0,
          background:"var(--bg-raise)"}}>
          {[["arch","🏗 Architecture"],["pipeline","⚙ Pipeline"],
            ["memory","🧠 Memory"],["security","🔒 Security"],["mcp","🔌 MCP"]].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id as typeof tab)}
              style={{padding:"9px 16px",fontSize:"12px",fontWeight:600,border:"none",
                cursor:"pointer",fontFamily:"inherit",
                background:tab===id?"var(--bg-surf)":"transparent",
                color:tab===id?"var(--pri-hi)":"var(--t3)",
                borderBottom:tab===id?"2px solid var(--pri-hi)":"2px solid transparent"}}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div style={{flex:1,overflowY:"auto",padding:"18px 20px"}}>
          {loading && <div style={{textAlign:"center",padding:"40px",color:"var(--t3)"}}>
            <div className="spinner" style={{margin:"0 auto 12px"}}/>Loading agent metadata...
          </div>}
          {error && <div style={{color:"var(--red)",padding:"20px",fontSize:"13px"}}>
            ⚠️ {error}<br/>Make sure the backend is running on port 8000.
          </div>}
          {data && (<>

            {/* ── TAB: Architecture ── */}
            {tab==="arch" && (<>
              {/* Orchestrator */}
              <div style={{padding:"12px 16px",borderRadius:"12px",
                background:"linear-gradient(135deg,rgba(37,99,235,.12),rgba(79,158,255,.06))",
                border:"1px solid rgba(79,158,255,.3)",marginBottom:"14px",textAlign:"center"}}>
                <div style={{fontSize:"14px",fontWeight:700,color:"var(--pri-hi)",marginBottom:"4px"}}>
                  🎯 Orchestrator — NetFlowAgent
                </div>
                <div style={{fontSize:"11px",color:"var(--t3)",lineHeight:1.6}}>
                  Routes intent → gates LLM availability → coordinates 3 sub-agents → accumulates AgentContext
                </div>
              </div>

              {/* Arrow */}
              <div style={{textAlign:"center",color:"var(--t3)",fontSize:"18px",marginBottom:"10px"}}>↓ dispatches to</div>

              {/* 3 agents */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px",marginBottom:"14px"}}>
                {AGENT_KEYS.map((key,i)=>{
                  const info = data.agents?.[key];
                  const col  = AGENT_COLORS[i];
                  return (
                    <div key={key} style={{padding:"13px 14px",borderRadius:"12px",
                      background:`${col}0e`,border:`1px solid ${col}44`}}>
                      <div style={{fontSize:"18px",marginBottom:"5px"}}>{AGENT_ICONS[i]}</div>
                      <div style={{fontSize:"12px",fontWeight:700,color:col,marginBottom:"5px"}}>
                        {AGENT_NAMES[i]}
                      </div>
                      {info && (<>
                        <div style={{fontSize:"10px",color:"var(--t2)",lineHeight:1.55,marginBottom:"7px"}}>
                          {info.role}
                        </div>
                        <div style={{fontSize:"10px",color:"var(--t3)",marginBottom:"4px",fontWeight:600}}>
                          🧠 Memory
                        </div>
                        <div style={{fontSize:"10px",color:"var(--t3)",marginBottom:"7px",lineHeight:1.4}}>
                          {info.memory}
                        </div>
                        <div style={{fontSize:"10px",color:"var(--t3)",fontWeight:600,marginBottom:"4px"}}>
                          🔧 Tools
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:"3px"}}>
                          {info.tools.map(t=>(
                            <span key={t} style={{padding:"1px 5px",borderRadius:"4px",
                              fontSize:"9px",fontWeight:600,
                              background:`${col}18`,border:`1px solid ${col}33`,
                              color:col,fontFamily:"'JetBrains Mono',monospace"}}>
                              {t}
                            </span>
                          ))}
                        </div>
                        <div style={{marginTop:"7px",fontSize:"10px",color:"var(--t3)",fontWeight:600}}>
                          🤖 LLM use: <span style={{color:"var(--t2)"}}>{info.llm}</span>
                        </div>
                      </>)}
                    </div>
                  );
                })}
              </div>

              {/* Decision logic box */}
              <div style={{padding:"12px 14px",borderRadius:"10px",
                background:"rgba(37,99,235,.06)",border:"1px solid rgba(79,158,255,.2)",
                fontSize:"11px",color:"var(--t2)",lineHeight:1.75}}>
                <strong style={{color:"var(--pri-hi)"}}>Decision logic:</strong>
                {" "}Orchestrator checks Ollama once per request.
                If available: Market Analyst fetches live data → Risk Advisor profiles all 10 props →
                Property Scorer runs 2 LLM calls (batch score + strategy rerank).
                If Ollama is offline: identical deterministic fallback at every stage — no user-visible difference.
                <br/>
                <strong style={{color:"var(--pri-hi)"}}>Injection defence:</strong>
                {" "}Raw user prompt NEVER reaches any LLM. Regex NLP parser extracts structured params;
                only numeric financial fields are sent to Ollama.
              </div>
            </>)}

            {/* ── TAB: Pipeline ── */}
            {tab==="pipeline" && (<>
              <Section title="Stage-by-Stage Pipeline" icon="⚙️">
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  {Object.entries(data.pipeline).map(([key,stage],i)=>(
                    <div key={key} style={{display:"flex",gap:"12px",alignItems:"flex-start",
                      padding:"10px 13px",borderRadius:"10px",
                      background:"var(--bg-raise)",border:"1px solid var(--bd)"}}>
                      <div style={{width:"26px",height:"26px",borderRadius:"50%",flexShrink:0,
                        background:"linear-gradient(135deg,#2563eb,#4f9eff)",
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:"12px",color:"#fff",fontWeight:700}}>
                        {i}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:"7px",
                          flexWrap:"wrap",marginBottom:"4px"}}>
                          <span style={{fontSize:"13px",fontWeight:700,color:"var(--t1)"}}>{stage.name}</span>
                          <Badge v={stage.type}/>
                          {stage.model && <Badge v={stage.model}/>}
                        </div>
                        <div style={{fontSize:"10px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace",
                          display:"flex",gap:"12px",flexWrap:"wrap"}}>
                          <span>tokens: <span style={{color:"var(--pri-hi)"}}>{stage.tokens}</span></span>
                          {stage.latency && <span>latency: <span style={{color:"var(--grn)"}}>{stage.latency}</span></span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
              {data.tools && (
                <Section title="Tool Registry" icon="🔧">
                  <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
                    {data.tools.map((t:string)=>(
                      <span key={t} style={{padding:"2px 8px",borderRadius:"5px",fontSize:"11px",
                        fontWeight:600,background:"rgba(79,158,255,.12)",
                        border:"1px solid rgba(79,158,255,.25)",color:"var(--pri-hi)",
                        fontFamily:"'JetBrains Mono',monospace"}}>{t}</span>
                    ))}
                  </div>
                </Section>
              )}
            </>)}

            {/* ── TAB: Memory ── */}
            {tab==="memory" && (<>
              <Section title="Agent Memory Systems" icon="🧠">
                {data.memory && Object.entries(data.memory).map(([k,v])=>(
                  <div key={k} style={{padding:"10px 13px",borderRadius:"9px",
                    background:"var(--bg-raise)",border:"1px solid var(--bd)",marginBottom:"7px"}}>
                    <div style={{fontSize:"12px",fontWeight:700,color:"var(--pri-hi)",
                      fontFamily:"'JetBrains Mono',monospace",marginBottom:"3px"}}>{k}</div>
                    <div style={{fontSize:"11px",color:"var(--t2)"}}>{v}</div>
                  </div>
                ))}
              </Section>
              <Section title="Caching Strategy" icon="⚡">
                {Object.entries(data.caching).map(([k,v])=><KV key={k} k={k} v={v}/>)}
              </Section>
              <Section title="Reliability & Fallbacks" icon="🛡️">
                {Object.entries(data.reliability).map(([k,v])=><KV key={k} k={k} v={v}/>)}
              </Section>
            </>)}

            {/* ── TAB: MCP ── */}
            {tab==="mcp" && (<>
              <Section title="MCP Server" icon="🔌">
                {mcpData ? (
                  <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                    <div style={{padding:"11px 14px",borderRadius:"10px",
                      background:"rgba(34,197,94,.07)",border:"1px solid rgba(34,197,94,.22)",
                      fontSize:"12px",color:"var(--t2)",display:"flex",gap:"8px",alignItems:"center"}}>
                      <span style={{color:"var(--grn)",fontWeight:700}}>● Online</span>
                      <span style={{fontFamily:"'JetBrains Mono',monospace"}}>{String(mcpData.mcp_server)}</span>
                    </div>
                    <div style={{fontSize:"11px",color:"var(--t3)",marginBottom:"4px",fontWeight:600}}>Available tools</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"8px"}}>
                      {(mcpData.tools as string[]).map((t:string)=>(
                        <span key={t} style={{padding:"2px 8px",borderRadius:"5px",fontSize:"11px",fontWeight:600,
                          background:"rgba(79,158,255,.12)",border:"1px solid rgba(79,158,255,.25)",
                          color:"var(--pri-hi)",fontFamily:"'JetBrains Mono',monospace"}}>{t}</span>
                      ))}
                    </div>
                    <KV k="guard_patterns" v={`${mcpData.guard_patterns} injection patterns applied to all tool args`}/>
                    <KV k="transports" v={(mcpData.transports as string[]).join(" · ")}/>
                    <KV k="config" v={String(mcpData.config)}/>
                  </div>
                ) : (
                  <div style={{fontSize:"12px",color:"var(--t3)",padding:"12px 0"}}>
                    MCP health endpoint unavailable. Start backend and check /mcp/health.
                  </div>
                )}
              </Section>
              <Section title="PromptGuard — Every Entry Point" icon="🛡️">
                <div style={{padding:"11px 14px",borderRadius:"10px",
                  background:"rgba(37,99,235,.06)",border:"1px solid rgba(79,158,255,.2)",
                  fontSize:"11px",color:"var(--t2)",lineHeight:1.75}}>
                  <strong style={{color:"var(--pri-hi)"}}>Filter chain:</strong> Every string argument in every MCP tool call passes through PromptGuard before the handler runs. Injection patterns cover LLM jailbreaks, system-prompt extraction, SQL/shell/code injection, XSS, null bytes, boundary attacks, and harmful content. The same filter also applies to <code style={{background:"var(--bg-raise)",padding:"1px 4px",borderRadius:"3px",fontSize:"10px"}}>POST /api/parse-prompt</code>, <code style={{background:"var(--bg-raise)",padding:"1px 4px",borderRadius:"3px",fontSize:"10px"}}>POST /api/ollama-chat</code>, and the SSE stream endpoint — so no entry point bypasses the filter.
                </div>
              </Section>
              <Section title="Claude Desktop Setup" icon="💻">
                <div style={{padding:"10px 13px",borderRadius:"9px",
                  background:"var(--bg-raise)",border:"1px solid var(--bd)",
                  fontFamily:"'JetBrains Mono',monospace",fontSize:"10px",
                  color:"var(--t2)",lineHeight:1.8,whiteSpace:"pre"}}{...{}}>{"python -m backend.mcp.server          # stdio (default)\npython -m backend.mcp.server --transport sse --port 8001"}</div>
                <div style={{marginTop:"7px",fontSize:"11px",color:"var(--t3)"}}>
                  Config file: <code style={{background:"var(--bg-raise)",padding:"1px 5px",borderRadius:"4px",fontSize:"10px"}}>backend/mcp/claude_desktop_config.json</code>
                </div>
              </Section>
            </>)}

            {/* ── TAB: Security ── */}
            {tab==="security" && (<>
              <Section title="Security Model" icon="🔒">
                {Object.entries(data.security).map(([k,v])=><KV key={k} k={k} v={v}/>)}
              </Section>
              <Section title="Infrastructure" icon="🏗️">
                {Object.entries(data.infrastructure).map(([k,v])=>(
                  <div key={k} style={{display:"flex",gap:"8px",alignItems:"center",
                    marginBottom:"5px",flexWrap:"wrap"}}>
                    <span style={{fontSize:"11px",fontWeight:600,color:"var(--t3)",
                      minWidth:"100px",flexShrink:0,textTransform:"capitalize"}}>{k}</span>
                    <Badge v={v}/>
                  </div>
                ))}
              </Section>
              <Section title="Observability" icon="📊">
                {Object.entries(data.observability).map(([k,v])=><KV key={k} k={k} v={v}/>)}
                <div style={{marginTop:"8px",padding:"9px 12px",borderRadius:"8px",
                  background:"rgba(34,197,94,.07)",border:"1px solid rgba(34,197,94,.22)",
                  fontSize:"11px",color:"var(--t2)",lineHeight:1.65}}>
                  <strong style={{color:"var(--grn)"}}>LangSmith traces</strong> at{" "}
                  <a href="https://smith.langchain.com" target="_blank" rel="noopener noreferrer"
                    style={{color:"var(--pri-hi)"}}>smith.langchain.com</a>{" "}
                  — set <code style={{background:"var(--bg-raise)",padding:"1px 5px",
                    borderRadius:"4px",fontSize:"10px",
                    fontFamily:"'JetBrains Mono',monospace"}}>LANGCHAIN_API_KEY</code>{" "}
                  in .env to enable full span trees for every agent stage.
                </div>
              </Section>
            </>)}

          </>)}
        </div>

        {/* ── Footer ── */}
        <div style={{padding:"10px 20px",borderTop:"1px solid var(--bd)",
          background:"var(--bg-raise)",flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"8px"}}>
          <span style={{fontSize:"11px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}}>
            GET /api/observability · GET /health · POST /api/search/stream
          </span>
          <a href={`${API_BASE}/docs`} target="_blank" rel="noopener noreferrer"
            style={{fontSize:"11px",color:"var(--pri-hi)",fontWeight:600,textDecoration:"none"}}>
            Swagger UI ↗
          </a>
        </div>
      </div>
    </div>
  );
}

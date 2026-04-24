"use client";
import { useState, useRef, useEffect } from "react";
import type { Property } from "@/lib/types";
import { log } from "@/lib/logger";

interface Message { role:"user"|"assistant"; content:string; }
interface Props    { property:Property; mortgageRate:number; onClose:()=>void; }

const API_BASE = typeof process!=="undefined"&&process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

// cfColor was missing — caused ReferenceError crashing the whole component
const cfColor = (v:number) => v>300?"var(--grn)":v>0?"var(--amb)":"var(--red)";

function buildSystemPrompt(p:Property, rate:number):string {
  const down=p.price*.2, loan=p.price-down, r=rate/100/12, n=360;
  const pi=r>0?loan*(r*(1+r)**n)/((1+r)**n-1):loan/n;
  const taxIns=Math.round(p.price*.015/12);
  const piti=Math.round(pi+taxIns);
  const opex=Math.round(p.est_rent*.35);
  const netCF=p.est_rent-piti-opex;
  const coc=((netCF*12)/down*100).toFixed(2);
  const grm=(p.price/(p.est_rent*12)).toFixed(1);
  const cap=((p.est_rent*12*.65)/p.price*100).toFixed(2);
  const breakEven=Math.round(piti*1.15);
  return `You are a professional real estate investment analyst. Answer questions about ONE property using ONLY the verified numbers below. Never invent data. If asked about HOA, crime, schools, or data not listed, say "not available in this analysis" and suggest where to look.

PROPERTY: ${p.address}, ZIP ${p.zip_code}
Price: $${p.price.toLocaleString()} | Beds/Baths/Sqft: ${p.beds}/${p.baths}/${p.sqft?.toLocaleString()||"N/A"}
Days on market: ${p.dom} | Score: ${p.ai_score}/100 | Tags: ${p.tags.join(", ")}

FINANCING (${rate}% 30yr, 20% down):
Down: $${Math.round(down).toLocaleString()} | Loan: $${Math.round(loan).toLocaleString()}
Monthly P&I: $${Math.round(pi).toLocaleString()} | Est. Tax+Ins: $${taxIns.toLocaleString()}/mo | PITI: $${piti.toLocaleString()}/mo

INCOME & EXPENSES:
Rent: $${p.est_rent.toLocaleString()}/mo | Opex (35%): $${opex.toLocaleString()}/mo
Net cash flow: $${netCF.toLocaleString()}/mo | Annual: $${(netCF*12).toLocaleString()}

METRICS:
Cap rate: ${cap}% | GRM: ${grm}x | Cash-on-cash: ${coc}% | Break-even rent: $${breakEven.toLocaleString()}/mo
NOI (annual): $${Math.round(p.est_rent*12*.65).toLocaleString()}

RULES: Be direct. Bullets for multi-part answers. Max 180 words unless full breakdown requested. Use exact numbers above.`;
}

const QUICK = [
  "💰 Cash flow breakdown",
  "📊 Is this a good deal?",
  "🔄 What if 25% down?",
  "📉 Impact of 10% vacancy?",
  "🏆 Cash-on-cash return?",
  "⚠️ Main investment risks?",
];

function renderContent(text:string) {
  return text.split("\n").map((line,i)=>{
    const bold = line.split(/(\*\*[^*]+\*\*)/g).map((p,j)=>
      p.startsWith("**")&&p.endsWith("**")
        ?<strong key={j} style={{fontWeight:700,color:"var(--t1)"}}>{p.slice(2,-2)}</strong>:p
    );
    const isBullet = line.startsWith("•")||line.startsWith("-");
    return <div key={i} style={{lineHeight:1.7,marginBottom:isBullet?"2px":line===""?"8px":"0",paddingLeft:isBullet?"6px":"0"}}>{bold}</div>;
  });
}

export default function PropertyChat({property,mortgageRate,onClose}:Props) {
  const [messages,  setMessages]   = useState<Message[]>([]);
  const [input,     setInput]      = useState("");
  const [loading,   setLoading]    = useState(false);
  const [error,     setError]      = useState("");
  const [ollamaOk,  setOllamaOk]   = useState<boolean|null>(null); // null=checking
  const [ollamaModel,setOllamaModel]= useState("llama3");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(()=>{
    // ── Check Ollama availability + fetch running model ────
    const checkOllama = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/ollama-chat`, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({
            messages: [{role:"user",content:"hi"}],
            system:   "Reply with one word: ready",
            model:    "",
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          setOllamaOk(true);
          // Try to get the model name from the backend health endpoint
          try {
            const h = await fetch(`${API_BASE}/health`);
            if (h.ok) {
              const hd = await h.json();
              if (hd.model) setOllamaModel(hd.model);
            }
          } catch(_){}
        } else if (res.status === 503) {
          setOllamaOk(false);
        } else {
          setOllamaOk(true); // endpoint reachable, other error
        }
      } catch(_) {
        setOllamaOk(false);
      }
    };
    checkOllama();

    // ── Welcome message ────────────────────────────────────
    const down=Math.round(property.price*.2);
    const r=mortgageRate/100/12,n=360,loan=property.price-down;
    const pi=Math.round(loan*(r*(1+r)**n)/((1+r)**n-1));
    const opex=Math.round(property.est_rent*.35);
    const piti=pi+Math.round(property.price*.015/12);
    const netCF=property.est_rent-piti-opex;
    const coc=((netCF*12)/down*100).toFixed(1);
    const scoreEmoji=property.ai_score>=85?"🏆":property.ai_score>=70?"⭐":property.ai_score>=55?"✅":"⚠️";
    log.ai(`PropertyChat opened: ${property.address}`,{score:property.ai_score,rank:property.rank});
    setMessages([{role:"assistant",content:`${scoreEmoji} Analyzing **${property.address}**\n\n**Quick snapshot:**\n• 💵 List price: $${property.price.toLocaleString()}\n• 🏠 Est. rent: $${property.est_rent.toLocaleString()}/mo\n• 💰 Net cash flow: $${netCF.toLocaleString()}/mo\n• 📈 Cap rate: ${property.cap_rate}% · Cash-on-cash: ${coc}%\n• ${scoreEmoji} Score: ${property.ai_score}/100\n\nAsk anything — financing, risks, investment scenarios.`}]);
    setTimeout(()=>inputRef.current?.focus(),100);
  },[property.address]);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const send = async (text:string)=>{
    const q=text.trim(); if(!q||loading) return;
    setInput(""); setError("");
    const userMsg:Message = {role:"user",content:q};
    const newMsgs = [...messages,userMsg];
    setMessages(newMsgs); setLoading(true);
    log.ai("Chat question sent",{q:q.slice(0,80),address:property.address});

    try {
      // ── Route through backend /api/ollama-chat proxy ──────
      // Backend proxy handles: UserAgent security check, Ollama connection,
      // model selection from config, error normalisation.
      const res = await fetch(`${API_BASE}/api/ollama-chat`,{
        method:  "POST",
        headers: {"Content-Type":"application/json"},
        body:    JSON.stringify({
          messages: newMsgs.map(m=>({role:m.role,content:m.content})),
          system:   buildSystemPrompt(property,mortgageRate),
          model:    "",   // empty = use OLLAMA_MODEL from backend .env
        }),
        signal: AbortSignal.timeout(90_000),   // 90s — local model can be slow
      });

      if (!res.ok) {
        const err   = await res.json().catch(()=>({}));
        const detail= (err as {detail?:string}).detail || `HTTP ${res.status}`;

        if (res.status === 503) {
          setOllamaOk(false);
          setError(
            `🦙 Ollama is not running.\n\n` +
            `Fix:\n` +
            `  1. Open a terminal\n` +
            `  2. Run:  ollama serve\n` +
            `  3. If llama3 not installed:  ollama pull llama3\n` +
            `  4. Then ask your question again.`
          );
          setLoading(false);
          return;
        }
        if (res.status === 400) {
          // UserAgent blocked the message
          setError(`🛡️ Message blocked: ${detail}`);
          setLoading(false);
          return;
        }
        throw new Error(detail);
      }

      const data  = await res.json();
      const reply = (data.content as Array<{type:string;text?:string}>)
                      ?.find(b=>b.type==="text")?.text ?? "No response received.";

      if (!reply.trim()) throw new Error("Empty response from Ollama");

      setOllamaOk(true);
      log.ai("Chat reply received",{chars:reply.length,model:ollamaModel});
      setMessages(prev=>[...prev,{role:"assistant",content:reply}]);

    } catch(e:unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (msg.includes("timed out") || msg.includes("abort")) {
        setError(`⏱️ Request timed out (90s).\n\nOllama may be loading the model for the first time. Try again in 30 seconds.`);
      } else {
        setError(`Error: ${msg}`);
      }
      log.err("ai",`Chat error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--bg-surf)",borderRadius:"14px",border:"1px solid var(--bd-hi)",overflow:"hidden",boxShadow:"var(--shd)"}}>

      {/* Header */}
      <div style={{padding:"12px 14px",background:"linear-gradient(135deg,rgba(37,99,235,.28),rgba(79,158,255,.14))",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"9px"}}>
          <div style={{width:"32px",height:"32px",borderRadius:"9px",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"15px",boxShadow:"0 2px 8px rgba(37,99,235,.35)",flexShrink:0}}>🤖</div>
          <div>
            <div style={{fontSize:"12px",fontWeight:700,color:"var(--t1)",display:"flex",alignItems:"center",gap:"6px"}}>
              Property Analyst
              {/* Ollama status indicator */}
              {ollamaOk===null && <span style={{fontSize:"9px",color:"var(--t3)",fontStyle:"italic"}}>checking…</span>}
              {ollamaOk===true  && <span style={{padding:"1px 6px",borderRadius:"9px",background:"rgba(34,197,94,.15)",border:"1px solid rgba(34,197,94,.3)",fontSize:"9px",fontWeight:700,color:"var(--grn)"}}>🦙 {ollamaModel}</span>}
              {ollamaOk===false && <span style={{padding:"1px 6px",borderRadius:"9px",background:"rgba(244,63,94,.12)",border:"1px solid rgba(244,63,94,.3)",fontSize:"9px",fontWeight:700,color:"var(--red)"}}>⚠ Ollama offline</span>}
            </div>
            <div style={{fontSize:"10px",color:"var(--t3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"200px"}}>📍 {property.address}</div>
          </div>
        </div>
        <button onClick={onClose}
          style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",color:"var(--t1)",cursor:"pointer",borderRadius:"6px",padding:"5px 10px",fontSize:"13px"}}
          onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(239,68,68,.2)";}}
          onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(255,255,255,.08)";}}>✕</button>
      </div>

      {/* Ollama offline warning — shown when status check failed */}
      {ollamaOk===false && (
        <div style={{padding:"8px 14px",background:"rgba(244,63,94,.08)",borderBottom:"1px solid rgba(244,63,94,.25)",fontSize:"11px",color:"var(--red)",lineHeight:1.6}}>
          🦙 <strong>Ollama is not running.</strong> Open a terminal and run: <code style={{background:"var(--bg-raise)",padding:"1px 5px",borderRadius:"4px",fontFamily:"'JetBrains Mono',monospace"}}>ollama serve</code>
          {" "}— then ask your question again.
        </div>
      )}

      {/* Stats bar */}
      <div style={{padding:"8px 14px",background:"var(--bg-raise)",borderBottom:"1px solid var(--bd)",display:"flex",gap:"12px",alignItems:"center",flexShrink:0,overflowX:"auto"}}>
        {[
          {icon:"💵",lbl:"Price",    val:`$${property.price.toLocaleString()}`,    c:"var(--pri-hi)"},
          {icon:"🏠",lbl:"Rent/mo",  val:`$${property.est_rent.toLocaleString()}`,  c:"var(--grn)"},
          {icon:"💰",lbl:"Cash Flow",val:`$${property.cash_flow.toLocaleString()}`, c:cfColor(property.cash_flow)},
          {icon:"📈",lbl:"Cap Rate", val:`${property.cap_rate}%`,                   c:"var(--pri-hi)"},
        ].map(m=>(
          <div key={m.lbl} style={{flexShrink:0}}>
            <div style={{fontSize:"11px",fontWeight:800,color:m.c,fontFamily:"'JetBrains Mono',monospace"}}>{m.icon} {m.val}</div>
            <div style={{fontSize:"9px",color:"var(--t3)",fontWeight:600}}>{m.lbl}</div>
          </div>
        ))}

        <div style={{marginLeft:"auto", display:"flex", alignItems:"center", gap:"8px", flexShrink:0}}>
          <div style={{display:"flex", flexDirection:"column", alignItems:"flex-end"}}>
            <div style={{fontSize:"9px",color:"var(--t3)",fontWeight:600, display:"flex", alignItems:"center", gap:"4px"}}>
              Score
              <span title="AI generated score based on property metrics" style={{cursor:"help", fontSize:"10px", color:"var(--pri-hi)"}}>ℹ️</span>
            </div>
            <div style={{fontSize:"11px",fontWeight:800,color:property.ai_score>=70?"var(--grn)":"var(--amb)",fontFamily:"'JetBrains Mono',monospace"}}>
              {property.ai_score}/100
            </div>
          </div>
          <div style={{position:"relative",width:"32px",height:"32px"}}>
            <svg width="32" height="32" viewBox="0 0 36 36" style={{transform:"rotate(-90deg)"}}>
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth="3"/>
              <circle cx="18" cy="18" r="15" fill="none" stroke={property.ai_score>=70?"var(--grn)":"var(--amb)"} strokeWidth="3"
                strokeDasharray={`${(property.ai_score/100)*(2*Math.PI*15)} ${2*Math.PI*15}`} strokeLinecap="round"
                style={{transition:"stroke-dasharray .9s ease"}}/>
            </svg>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px"}}>
              {property.ai_score>=85?"🏆":property.ai_score>=70?"⭐":property.ai_score>=55?"✅":"⚠️"}
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",padding:"12px",display:"flex",flexDirection:"column",gap:"10px"}}>
        {messages.map((m,i)=>(
          <div key={i} className="msg-in" style={{display:"flex",gap:"7px",flexDirection:m.role==="user"?"row-reverse":"row",alignItems:"flex-end"}}>
            {m.role==="assistant"&&<div style={{width:"24px",height:"24px",borderRadius:"7px",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",flexShrink:0}}>🤖</div>}
            <div style={{maxWidth:"84%",padding:"9px 12px",borderRadius:m.role==="user"?"11px 11px 2px 11px":"11px 11px 11px 2px",
              background:m.role==="user"?"linear-gradient(135deg,var(--pri),#1e40af)":"var(--bg-raise)",
              border:m.role==="user"?"none":"1px solid var(--bd)",
              color:m.role==="user"?"#fff":"var(--t2)",fontSize:"13px",lineHeight:1.65,
              boxShadow:m.role==="user"?"0 2px 8px rgba(124,58,237,.3)":"none"}}>
              {m.role==="assistant"?renderContent(m.content):m.content}
            </div>
          </div>
        ))}
        {loading&&(
          <div className="msg-in" style={{display:"flex",gap:"7px",alignItems:"flex-end"}}>
            <div style={{width:"24px",height:"24px",borderRadius:"7px",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px"}}>🤖</div>
            <div style={{padding:"9px 14px",borderRadius:"11px 11px 11px 2px",background:"var(--bg-raise)",border:"1px solid var(--bd)"}}>
              <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                {[0,1,2].map(j=><div key={j} style={{width:"5px",height:"5px",borderRadius:"50%",background:"var(--pri-hi)",animation:`blink 1.2s infinite ${j*.2}s`}}/>)}
              </div>
            </div>
          </div>
        )}
        {error&&<div style={{padding:"9px 12px",borderRadius:"8px",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",fontSize:"12px",color:"var(--red)",whiteSpace:"pre-line"}}>⚠️ {error}</div>}
        <div ref={bottomRef}/>
      </div>

      {/* Quick questions */}
      <div style={{padding:"7px 10px",borderTop:"1px solid var(--bd)",display:"flex",gap:"5px",overflowX:"auto",flexShrink:0}}>
        {QUICK.map(q=>(
          <button key={q} onClick={()=>send(q)} disabled={loading}
            style={{padding:"4px 9px",borderRadius:"18px",fontSize:"10px",fontWeight:600,border:"1px solid var(--bd)",color:"var(--pri-hi)",background:"rgba(37,99,235,.08)",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,transition:"all .15s"}}
            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(37,99,235,.16)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(37,99,235,.08)";}}>
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{padding:"9px 10px",borderTop:"1px solid var(--bd)",display:"flex",gap:"7px",flexShrink:0}}>
        <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send(input)}
          placeholder="Ask about cash flow, risks, financing..."
          disabled={loading}
          style={{flex:1,padding:"9px 12px",borderRadius:"9px",border:"1px solid var(--bd)",fontSize:"13px",color:"var(--t1)",background:"var(--bg-raise)",fontFamily:"Inter,sans-serif",outline:"none",transition:"border-color .18s"}}
          onFocus={e=>{e.target.style.borderColor="var(--bd-hi)";e.target.style.boxShadow="0 0 0 3px rgba(124,58,237,.1)";}}
          onBlur={e=>{e.target.style.borderColor="var(--bd)";e.target.style.boxShadow="none";}}/>
        <button onClick={()=>send(input)} disabled={loading||!input.trim()}
          style={{padding:"9px 14px",borderRadius:"9px",background:(!input.trim()||loading)?"var(--bg-raise)":"linear-gradient(135deg,var(--pri),#1e40af)",border:"1px solid var(--bd)",color:(!input.trim()||loading)?"var(--t3)":"#fff",fontSize:"15px",cursor:(!input.trim()||loading)?"not-allowed":"pointer",transition:"all .18s",flexShrink:0}}>
          ↑
        </button>
      </div>
    </div>
  );
}

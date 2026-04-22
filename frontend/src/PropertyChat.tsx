"use client";
import { useState, useRef, useEffect } from "react";
import type { Property } from "@/lib/types";
import { log } from "@/lib/logger";

interface Message { role:"user"|"assistant"; content:string; }
interface Props    { property:Property; mortgageRate:number; onClose:()=>void; }

const API_BASE = typeof process!=="undefined"&&process.env.NEXT_PUBLIC_API_URL
  ? process.env.NEXT_PUBLIC_API_URL : "http://localhost:8000";

// Color helper for cash-flow values: green when positive, red otherwise.
// Added here because the original repo referenced cfColor() without defining it,
// breaking `next build` under strict type-check.
const cfColor = (v: number): string => (v > 0 ? "#10b981" : "#ef4444");

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
Days on market: ${p.dom} | AI Score: ${p.ai_score}/100 | Tags: ${p.tags.join(", ")}

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
  "💰 Full cash flow breakdown",
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
  const [messages,setMessages] = useState<Message[]>([]);
  const [input,setInput]       = useState("");
  const [loading,setLoading]   = useState(false);
  const [error,setError]       = useState("");
  const [useOllama,setUseOllama] = useState(true); // prefer local Ollama
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(()=>{
    const down=Math.round(property.price*.2);
    const r=mortgageRate/100/12,n=360,loan=property.price-down;
    const pi=Math.round(loan*(r*(1+r)**n)/((1+r)**n-1));
    const opex=Math.round(property.est_rent*.35);
    const piti=pi+Math.round(property.price*.015/12);
    const netCF=property.est_rent-piti-opex;
    const coc=((netCF*12)/down*100).toFixed(1);
    const scoreEmoji=property.ai_score>=85?"🏆":property.ai_score>=70?"⭐":property.ai_score>=55?"✅":"⚠️";
    log.ai(`PropertyChat opened: ${property.address}`,{score:property.ai_score,rank:property.rank,useOllama});
    setMessages([{role:"assistant",content:`${scoreEmoji} Analyzing **${property.address}**\n\n**Quick snapshot:**\n• 💵 List price: $${property.price.toLocaleString()}\n• 🏠 Est. rent: $${property.est_rent.toLocaleString()}/mo\n• 💰 Net cash flow: $${netCF.toLocaleString()}/mo\n• 📈 Cap rate: ${property.cap_rate}% · Cash-on-cash: ${coc}%\n• ${scoreEmoji} AI Score: ${property.ai_score}/100\n\nPowered by **local Ollama (llama3)**. Ask anything — financing, risks, scenarios.`}]);
    setTimeout(()=>inputRef.current?.focus(),100);
  },[property.address]);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const send = async (text:string)=>{
    const q=text.trim(); if(!q||loading) return;
    setInput(""); setError("");
    const userMsg:Message = {role:"user",content:q};
    const newMsgs = [...messages,userMsg];
    setMessages(newMsgs); setLoading(true);
    log.ai(`Chat question sent`,{q:q.slice(0,80),address:property.address,useOllama});

    try {
      let reply = "";
      if (useOllama) {
        // ── Use local Ollama via backend proxy ──────────────
        const res = await fetch(`${API_BASE}/api/ollama-chat`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            messages: newMsgs.map(m=>({role:m.role,content:m.content})),
            system:   buildSystemPrompt(property,mortgageRate),
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(()=>({}));
          const detail = (err as {detail?:string}).detail || `HTTP ${res.status}`;
          if (res.status===503) {
            // Ollama not running — fall back to direct Anthropic
            log.warn("ai","Ollama not available, note shown to user");
            setError("⚠️ Local Ollama is not running. Start it with: ollama serve\n\nTip: You can also use Anthropic API by updating PropertyChat.tsx.");
            setLoading(false); return;
          }
          throw new Error(detail);
        }
        const data = await res.json();
        reply = data.content?.find((b:{type:string})=>b.type==="text")?.text || "No response.";
      } else {
        // ── Direct Anthropic fallback ───────────────────────
        const res = await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:800,system:buildSystemPrompt(property,mortgageRate),messages:newMsgs.map(m=>({role:m.role,content:m.content}))})
        });
        if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error((e as {error?:{message?:string}}).error?.message||`HTTP ${res.status}`); }
        const data = await res.json();
        reply = data.content?.find((b:{type:string})=>b.type==="text")?.text || "No response.";
      }
      log.ai("Chat reply received",{chars:reply.length});
      setMessages(prev=>[...prev,{role:"assistant",content:reply}]);
    } catch(e:unknown) {
      const msg = e instanceof Error?e.message:"Unknown error";
      log.err("ai",`Chat error: ${msg}`);
      setError(`Error: ${msg}`);
    } finally { setLoading(false); }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--bg-surf)",borderRadius:"14px",border:"1px solid var(--bd)",overflow:"hidden",boxShadow:"var(--shd)"}}>

      {/* Header */}
      <div style={{padding:"12px 14px",background:"linear-gradient(135deg,rgba(37,99,235,.35),rgba(79,158,255,.2))",borderBottom:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
          <div style={{width:"30px",height:"30px",borderRadius:"8px",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",boxShadow:"0 2px 8px rgba(124,58,237,.35)"}}>🤖</div>
          <div>
            <div style={{fontSize:"12px",fontWeight:700,color:"var(--t1)"}}>AI Property Analyst · Ollama</div>
            <div style={{fontSize:"10px",color:"var(--t3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"180px"}}>📍 {property.address}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
          <button onClick={()=>setUseOllama(v=>!v)}
            style={{padding:"3px 8px",borderRadius:"6px",fontSize:"10px",fontWeight:600,border:"1px solid var(--bd-hi)",color:useOllama?"var(--grn)":"var(--amb)",background:useOllama?"rgba(16,185,129,.1)":"rgba(245,158,11,.1)",cursor:"pointer"}}
            title={useOllama?"Using local Ollama":"Using Anthropic API"}>
            {useOllama?"🦙 Ollama":"🤖 API"}
          </button>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.15)",color:"var(--t1)",cursor:"pointer",borderRadius:"6px",padding:"4px 8px",fontSize:"13px",transition:"all .15s"}}
            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(239,68,68,.2)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background="rgba(255,255,255,.1)";}}>✕</button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{padding:"8px 14px",background:"var(--bg-raise)",borderBottom:"1px solid var(--bd)",display:"flex",gap:"12px",flexShrink:0,overflowX:"auto"}}>
        {[
          {icon:"💵",lbl:"Price",    val:`$${property.price.toLocaleString()}`,    c:"var(--pri-hi)"},
          {icon:"🏠",lbl:"Rent/mo",  val:`$${property.est_rent.toLocaleString()}`,  c:"var(--grn)"},
          {icon:"💰",lbl:"Cash Flow",val:`$${property.cash_flow.toLocaleString()}`, c:cfColor(property.cash_flow)},
          {icon:"📈",lbl:"Cap Rate", val:`${property.cap_rate}%`,                   c:"var(--pri-hi)"},
          {icon:"🏆",lbl:"Score",    val:`${property.ai_score}/100`,                c:property.ai_score>=70?"var(--grn)":"var(--amb)"},
        ].map(m=>(
          <div key={m.lbl} style={{flexShrink:0}}>
            <div style={{fontSize:"11px",fontWeight:800,color:m.c,fontFamily:"'JetBrains Mono',monospace"}}>{m.icon} {m.val}</div>
            <div style={{fontSize:"9px",color:"var(--t3)",fontWeight:600}}>{m.lbl}</div>
          </div>
        ))}
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

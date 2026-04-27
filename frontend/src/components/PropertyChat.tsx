"use client";
import { useState, useRef, useEffect } from "react";

let _ollamaCache: { ok: boolean; model: string; ts: number } | null = null;
import type { Property } from "@/lib/types";
import { log } from "@/lib/logger";

interface Message { role:"user"|"assistant"; content:string; }
interface Props    { property:Property; mortgageRate:number; onClose:()=>void; }

const OLLAMA_URL = "http://localhost:11434";

const cfColor = (v:number) => v>300?"var(--grn)":v>0?"var(--amb)":"var(--red)";

function buildSystemPrompt(p:Property, rate:number):string {
  const down=p.price*.2;
  const netCF=p.cash_flow;
  const coc=((netCF*12)/down*100).toFixed(2);
  const grm=(p.price/(p.est_rent*12)).toFixed(1);
  const cap=((p.est_rent*12*.65)/p.price*100).toFixed(2);
  return (
    `You are a professional real estate investment analyst. Answer ONLY about this property using the numbers below.\n\n`+
    `PROPERTY: ${p.address}, ZIP ${p.zip_code}\n`+
    `Price: $${p.price.toLocaleString()} | ${p.beds}bd/${p.baths}ba | ${p.sqft?.toLocaleString()||"N/A"} sqft | ${p.dom}d listed\n`+
    `Score: ${p.ai_score}/100 | Tags: ${p.tags.join(", ")}\n\n`+
    `FINANCING (${rate}% / 30yr / 20% down): Down $${Math.round(down).toLocaleString()}\n`+
    `INCOME: Rent $${p.est_rent.toLocaleString()}/mo | Net CF $${netCF.toLocaleString()}/mo\n`+
    `METRICS: Cap ${cap}% | GRM ${grm}x | CoC ${coc}%\n\n`+
    `RULES: Be direct and concise. Use bullet points for multi-part answers. Max 180 words. Use only the numbers above.`
  );
}


const QUICK = [
  "💰 Cash flow breakdown",
  "📊 Good deal?",
  "🔄 25% down?",
  "📉 10% vacancy?",
  "💎 Cash-on-cash?",
  "⚠️ Main risks?",
];

function renderContent(text:string) {
  return text.split("\n").map((line,i)=>{
    const bold = line.split(/(\*\*[^*]+\*\*)/g).map((seg,j)=>
      seg.startsWith("**")&&seg.endsWith("**")
        ?<strong key={j} style={{fontWeight:700,color:"var(--t1)"}}>{seg.slice(2,-2)}</strong>
        :seg
    );
    const isBullet = line.startsWith("•")||line.startsWith("-")||line.startsWith("*");
    return (
      <div key={i} style={{
        lineHeight:1.75,
        marginBottom:isBullet?"3px":line===""?"8px":"1px",
        paddingLeft:isBullet?"10px":"0",
        position:"relative",
      }}>
        {isBullet && <span style={{position:"absolute",left:0,color:"var(--pri-hi)",fontWeight:700}}>·</span>}
        {bold}
      </div>
    );
  });
}

export default function PropertyChat({ property, mortgageRate, onClose }:Props) {
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [input,       setInput]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [ollamaOk,    setOllamaOk]    = useState<boolean|null>(null);
  const [ollamaModel, setOllamaModel] = useState("llama3");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  /* ── Ollama check + welcome ───────────────────────────────── */
  useEffect(()=>{
    const check = async ()=>{
      const now = Date.now();
      if (_ollamaCache && now - _ollamaCache.ts < 30_000) {
        setOllamaOk(_ollamaCache.ok);
        setOllamaModel(_ollamaCache.model);
        return;
      }
      try {
        const ctrl=new AbortController(), t=setTimeout(()=>ctrl.abort(),4000);
        let res:Response;
        try { res=await fetch(`${OLLAMA_URL}/api/tags`,{signal:ctrl.signal}); }
        finally { clearTimeout(t); }
        if (res.ok){
          const d=await res.json();
          const model=(d.models?.[0]?.name||"llama3").replace(":latest","");
          _ollamaCache = { ok: true, model, ts: Date.now() };
          setOllamaOk(true);
          setOllamaModel(model);
        } else {
          _ollamaCache = { ok: false, model: "llama3", ts: Date.now() };
          setOllamaOk(false);
        }
      } catch(_){
        _ollamaCache = { ok: false, model: "llama3", ts: Date.now() };
        setOllamaOk(false);
      }
    };
    check();

    const down=Math.round(property.price*.2);
    const netCF=property.cash_flow;
    const coc=((netCF*12)/down*100).toFixed(1);
    const e=property.ai_score>=85?"🏆":property.ai_score>=70?"⭐":property.ai_score>=55?"✅":"⚠️";
    log.ai(`Chat opened: ${property.address}`,{score:property.ai_score});
    setMessages([{role:"assistant",content:
      `${e} **${property.address}**\n\n`+
      `• Price: $${property.price.toLocaleString()} · Rent: $${property.est_rent.toLocaleString()}/mo\n`+
      `• Net cash flow: $${netCF.toLocaleString()}/mo\n`+
      `• Cap rate: ${property.cap_rate}% · CoC: ${coc}%\n`+
      `• Score: ${property.ai_score}/100\n\nAsk anything about this property.`
    }]);
    setTimeout(()=>inputRef.current?.focus(),150);
  },[property.address]);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const send = async (text:string)=>{
    const q=text.trim(); if(!q||loading) return;
    setInput(""); setError("");
    const userMsg:Message={role:"user",content:q};
    const msgs=[...messages,userMsg];
    setMessages(msgs); setLoading(true);

    try {
      const ctrl=new AbortController(), t=setTimeout(()=>ctrl.abort(),90_000);
      let res:Response;
      try {
        res=await fetch(`${OLLAMA_URL}/api/chat`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            model: ollamaModel,
            stream: false,
            messages:[
              {role:"system",content:buildSystemPrompt(property,mortgageRate)},
              ...msgs.map(m=>({role:m.role,content:m.content})),
            ],
            options:{temperature:0.2,num_predict:800},
          }),
          signal:ctrl.signal,
        });
      } finally { clearTimeout(t); }

      if(!res.ok){
        setOllamaOk(false);
        _ollamaCache = { ok: false, model: ollamaModel, ts: Date.now() };
        setError("Ollama error. Make sure it is running: ollama serve");
        setLoading(false); return;
      }

      const data=await res.json();
      const reply=data?.message?.content??"No response.";
      if(!reply.trim()) throw new Error("Empty response");
      setOllamaOk(true);
      log.ai("Reply received",{chars:reply.length});
      setMessages(prev=>[...prev,{role:"assistant",content:reply}]);
    } catch(e:unknown){
      const msg=e instanceof Error?e.message:"Unknown error";
      if(msg.includes("abort")||msg.includes("timed out"))
        setError("Ollama timed out. Make sure it is running: ollama serve");
      else if(msg.includes("Failed to fetch")||msg.includes("NetworkError")){
        setOllamaOk(false);
        _ollamaCache = { ok: false, model: ollamaModel, ts: Date.now() };
        setError("Cannot reach Ollama. Make sure it is running: ollama serve");
      } else setError(`Error: ${msg}`);
      log.err("ai",`Chat error: ${msg}`);
    } finally { setLoading(false); }
  };

  const statusBadge = ollamaOk===null
    ? <span style={{fontSize:9,color:"var(--t3)",fontStyle:"italic",marginLeft:4}}>checking…</span>
    : ollamaOk
    ? <span style={{fontSize:9,fontWeight:700,color:"var(--grn)",background:"rgba(16,185,129,.12)",
        border:"1px solid rgba(16,185,129,.25)",borderRadius:20,padding:"1px 7px",marginLeft:4}}>
        🦙 {ollamaModel}
      </span>
    : <span style={{fontSize:9,fontWeight:700,color:"var(--red)",background:"rgba(244,63,94,.10)",
        border:"1px solid rgba(244,63,94,.25)",borderRadius:20,padding:"1px 7px",marginLeft:4}}>
        ⚠ offline
      </span>;

  return (
    <div className="chat-panel chat-in">

      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{
        padding:"13px 16px",flexShrink:0,
        background:"linear-gradient(135deg,rgba(37,99,235,.2) 0%,rgba(79,143,255,.08) 100%)",
        borderBottom:"1px solid var(--bd)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <div style={{
            width:34,height:34,borderRadius:10,flexShrink:0,
            background:"linear-gradient(135deg,#2563eb,#1d4ed8)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:16,boxShadow:"0 3px 10px rgba(37,99,235,.45)",
          }}>🤖</div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",display:"flex",alignItems:"center",flexWrap:"wrap",gap:2}}>
              Property Analyst {statusBadge}
            </div>
            <div style={{fontSize:10,color:"var(--t3)",overflow:"hidden",textOverflow:"ellipsis",
              whiteSpace:"nowrap",maxWidth:"clamp(120px,20vw,220px)"}}>
              📍 {property.address}
            </div>
          </div>
        </div>
        <button onClick={onClose}
          style={{
            width:32,height:32,borderRadius:8,flexShrink:0,
            background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",
            color:"var(--t2)",cursor:"pointer",fontSize:14,display:"flex",
            alignItems:"center",justifyContent:"center",transition:"all .15s",
          }}
          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background="rgba(244,63,94,.18)";(e.currentTarget as HTMLElement).style.color="#fff";}}
          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="rgba(255,255,255,.06)";(e.currentTarget as HTMLElement).style.color="var(--t2)";}}>
          ✕
        </button>
      </div>

      {/* ── Offline warning ─────────────────────────────────── */}
      {ollamaOk===false && (
        <div style={{
          padding:"10px 16px",background:"rgba(244,63,94,.07)",
          borderBottom:"1px solid rgba(244,63,94,.18)",
          fontSize:11,color:"var(--red)",lineHeight:1.6,flexShrink:0,
        }}>
          🦙 <strong>Ollama offline.</strong> Run <code style={{background:"var(--bg-raise)",padding:"1px 5px",borderRadius:4,fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>ollama serve</code> to enable AI chat.
        </div>
      )}

      {/* ── Stats bar ───────────────────────────────────────── */}
      <div style={{
        padding:"10px 16px",background:"var(--bg-raise)",
        borderBottom:"1px solid var(--bd)",
        display:"flex",gap:0,flexShrink:0,
        overflowX:"auto",
      }}>
        {[
          {lbl:"Price",    val:`$${property.price.toLocaleString()}`,     c:"var(--pri-hi)"},
          {lbl:"Rent",     val:`$${property.est_rent.toLocaleString()}/mo`, c:"var(--grn)"},
          {lbl:"CF/mo",    val:`$${property.cash_flow.toLocaleString()}`,  c:cfColor(property.cash_flow)},
          {lbl:"Cap Rate", val:`${property.cap_rate}%`,                    c:"var(--amb)"},
          {lbl:"Score",    val:`${property.ai_score}/100`,                 c:property.ai_score>=70?"var(--grn)":"var(--amb)"},
        ].map((m,i,arr)=>(
          <div key={m.lbl} style={{
            flexShrink:0,padding:"0 14px",
            borderRight:i<arr.length-1?"1px solid var(--bd)":"none",
            minWidth:0,
          }}>
            <div style={{fontSize:13,fontWeight:800,color:m.c,fontFamily:"'JetBrains Mono',monospace",
              whiteSpace:"nowrap"}}>{m.val}</div>
            <div style={{fontSize:9,color:"var(--t3)",fontWeight:600,marginTop:2,whiteSpace:"nowrap"}}>{m.lbl}</div>
          </div>
        ))}
      </div>

      {/* ── Messages ────────────────────────────────────────── */}
      <div className="chat-messages" style={{padding:"16px",display:"flex",flexDirection:"column",gap:12}}>
        {messages.map((m,i)=>(
          <div key={i} className="msg-in" style={{
            display:"flex",gap:8,
            flexDirection:m.role==="user"?"row-reverse":"row",
            alignItems:"flex-end",
          }}>
            {m.role==="assistant" && (
              <div style={{
                width:26,height:26,borderRadius:8,flexShrink:0,
                background:"linear-gradient(135deg,#2563eb,#1d4ed8)",
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:12,boxShadow:"0 2px 8px rgba(37,99,235,.35)",
              }}>🤖</div>
            )}
            <div style={{
              maxWidth:"82%",padding:"10px 14px",
              borderRadius:m.role==="user"?"14px 14px 3px 14px":"14px 14px 14px 3px",
              background:m.role==="user"
                ?"linear-gradient(135deg,#2563eb,#1d4ed8)"
                :"var(--bg-raise)",
              border:m.role==="user"?"none":"1px solid var(--bd)",
              color:m.role==="user"?"#fff":"var(--t2)",
              fontSize:13,lineHeight:1.65,
              boxShadow:m.role==="user"?"0 3px 12px rgba(37,99,235,.3)":"none",
            }}>
              {m.role==="assistant"?renderContent(m.content):m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="msg-in" style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <div style={{width:26,height:26,borderRadius:8,flexShrink:0,
              background:"linear-gradient(135deg,#2563eb,#1d4ed8)",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🤖</div>
            <div style={{padding:"12px 16px",borderRadius:"14px 14px 14px 3px",
              background:"var(--bg-raise)",border:"1px solid var(--bd)"}}>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                {[0,1,2].map(j=>(
                  <div key={j} style={{
                    width:6,height:6,borderRadius:"50%",background:"var(--pri-hi)",
                    animation:`blink 1.2s infinite ${j*.2}s`,
                  }}/>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding:"10px 14px",borderRadius:10,
            background:"rgba(244,63,94,.07)",border:"1px solid rgba(244,63,94,.2)",
            fontSize:12,color:"var(--red)",whiteSpace:"pre-line",lineHeight:1.6,
          }}>⚠️ {error}</div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* ── Quick chips ─────────────────────────────────────── */}
      <div style={{
        padding:"8px 12px",borderTop:"1px solid var(--bd)",
        display:"flex",gap:5,overflowX:"auto",flexShrink:0,
        scrollbarWidth:"none",
      }}>
        {QUICK.map(q=>(
          <button key={q} onClick={()=>send(q)} disabled={loading}
            style={{
              padding:"5px 11px",borderRadius:20,fontSize:11,fontWeight:600,
              border:"1px solid var(--bd)",color:"var(--pri-hi)",
              background:"var(--pri-lo)",cursor:"pointer",
              whiteSpace:"nowrap",flexShrink:0,transition:"all .15s",
              opacity:loading?.5:1,
            }}
            onMouseEnter={e=>{if(!loading)(e.currentTarget as HTMLElement).style.background="rgba(37,99,235,.2)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="var(--pri-lo)";}}>
            {q}
          </button>
        ))}
      </div>

      {/* ── Input ───────────────────────────────────────────── */}
      <div style={{
        padding:"12px 14px",borderTop:"1px solid var(--bd)",
        display:"flex",gap:8,flexShrink:0,
        background:"var(--bg-surf)",
      }}>
        <input ref={inputRef} value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send(input)}
          placeholder="Ask about cash flow, risks, financing…"
          disabled={loading}
          style={{
            flex:1,padding:"10px 14px",borderRadius:10,
            border:"1px solid var(--bd)",fontSize:13,
            color:"var(--t1)",background:"var(--bg-raise)",
            fontFamily:"Inter,sans-serif",outline:"none",
            transition:"border-color .18s, box-shadow .18s",
          }}
          onFocus={e=>{e.target.style.borderColor="var(--pri-hi)";e.target.style.boxShadow="0 0 0 3px rgba(37,99,235,.12)";}}
          onBlur={e=>{e.target.style.borderColor="var(--bd)";e.target.style.boxShadow="none";}}/>
        <button onClick={()=>send(input)} disabled={loading||!input.trim()}
          style={{
            width:42,height:42,borderRadius:10,flexShrink:0,
            background:!input.trim()||loading?"var(--bg-raise)":"linear-gradient(135deg,#2563eb,#1d4ed8)",
            border:"1px solid var(--bd)",
            color:!input.trim()||loading?"var(--t3)":"#fff",
            fontSize:18,cursor:!input.trim()||loading?"not-allowed":"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
            transition:"all .15s",
            boxShadow:!input.trim()||loading?"none":"0 2px 10px rgba(37,99,235,.4)",
          }}>↑</button>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useEffect } from "react";
import type { Property } from "@/lib/types";

interface Message { role: "user" | "assistant"; content: string; }
interface Props { property: Property; mortgageRate: number; onClose: () => void; }

const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:8000";

// ── Grounded system prompt ─────────────────────────────────────
function buildSystemPrompt(p: Property, rate: number): string {
  const down    = p.price * 0.20;
  const loan    = p.price - down;
  const r       = rate / 100 / 12;
  const n       = 360;
  const pi      = r > 0 ? loan * (r * Math.pow(1+r,n)) / (Math.pow(1+r,n)-1) : loan/n;
  const taxIns  = Math.round(p.price * 0.015 / 12);
  const piti    = Math.round(pi + taxIns);
  const opex    = Math.round(p.est_rent * 0.35);
  const netCF   = p.est_rent - piti - opex;
  const annualCF= Math.round(netCF * 12);
  const coc     = (annualCF / down * 100).toFixed(2);
  const capRate = ((p.est_rent * 12 * 0.65) / p.price * 100).toFixed(2);
  const grm     = (p.price / (p.est_rent * 12)).toFixed(1);
  const breakEven = Math.round(piti * 1.15);

  return `You are a real estate investment analyst at NetFlow. Answer questions about this ONE property using ONLY the data below. Never invent numbers. If asked about anything not in this data (HOA, crime, schools, appreciation), say so and suggest where to look.

PROPERTY: ${p.address}, ZIP ${p.zip_code}
Price: $${p.price.toLocaleString()} | ${p.beds}bd/${p.baths}ba | ${p.sqft?.toLocaleString() ?? "N/A"} sqft | ${p.dom} days listed
AI Score: ${p.ai_score}/100 | Tags: ${p.tags.join(", ")}

FINANCING (${rate}% 30yr, 20% down):
Down: $${Math.round(down).toLocaleString()} | Loan: $${Math.round(loan).toLocaleString()} | P&I: $${Math.round(pi).toLocaleString()}/mo | Tax+Ins: $${taxIns}/mo | PITI: $${piti}/mo

INCOME & EXPENSES:
Rent: $${p.est_rent.toLocaleString()}/mo | OpEx (35%): $${opex}/mo | Net CF: $${netCF}/mo | Annual CF: $${annualCF}

METRICS:
Cap rate: ${capRate}% | GRM: ${grm}x | Cash-on-cash: ${coc}% on $${Math.round(down).toLocaleString()} down | Break-even rent: $${breakEven}/mo

Rules: Use bullets for multi-part answers. Max 180 words unless full breakdown requested. State honestly if the deal looks weak.`;
}

const QUICK = [
  "💰 Full cash flow breakdown",
  "📊 Is this a good deal?",
  "🔄 What if I put 25% down?",
  "📉 Impact of 10% vacancy?",
  "⚠️ Main risks?",
  "🏆 Cash-on-cash return?",
];

function renderContent(text: string) {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={j} style={{ fontWeight: 700, color: "#f1f5f9" }}>{p.slice(2,-2)}</strong>
        : p
    );
    const isBullet = line.startsWith("•") || line.startsWith("-");
    return (
      <div key={i} style={{ lineHeight: 1.7, marginBottom: isBullet ? "2px" : line === "" ? "8px" : "0", paddingLeft: isBullet ? "4px" : "0" }}>
        {parts}
      </div>
    );
  });
}

export default function PropertyChat({ property, mortgageRate, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Greeting built locally — no API call needed
  useEffect(() => {
    const down   = Math.round(property.price * 0.20);
    const r      = mortgageRate / 100 / 12;
    const n      = 360;
    const loan   = property.price - down;
    const pi     = Math.round(loan * (r * Math.pow(1+r,n)) / (Math.pow(1+r,n)-1));
    const opex   = Math.round(property.est_rent * 0.35);
    const piti   = pi + Math.round(property.price * 0.015 / 12);
    const netCF  = property.est_rent - piti - opex;
    const coc    = ((netCF * 12) / down * 100).toFixed(1);
    const scoreE = property.ai_score >= 85 ? "🏆" : property.ai_score >= 70 ? "⭐" : property.ai_score >= 55 ? "✅" : "⚠️";

    setMessages([{
      role: "assistant",
      content: `${scoreE} **${property.address}**\n\n**Quick snapshot:**\n• 💵 Price: $${property.price.toLocaleString()}\n• 🏠 Rent: $${property.est_rent.toLocaleString()}/mo\n• 💰 Cash flow: $${netCF.toLocaleString()}/mo\n• 📈 Cap: ${property.cap_rate}% · CoC: ${coc}%\n• ${scoreE} AI Score: ${property.ai_score}/100\n\nAsk anything about this property.`,
    }]);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [property, mortgageRate]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setInput(""); setError("");

    const userMsg: Message = { role: "user", content: q };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/property-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property,
          mortgage_rate: mortgageRate,
          messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: { message?: string } }).error?.message || `API error ${res.status}`);
      }

      const data = await res.json();
      const reply = (data as { reply?: string }).reply || "No response received.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#131620", borderRadius:"14px", border:"1px solid rgba(139,92,246,0.2)", overflow:"hidden", boxShadow:"0 4px 30px rgba(0,0,0,0.4)" }}>

      {/* Header */}
      <div style={{ padding:"12px 16px", background:"linear-gradient(135deg,rgba(124,58,237,0.3),rgba(139,92,246,0.2))", borderBottom:"1px solid rgba(139,92,246,0.2)", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ width:"32px", height:"32px", borderRadius:"9px", background:"linear-gradient(135deg,#7c3aed,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px", boxShadow:"0 2px 10px rgba(124,58,237,0.4)" }}>🤖</div>
          <div>
            <div style={{ fontSize:"13px", fontWeight:700, color:"#f1f5f9" }}>AI Property Analyst</div>
            <div style={{ fontSize:"11px", color:"#64748b", maxWidth:"200px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>📍 {property.address}</div>
          </div>
        </div>
        <button onClick={onClose}
          style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.08)", color:"#94a3b8", cursor:"pointer", borderRadius:"7px", padding:"5px 9px", fontSize:"14px", lineHeight:1, transition:"all 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; }}>✕</button>
      </div>

      {/* Stat bar */}
      <div style={{ padding:"9px 16px", background:"rgba(255,255,255,0.02)", borderBottom:"1px solid rgba(139,92,246,0.1)", display:"flex", gap:"14px", flexShrink:0, overflowX:"auto" }}>
        {[
          { icon:"💵", lbl:"Price",    val:`$${property.price.toLocaleString()}`,      c:"#8b5cf6" },
          { icon:"🏠", lbl:"Rent",     val:`$${property.est_rent.toLocaleString()}/mo`, c:"#10b981" },
          { icon:"💰", lbl:"Cash Flow",val:`$${property.cash_flow.toLocaleString()}/mo`, c: property.cash_flow > 0 ? "#10b981" : "#ef4444" },
          { icon:"📈", lbl:"Cap Rate", val:`${property.cap_rate}%`,                    c:"#8b5cf6" },
          { icon:"🏆", lbl:"AI Score", val:`${property.ai_score}/100`,                 c: property.ai_score >= 70 ? "#10b981" : property.ai_score >= 50 ? "#f59e0b" : "#ef4444" },
        ].map(m => (
          <div key={m.lbl} style={{ flexShrink:0 }}>
            <div style={{ fontSize:"12px", fontWeight:800, color:m.c, fontFamily:"'JetBrains Mono',monospace", display:"flex", alignItems:"center", gap:"3px" }}><span>{m.icon}</span>{m.val}</div>
            <div style={{ fontSize:"10px", color:"#475569", fontWeight:600 }}>{m.lbl}</div>
          </div>
        ))}
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:"auto", padding:"14px", display:"flex", flexDirection:"column", gap:"10px" }}>
        {messages.map((m, i) => (
          <div key={i} className="msg-in" style={{ display:"flex", gap:"8px", flexDirection: m.role==="user" ? "row-reverse" : "row", alignItems:"flex-end" }}>
            {m.role === "assistant" && (
              <div style={{ width:"26px", height:"26px", borderRadius:"7px", background:"linear-gradient(135deg,#7c3aed,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"13px", flexShrink:0 }}>🤖</div>
            )}
            <div style={{
              maxWidth:"84%", padding:"10px 13px",
              borderRadius: m.role==="user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: m.role==="user" ? "linear-gradient(135deg,#7c3aed,#6d28d9)" : "rgba(255,255,255,0.04)",
              border: m.role==="user" ? "none" : "1px solid rgba(139,92,246,0.12)",
              color: m.role==="user" ? "#fff" : "#cbd5e1",
              fontSize:"13px", lineHeight:1.65,
              boxShadow: m.role==="user" ? "0 2px 10px rgba(124,58,237,0.3)" : "none",
            }}>
              {m.role === "assistant" ? renderContent(m.content) : m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="msg-in" style={{ display:"flex", gap:"8px", alignItems:"flex-end" }}>
            <div style={{ width:"26px", height:"26px", borderRadius:"7px", background:"linear-gradient(135deg,#7c3aed,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"13px" }}>🤖</div>
            <div style={{ padding:"10px 14px", borderRadius:"12px 12px 12px 2px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(139,92,246,0.12)" }}>
              <div style={{ display:"flex", gap:"4px", alignItems:"center" }}>
                {[0,1,2].map(j => <div key={j} style={{ width:"5px", height:"5px", borderRadius:"50%", background:"#8b5cf6", animation:`blink 1.2s infinite ${j*0.2}s` }}/>)}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding:"10px 13px", borderRadius:"8px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", fontSize:"13px", color:"#f87171" }}>⚠️ {error}</div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Quick questions */}
      <div style={{ padding:"8px 12px", borderTop:"1px solid rgba(139,92,246,0.1)", display:"flex", gap:"6px", overflowX:"auto", flexShrink:0 }}>
        {QUICK.map(q => (
          <button key={q} onClick={() => send(q)} disabled={loading}
            style={{ padding:"5px 10px", borderRadius:"20px", fontSize:"11px", fontWeight:600, border:"1px solid rgba(139,92,246,0.2)", color:"#a78bfa", background:"rgba(139,92,246,0.08)", cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, transition:"all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(139,92,246,0.18)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(139,92,246,0.08)"; }}>
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ padding:"10px 12px", borderTop:"1px solid rgba(139,92,246,0.1)", display:"flex", gap:"8px", flexShrink:0 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
          placeholder="Ask about cash flow, risks, financing..."
          disabled={loading}
          style={{ flex:1, padding:"10px 13px", borderRadius:"10px", border:"1px solid rgba(139,92,246,0.15)", fontSize:"13px", color:"#e2e8f0", background:"rgba(255,255,255,0.04)", fontFamily:"Inter,sans-serif", outline:"none", transition:"all 0.18s" }}
          onFocus={e => { e.target.style.borderColor = "rgba(139,92,246,0.4)"; e.target.style.boxShadow = "0 0 0 3px rgba(124,58,237,0.1)"; }}
          onBlur={e  => { e.target.style.borderColor = "rgba(139,92,246,0.15)"; e.target.style.boxShadow = "none"; }}
        />
        <button onClick={() => send(input)} disabled={loading || !input.trim()}
          style={{ padding:"10px 14px", borderRadius:"10px", background:(!input.trim()||loading)?"rgba(139,92,246,0.2)":"linear-gradient(135deg,#7c3aed,#6d28d9)", border:"1px solid rgba(139,92,246,0.3)", color:(!input.trim()||loading)?"#64748b":"#fff", fontSize:"16px", cursor:(!input.trim()||loading)?"not-allowed":"pointer", transition:"all 0.18s", flexShrink:0, boxShadow:(!input.trim()||loading)?"none":"0 2px 10px rgba(124,58,237,0.35)" }}>
          ↑
        </button>
      </div>
    </div>
  );
}

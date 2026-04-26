"use client";
interface Props { text:string; mortgageRate?:number; streaming?:boolean; }
export default function AIAnalysisCard({ text, mortgageRate, streaming }:Props) {
  return (
    <div style={{background:"var(--bg-surf)",border:"1px solid var(--bd-hi)",borderRadius:"14px",padding:"15px 18px",position:"relative",overflow:"hidden",boxShadow:"var(--shd-sm)"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:"3px",background:"linear-gradient(90deg,#2563eb,#4f9eff,#06b6d4)"}}/>
      <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
        <div style={{width:"33px",height:"33px",borderRadius:"9px",background:"linear-gradient(135deg,var(--pri),var(--pri-hi))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",boxShadow:"0 2px 8px rgba(124,58,237,.3)"}}>🤖</div>
        <div>
          <div style={{fontSize:"13px",fontWeight:700,color:"var(--pri-hi)"}}>🧠 NetFlow AI · Market Analysis</div>
          <div style={{fontSize:"11px",color:"var(--t3)",fontFamily:"'JetBrains Mono',monospace"}}>
            Llama 3 · LangChain · LangSmith{mortgageRate?` · 🏦 FRED: ${mortgageRate}%`:""}
          </div>
        </div>
      </div>
      <div style={{fontSize:"13px",lineHeight:1.8,color:"var(--t2)"}}>
        {text
          ? <>{text}{streaming&&<span className="ai-typing"/>}</>
          : <><span style={{color:"var(--t3)",fontStyle:"italic"}}>✨ Generating market analysis...</span><span className="ai-typing"/></>
        }
      </div>
    </div>
  );
}

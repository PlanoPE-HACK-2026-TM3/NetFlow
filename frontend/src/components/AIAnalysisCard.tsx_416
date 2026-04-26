"use client";
interface Props { text:string; mortgageRate?:number; streaming?:boolean; }
export default function AIAnalysisCard({text,mortgageRate,streaming}:Props){
  return(
    <div style={{background:"rgba(139,92,246,0.06)",border:"1px solid rgba(139,92,246,0.2)",borderRadius:"14px",padding:"18px 22px",position:"relative",overflow:"hidden",boxShadow:"0 2px 20px rgba(124,58,237,0.1)"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:"2px",background:"linear-gradient(90deg,#7c3aed,#8b5cf6,#06b6d4)"}}/>
      <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"12px"}}>
        <div style={{width:"36px",height:"36px",borderRadius:"10px",background:"linear-gradient(135deg,#7c3aed,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",boxShadow:"0 2px 10px rgba(124,58,237,0.4)"}}>🤖</div>
        <div>
          <div style={{fontSize:"14px",fontWeight:700,color:"#a78bfa"}}>🧠 NetFlow AI · Market Analysis</div>
          <div style={{fontSize:"11px",color:"#475569",fontFamily:"'JetBrains Mono',monospace"}}>Llama 3 · LangChain · LangSmith{mortgageRate?` · 🏦 FRED: ${mortgageRate}%`:""}</div>
        </div>
      </div>
      <div style={{fontSize:"14px",lineHeight:1.8,color:"#cbd5e1"}}>
        {text?<>{text}{streaming&&<span className="ai-typing"/>}</>:<><span style={{color:"#475569",fontStyle:"italic"}}>✨ Generating market analysis...</span><span className="ai-typing"/></>}
      </div>
    </div>
  );
}

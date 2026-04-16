export default function Loading() {
  return (
    <div className="min-h-screen bg-[#050a14] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-blue-900/30 border-t-blue-400 rounded-full animate-spin" />
        <p className="text-slate-500 font-mono text-sm">Loading NetFlow...</p>
      </div>
    </div>
  );
}

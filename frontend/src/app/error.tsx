"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#050a14] flex items-center justify-center text-slate-200">
      <div className="text-center max-w-md px-6">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
        <p className="text-slate-400 text-sm mb-6 font-mono">{error.message}</p>
        <button
          onClick={reset}
          className="px-5 py-2.5 rounded-xl bg-blue-800 hover:bg-blue-700 border border-blue-600/30 text-white text-sm font-semibold transition-all"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

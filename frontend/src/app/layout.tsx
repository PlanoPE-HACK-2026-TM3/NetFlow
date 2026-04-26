import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NetFlow — Real Estate Investment",
  description: "Real estate investment property analysis.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      {/*
        suppressHydrationWarning on <body> prevents the React hydration mismatch
        warning caused by browser extensions (Grammarly, LastPass, etc.) that inject
        attributes like data-new-gr-c-s-check-loaded and data-gr-ext-installed onto
        the body element before React hydrates. These attributes are harmless but
        cause React to complain about server/client HTML mismatches.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

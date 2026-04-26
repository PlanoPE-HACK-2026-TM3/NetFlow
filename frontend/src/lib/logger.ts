/**
 * NetFlow — Application Logger
 * Lightweight client-side logger with persistent IndexedDB storage.
 * Logs key actions (search, login, AI calls) and errors to console + DB.
 */

import { DB_NAME, DB_VERSION, initDB } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  id?:       number;
  ts:        number;
  level:     LogLevel;
  category:  string;   // "auth" | "search" | "ai" | "nav" | "api" | "ui"
  message:   string;
  meta?:     Record<string, unknown>;
}

// In-memory ring buffer (last 200 entries)
const BUFFER: LogEntry[] = [];
const MAX_BUFFER = 200;

// Colours for console output
const COLOURS: Record<LogLevel, string> = {
  info:  "color:#818cf8;font-weight:600",
  warn:  "color:#f59e0b;font-weight:600",
  error: "color:#ef4444;font-weight:600",
  debug: "color:#64748b",
};

function write(level: LogLevel, category: string, message: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = { ts: Date.now(), level, category, message, meta };

  // Console output
  const prefix = `%c[NF:${category.toUpperCase()}]`;
  if (level === "error") {
    console.error(prefix, COLOURS[level], message, meta ?? "");
  } else if (level === "warn") {
    console.warn(prefix, COLOURS[level], message, meta ?? "");
  } else if (level === "debug") {
    if (process.env.NODE_ENV === "development") console.debug(prefix, COLOURS[level], message, meta ?? "");
  } else {
    console.log(prefix, COLOURS[level], message, meta ?? "");
  }

  // Ring buffer
  BUFFER.push(entry);
  if (BUFFER.length > MAX_BUFFER) BUFFER.shift();

  // Persist to IndexedDB (fire-and-forget)
  persistLog(entry).catch(() => {});
}

async function persistLog(entry: LogEntry) {
  if (typeof indexedDB === "undefined") return;
  await initDB();
  return new Promise<void>((res) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("appLogs")) { db.close(); res(); return; }
      const t = db.transaction("appLogs", "readwrite");
      t.objectStore("appLogs").add(entry);
      t.oncomplete = () => { db.close(); res(); };
      t.onerror    = () => { db.close(); res(); };
    };
    req.onerror = () => res();
  });
}

// Public API
export const logger = {
  info:  (cat: string, msg: string, meta?: Record<string,unknown>) => write("info",  cat, msg, meta),
  warn:  (cat: string, msg: string, meta?: Record<string,unknown>) => write("warn",  cat, msg, meta),
  error: (cat: string, msg: string, meta?: Record<string,unknown>) => write("error", cat, msg, meta),
  debug: (cat: string, msg: string, meta?: Record<string,unknown>) => write("debug", cat, msg, meta),
  getBuffer: () => [...BUFFER],
};

// Convenience named loggers
export const log = {
  auth:   (msg: string, meta?: Record<string,unknown>) => logger.info("auth",   msg, meta),
  search: (msg: string, meta?: Record<string,unknown>) => logger.info("search", msg, meta),
  ai:     (msg: string, meta?: Record<string,unknown>) => logger.info("ai",     msg, meta),
  api:    (msg: string, meta?: Record<string,unknown>) => logger.info("api",    msg, meta),
  nav:    (msg: string, meta?: Record<string,unknown>) => logger.info("nav",    msg, meta),
  ui:     (msg: string, meta?: Record<string,unknown>) => logger.info("ui",     msg, meta),
  err:    (cat: string, msg: string, meta?: Record<string,unknown>) => logger.error(cat, msg, meta),
  warn:   (cat: string, msg: string, meta?: Record<string,unknown>) => logger.warn(cat,  msg, meta),
};

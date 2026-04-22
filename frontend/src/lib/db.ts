/**
 * NetFlow — lightweight IndexedDB wrapper
 *
 * Stores:
 *   users        — { username, passwordHash, role, createdAt }
 *   loginHistory — { id, username, ts, success, ip? }
 *   searchHistory — { id, username, prompt, params, resultCount, ts }
 *
 * All operations are async. DB auto-creates on first open.
 * No external dependencies — native browser IndexedDB.
 */

const DB_NAME    = "netflow_db";
const DB_VERSION = 2;

// ── Simple SHA-256 hash using Web Crypto ─────────────────────
export async function hashPassword(plain: string): Promise<string> {
  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── Open DB ───────────────────────────────────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("users")) {
        const us = db.createObjectStore("users", { keyPath: "username" });
        us.createIndex("role", "role", { unique: false });
      }

      if (!db.objectStoreNames.contains("loginHistory")) {
        const lh = db.createObjectStore("loginHistory", { keyPath: "id", autoIncrement: true });
        lh.createIndex("username", "username", { unique: false });
        lh.createIndex("ts",       "ts",       { unique: false });
      }

      if (!db.objectStoreNames.contains("searchHistory")) {
        const sh = db.createObjectStore("searchHistory", { keyPath: "id", autoIncrement: true });
        sh.createIndex("username", "username", { unique: false });
        sh.createIndex("ts",       "ts",       { unique: false });
      }

      // appLogs store used by src/lib/logger.ts. Must be created here so the
      // two open()s against netflow_db don't race into a version-1 DB that's
      // missing whichever file opened second.
      if (!db.objectStoreNames.contains("appLogs")) {
        const al = db.createObjectStore("appLogs", { keyPath: "id", autoIncrement: true });
        al.createIndex("ts",    "ts",    { unique: false });
        al.createIndex("level", "level", { unique: false });
      }
    };

    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror   = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    r.onsuccess = () => resolve(r.result);
    r.onerror   = () => reject(r.error);
  });
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const r = t.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror   = () => reject(r.error);
  });
}

function getAllByIndex<T>(
  db: IDBDatabase, store: string, index: string, value: IDBValidKey
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const r = t.objectStore(store).index(index).getAll(value);
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror   = () => reject(r.error);
  });
}

// ── Types ──────────────────────────────────────────────────────

export interface DBUser {
  username:     string;
  passwordHash: string;
  role:         "admin" | "user";
  createdAt:    number;
  displayName?: string;
}

export interface LoginRecord {
  id?:      number;
  username: string;
  ts:       number;
  success:  boolean;
  reason?:  string;
}

export interface SearchRecord {
  id?:         number;
  username:    string;
  prompt:      string;
  params:      Record<string, unknown>;
  resultCount: number;
  ts:          number;
}

// ── User management ───────────────────────────────────────────

export async function seedDefaultUser() {
  const db   = await openDB();
  const user = await tx<DBUser | undefined>(db, "users", "readonly", s => s.get("admin"));
  if (!user) {
    const hash = await hashPassword("admin");
    await tx(db, "users", "readwrite", s => s.put({
      username: "admin", passwordHash: hash,
      role: "admin", createdAt: Date.now(), displayName: "Administrator",
    }));
  }
  db.close();
}

export async function validateLogin(username: string, password: string): Promise<DBUser | null> {
  const db   = await openDB();
  const user = await tx<DBUser | undefined>(db, "users", "readonly", s => s.get(username.toLowerCase().trim()));
  db.close();
  if (!user) return null;
  const hash = await hashPassword(password);
  return hash === user.passwordHash ? user : null;
}

export async function getAllUsers(): Promise<DBUser[]> {
  const db = await openDB();
  const r  = await getAll<DBUser>(db, "users");
  db.close();
  return r;
}

export async function addUser(username: string, password: string, role: "admin"|"user" = "user", displayName?: string) {
  const db   = await openDB();
  const hash = await hashPassword(password);
  await tx(db, "users", "readwrite", s => s.put({
    username: username.toLowerCase().trim(),
    passwordHash: hash, role, createdAt: Date.now(),
    displayName: displayName || username,
  }));
  db.close();
}

export async function updatePassword(username: string, newPassword: string) {
  const db   = await openDB();
  const user = await tx<DBUser | undefined>(db, "users", "readonly", s => s.get(username));
  if (!user) { db.close(); return; }
  const hash = await hashPassword(newPassword);
  await tx(db, "users", "readwrite", s => s.put({ ...user, passwordHash: hash }));
  db.close();
}

// ── Login history ─────────────────────────────────────────────

export async function recordLogin(rec: Omit<LoginRecord, "id">) {
  const db = await openDB();
  await tx(db, "loginHistory", "readwrite", s => s.add(rec));
  db.close();
}

export async function getLoginHistory(username?: string): Promise<LoginRecord[]> {
  const db = await openDB();
  const r  = username
    ? await getAllByIndex<LoginRecord>(db, "loginHistory", "username", username)
    : await getAll<LoginRecord>(db, "loginHistory");
  db.close();
  return r.sort((a, b) => (b.ts - a.ts));
}

// ── Search history ────────────────────────────────────────────

export async function recordSearch(rec: Omit<SearchRecord, "id">) {
  const db = await openDB();
  await tx(db, "searchHistory", "readwrite", s => s.add(rec));
  // Keep max 100 records per user — trim oldest
  const all = await getAllByIndex<SearchRecord>(db, "searchHistory", "username", rec.username);
  if (all.length > 100) {
    const sorted = all.sort((a,b) => a.ts - b.ts);
    const toDelete = sorted.slice(0, all.length - 100);
    const t = db.transaction("searchHistory", "readwrite");
    const store = t.objectStore("searchHistory");
    toDelete.forEach(r => r.id !== undefined && store.delete(r.id));
  }
  db.close();
}

export async function getSearchHistory(username: string): Promise<SearchRecord[]> {
  const db = await openDB();
  const r  = await getAllByIndex<SearchRecord>(db, "searchHistory", "username", username);
  db.close();
  return r.sort((a, b) => b.ts - a.ts);
}

export async function clearSearchHistory(username: string) {
  const db      = await openDB();
  const records = await getAllByIndex<SearchRecord>(db, "searchHistory", "username", username);
  const t = db.transaction("searchHistory", "readwrite");
  const s = t.objectStore("searchHistory");
  records.forEach(r => r.id !== undefined && s.delete(r.id));
  db.close();
}

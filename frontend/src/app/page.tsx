"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { log, logger } from "@/lib/logger";
import SearchPanel, {
  getCachedResult,
  setCachedResult,
} from "@/components/SearchPanel";
import PropertyGrid from "@/components/PropertyGrid";
import ComparisonCharts from "@/components/ComparisonCharts";
import PropertyChat from "@/components/PropertyChat";
import type { SearchParams, SearchResult, Property } from "@/lib/types";
import AgentPanel from "@/components/AgentPanel";
import {
  seedDefaultUser,
  validateLogin,
  recordLogin,
  recordSearch,
  getLoginHistory,
  getSearchHistory,
  clearSearchHistory,
  getFavorites,
  addFavorite,
  removeFavorite,
  type LoginRecord,
  type SearchRecord,
  type DBUser,
} from "@/lib/db";
import styles from "./page.module.css";

const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:8000";

// ─── Theme Toggle ────────────────────────────────────────────────
function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: string;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      aria-label="Toggle theme"
      className={styles.themeToggle}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

// ─── Login Page ───────────────────────────────────────────────────
function LoginPage({
  onLogin,
  theme,
  onToggleTheme,
}: {
  onLogin: (u: DBUser) => void;
  theme: string;
  onToggleTheme: () => void;
}) {
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<LoginRecord[]>([]);
  const [showH, setShowH] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    log.auth("LoginPage mounted");
    seedDefaultUser().then(() => {
      setReady(true);
      getLoginHistory().then((h) => setHist(h.slice(0, 10)));
    });
  }, []);

  const doLogin = async () => {
    const u = user.trim(),
      p = pw.trim();
    if (!u || !p) {
      setErr("Username and password required.");
      return;
    }
    setErr("");
    setBusy(true);
    log.auth("Login attempt", { username: u });
    try {
      const dbUser = await validateLogin(u, p);
      if (dbUser) {
        await recordLogin({ username: u, ts: Date.now(), success: true });
        log.auth("Login success", { username: u, role: dbUser.role });
        onLogin(dbUser);
      } else {
        await recordLogin({
          username: u,
          ts: Date.now(),
          success: false,
          reason: "Invalid credentials",
        });
        log.warn("auth", "Login failed", { username: u });
        setErr("Invalid username or password.");
        setHist(await getLoginHistory().then((h) => h.slice(0, 10)));
      }
    } catch (e) {
      log.err("auth", "Login error", { e: String(e) });
      setErr("Login error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      <div className={styles.themeToggleFixed}>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className={styles.loginCard}>
        <div className={styles.loginCardTop} />
        <div className={styles.logoHeader}>
          <div className={styles.logoIcon}>
            🏘️
          </div>
          <div className={styles.logoText}>
            Net<span className={styles.logoTextSpan}>Flow</span>
          </div>
          <div className={styles.logoSubtext}>
            Real Estate Investment Intelligence
          </div>
        </div>

        <div className={styles.loginTitle}>
          Welcome back
        </div>
        <div className={styles.loginSubtitle}>
          Sign in to your dashboard
        </div>

        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>
            👤 Username
          </label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
            placeholder="Enter username"
            className={`${styles.inputField} ${err ? styles.inputFieldError : ""}`}
            autoComplete="username"
          />
        </div>

        <div className={styles.inputGroupLast}>
          <label className={styles.inputLabel}>
            🔒 Password
          </label>
          <div className={styles.passwordWrapper}>
            <input
              type={showPw ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
              placeholder="Enter password"
              className={`${styles.inputField} ${styles.passwordField} ${err ? styles.inputFieldError : ""}`}
              autoComplete="current-password"
            />
            <button
              onClick={() => setShowPw(!showPw)}
              className={styles.passwordToggle}
            >
              {showPw ? "🙈" : "👁"}
            </button>
          </div>
        </div>

        {err && (
          <div className={styles.errorMessage}>
            ⚠️ {err}
          </div>
        )}

        <button
          onClick={doLogin}
          disabled={busy || !ready}
          className={styles.loginButton}
        >
          {busy ? (
            <>
              <div className={styles.spinnerSmall} />
              Signing in...
            </>
          ) : (
            <>🔐 Sign In</>
          )}
        </button>

        {hist.length > 0 && (
          <div className={styles.historyToggleWrapper}>
            <button
              onClick={() => setShowH((v) => !v)}
              className={styles.historyToggleBtn}
            >
              <span className={styles.historyToggleText}>
                🕑 Recent Login Activity
              </span>
              <span className={styles.historyToggleIcon}>
                {showH ? "▲" : "▼"}
              </span>
            </button>
            {showH && (
              <div className={styles.historyList}>
                {hist.map((h, i) => (
                  <div
                    key={i}
                    className={`${styles.historyItem} ${h.success ? styles.historyItemSuccess : styles.historyItemFail}`}
                  >
                    <div className={styles.historyItemLeft}>
                      <span className={styles.historyItemIcon}>
                        {h.success ? "✅" : "❌"}
                      </span>
                      <span className={`${styles.historyItemUser} ${h.success ? styles.historyItemUserSuccess : styles.historyItemUserFail}`}>
                        {h.username}
                      </span>
                      {!h.success && (
                        <span className={styles.historyItemReason}>
                          — {h.reason}
                        </span>
                      )}
                    </div>
                    <span className={styles.historyItemDate}>
                      {new Date(h.ts).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.featuresList}>
          {[
            { icon: "✨", l: "Smart Search" },
            { icon: "🏆", l: "Scores" },
            { icon: "🗺️", l: "Maps" },
            { icon: "💬", l: "Chat" },
          ].map((f) => (
            <div key={f.l} className={styles.featureItem}>
              <span className={styles.featureIcon}>{f.icon}</span>
              <span className={styles.featureLabel}>
                {f.l}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── User Menu ─────────────────────────────────────────────────
function UserMenu({
  user,
  onLogout,
  loginHistory,
  searchHistory,
  onClearSearch,
}: {
  user: DBUser;
  onLogout: () => void;
  loginHistory: LoginRecord[];
  searchHistory: SearchRecord[];
  onClearSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"logins" | "searches">("logins");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className={styles.userMenuWrapper}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={styles.userMenuBtn}
      >
        <div className={styles.userAvatar}>
          {(user.displayName || user.username)[0].toUpperCase()}
        </div>
        <span
          className={`hide-mob ${styles.userName}`}
        >
          {user.displayName || user.username}
        </span>
        <span className={`hide-mob ${styles.userCaret}`}>
          ▼
        </span>
      </button>
      {open && (
        <div
          className={`pop-in ${styles.userDropdown}`}
        >
          <div className={styles.userDropdownHeader}>
            <div className={`${styles.userAvatar} ${styles.userAvatarLarge}`}>
              {(user.displayName || user.username)[0].toUpperCase()}
            </div>
            <div>
              <div className={styles.userDropdownName}>
                {user.displayName || user.username}
              </div>
              <div className={styles.userDropdownRole}>
                @{user.username} · {user.role}
              </div>
            </div>
          </div>
          <div className={styles.userTabs}>
            {(["logins", "searches"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`${styles.userTab} ${tab === t ? styles.userTabActive : ""}`}
              >
                {t === "logins" ? "🔐 Logins" : "🔍 Searches"}
              </button>
            ))}
          </div>
          <div className={styles.userTabContent}>
            {tab === "logins" &&
              (loginHistory.length === 0 ? (
                <div className={styles.userTabEmpty}>
                  No login history.
                </div>
              ) : (
                loginHistory.slice(0, 12).map((h, i) => (
                  <div
                    key={i}
                    className={`${styles.userLoginItem} ${h.success ? styles.userLoginItemSuccess : styles.userLoginItemFail}`}
                  >
                    <span className={`${styles.userLoginStatus} ${h.success ? styles.userLoginStatusSuccess : styles.userLoginStatusFail}`}>
                      {h.success ? "✅ Success" : "❌ Failed"}
                    </span>
                    <span className={styles.userItemDate}>
                      {new Date(h.ts).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))
              ))}
            {tab === "searches" &&
              (searchHistory.length === 0 ? (
                <div className={styles.userTabEmpty}>
                  No searches yet.
                </div>
              ) : (
                <>
                  {searchHistory.slice(0, 12).map((h, i) => (
                    <div
                      key={i}
                      className={styles.userSearchItem}
                    >
                      <div className={styles.userSearchPrompt}>
                        🔍 {h.prompt}
                      </div>
                      <div className={styles.userSearchMeta}>
                        <span>{h.resultCount} results</span>
                        <span className={styles.userItemDate}>
                          {new Date(h.ts).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={onClearSearch}
                    className={styles.clearHistoryBtn}
                  >
                    🗑️ Clear search history
                  </button>
                </>
              ))}
          </div>
          <div className={styles.userSignOutWrapper}>
            <button
              onClick={onLogout}
              className={styles.userSignOutBtn}
            >
              <svg
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App Log Viewer ────────────────────────────────────────────
function LogViewer({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<
    Array<{ ts: number; level: string; category: string; message: string }>
  >([]);
  useEffect(() => {
    setEntries([...logger.getBuffer()].reverse().slice(0, 80));
  }, []);
  return (
    <div className={`pop-in ${styles.logOverlay}`}>
      <div className={styles.logModal}>
        <div className={styles.logHeader}>
          <div>
            <div className={styles.logTitle}>
              🪵 Application Log
            </div>
            <div className={styles.logSubtitle}>
              Last {entries.length} entries (ring buffer 200 max)
            </div>
          </div>
          <button
            onClick={onClose}
            className={styles.logCloseBtn}
          >
            ✕ Close
          </button>
        </div>
        <div className={styles.logContent}>
          {entries.length === 0 ? (
            <div className={styles.logEmpty}>
              No log entries yet.
            </div>
          ) : (
            entries.map((e, i) => (
              <div key={i} className={`log-row log-${e.level}`}>
                <span className={styles.logTime}>
                  {new Date(e.ts).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className={`${styles.logLevel} ${
                  e.level === "error" ? styles.logLevelError :
                  e.level === "warn" ? styles.logLevelWarn : styles.logLevelInfo
                }`}>
                  [{e.category.toUpperCase()}]
                </span>
                <span className={styles.logMessage}>{e.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────
export default function Home() {
  const [theme, setTheme] = useState("dark");
  const [currentUser, setCurrentUser] = useState<DBUser | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [chatProp, setChatProp] = useState<Property | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [tab, setTab] = useState<"list" | "charts" | "favorites">("list");
  const [favAddresses, setFavAddresses] = useState<Set<string>>(new Set());
  const [favList, setFavList] = useState<Property[]>([]);
  const [loginHist, setLoginHist] = useState<LoginRecord[]>([]);
  const [searchHist, setSearchHist] = useState<SearchRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clarifyMsg, setClarifyMsg] = useState("");
  const [suggestedPrompt, setSuggestedPrompt] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showAgent, setShowAgent] = useState(false);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    log.ui("Theme changed", { theme });
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  const loadHistories = useCallback(async (username: string) => {
    const [lh, sh, favs] = await Promise.all([
      getLoginHistory(username),
      getSearchHistory(username),
      getFavorites(username),
    ]);
    setLoginHist(lh);
    setSearchHist(sh);
    setFavAddresses(new Set(favs.map((f) => f.address)));
    setFavList(favs.map((f) => f.property as unknown as Property));
  }, []);

  const handleLogin = useCallback(
    async (user: DBUser) => {
      setCurrentUser(user);
      await loadHistories(user.username);
    },
    [loadHistories],
  );

  const handleLogout = useCallback(async () => {
    if (currentUser)
      await recordLogin({
        username: currentUser.username,
        ts: Date.now(),
        success: false,
        reason: "User signed out",
      });
    log.auth("User signed out");
    setCurrentUser(null);
    setResult(null);
    setChatProp(null);
    setLastQuery("");
    setFavAddresses(new Set());
    setFavList([]);
  }, [currentUser]);

  const toggleFavorite = useCallback(
    (p: Property) => {
      if (!currentUser) return;
      setFavAddresses((prev) => {
        const next = new Set(prev);
        if (next.has(p.address)) {
          next.delete(p.address);
          removeFavorite(currentUser.username, p.address);
        } else {
          next.add(p.address);
          addFavorite({
            username: currentUser.username,
            address: p.address,
            property: p as unknown as Record<string, unknown>,
            ts: Date.now(),
          });
        }
        return next;
      });
      setFavList((prev) =>
        prev.some((f) => f.address === p.address)
          ? prev.filter((f) => f.address !== p.address)
          : [p, ...prev],
      );
    },
    [currentUser],
  );

  const handleSelectProp = useCallback((p: Property) => setChatProp(p), []);
  const handleSelectPropToggle = useCallback(
    (p: Property) =>
      setChatProp((prev) => (prev?.address === p.address ? null : p)),
    [],
  );

  const handleSearch = useCallback(
    async (params: SearchParams & { prompt_text?: string }) => {
      const queryLabel = params.prompt_text || params.zip_code || "";
      setLastQuery(queryLabel);
      log.search("Search initiated", { query: queryLabel, params });

      const cached = getCachedResult(params);
      if (cached) {
        const r = cached as SearchResult;
        setResult(r);
        setStatusMsg("");
        setChatProp(null);
        log.search("Cache hit", { query: queryLabel });
        return;
      }

      setLoading(true);
      setResult(null);
      setChatProp(null);
      setStatusMsg("Starting search...");
      setClarifyMsg("");
      setSuggestedPrompt("");
      setSidebarOpen(false);

      try {
        const res = await fetch(`${API_BASE}/api/search/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        if (!res.ok) throw new Error(`Backend ${res.status}`);
        if (!res.body) return;
        const reader = res.body.getReader();
        const dec = new TextDecoder("utf-8", { fatal: false });
        let partial: Partial<SearchResult> = {};
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep the last incomplete line in the buffer

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "clarify") {
                setStatusMsg("");
                setLoading(false);
                setClarifyMsg(ev.msg || "");
                setSuggestedPrompt(ev.suggested_prompt || "");
                log.warn("search", "Clarification needed", { msg: ev.msg });
              } else if (ev.type === "status") {
                setStatusMsg(ev.msg);
                log.api("SSE status", { msg: ev.msg });
              } else if (ev.type === "properties") {
                partial = {
                  ...partial,
                  properties: ev.data,
                  mortgage_rate: ev.mortgage_rate,
                  zip_code: ev.zip_code,
                  location_display: ev.location_display,
                };
                setResult(partial as SearchResult);
                setLoading(false);
                setTab("list");
                setCachedResult(params, partial as SearchResult);
                log.search("Properties received", {
                  count: ev.data?.length || 0,
                  zip: ev.zip_code,
                });
                if (currentUser)
                  recordSearch({
                    username: currentUser.username,
                    prompt: queryLabel,
                    params: params as unknown as Record<string, unknown>,
                    resultCount: ev.data?.length || 0,
                    ts: Date.now(),
                  }).then(() =>
                    getSearchHistory(currentUser.username).then(setSearchHist),
                  );
              } else if (ev.type === "done") {
                setStatusMsg("");
                log.search("Search complete");
              } else if (ev.type === "error") {
                setStatusMsg(`❌ ${ev.msg}`);
                setLoading(false);
                log.err("search", `SSE error: ${ev.msg}`);
              }
            } catch (_) {}
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown";
        setStatusMsg(`Error: ${msg}`);
        setLoading(false);
        log.err("search", `Search failed: ${msg}`);
      }
    },
    [currentUser],
  );

  const handleHistorySelect = useCallback(
    (prompt: string) => {
      const record = searchHist.find((h) => h.prompt === prompt);
      const params = record?.params
        ? (record.params as unknown as SearchParams)
        : ({
            zip_code: "75070",
            budget: 450000,
            property_type: "SFH",
            min_beds: 3,
            strategy: "LTR",
          } as SearchParams);
      handleSearch({ ...params, prompt_text: prompt });
    },
    [handleSearch, searchHist],
  );

  const displayProps = useMemo(
    () => result?.properties.slice(0, 5) ?? [],
    [result],
  );

  if (!currentUser)
    return (
      <LoginPage
        onLogin={handleLogin}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );

  return (
    <div className={`app-shell ${styles.appShellWrapper}`}>
      {/* ── HEADER ─────────────────────────────────────────────── */}
      <header className="app-header">
        {/* Left: hamburger (mobile) + logo */}
        <div className={styles.headerLeft}>
          <button
            className={`mob-btn ${styles.mobBtn}`}
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className={styles.headerLogoIcon}>
            🏘️
          </div>
          <div>
            <div className={styles.headerLogoText}>
              Net<span className={styles.logoTextSpan}>Flow</span>
            </div>
            <div className={`hide-mob ${styles.headerLogoSubtext}`}>
              Real estate investment
            </div>
          </div>
        </div>

        {/* Centre: scrolling market ticker */}
        <div
          className={`hide-mob ${styles.tickerWrapper}`}
        >
          <span className={styles.tickerText}>
            📊&nbsp;MARKET SNAPSHOT&nbsp;·&nbsp;🏦&nbsp;30yr Fixed:&nbsp;
            <span className={styles.tickerValue}>7.2%</span>
            &nbsp;·&nbsp;📈&nbsp;Avg Cap Rate:&nbsp;
            <span className={styles.tickerValue}>5.8%</span>
            &nbsp;·&nbsp;💰&nbsp;Median Rent:&nbsp;
            <span className={styles.tickerValue}>$2,140/mo</span>
            &nbsp;·&nbsp;📅&nbsp;Avg DOM:&nbsp;
            <span className={styles.tickerValue}>28d</span>
            &nbsp;·&nbsp;🏠&nbsp;Median List:&nbsp;
            <span className={styles.tickerValue}>$389K</span>
            &nbsp;·&nbsp;📉&nbsp;Vacancy:&nbsp;
            <span className={styles.tickerValue}>5.1%</span>
            &nbsp;·&nbsp;💵&nbsp;P/R Ratio:&nbsp;
            <span className={styles.tickerValue}>15.2x</span>
            &nbsp;·&nbsp;🔑&nbsp;Cash-on-Cash:&nbsp;
            <span className={styles.tickerValue}>6.4%</span>
            &nbsp;&nbsp;&nbsp;
          </span>
        </div>

        {/* Right controls */}
        <div className={styles.headerRight}>
          {result && (
            <div className={styles.topPickBadge}>
              <div className={styles.topPickDot} />
              <span className="hide-mob">
                Top {Math.min(result.properties.length, 5)} ·{" "}
                {result.location_display || result.zip_code}
              </span>
              <span className="show-mob">
                Top {Math.min(result.properties.length, 5)}
              </span>
            </div>
          )}
          <button
            onClick={() => setShowLog(true)}
            title="View application log"
            className={`hide-mob ${styles.iconBtn}`}
          >
            🪵
          </button>
          <button
            onClick={() => setShowAgent(true)}
            title="Pipeline & observability"
            className={`hide-mob ${styles.iconBtn}`}
          >
            🤖
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <UserMenu
            user={currentUser}
            onLogout={handleLogout}
            loginHistory={loginHist}
            searchHistory={searchHist}
            onClearSearch={async () => {
              if (currentUser) {
                await clearSearchHistory(currentUser.username);
                setSearchHist([]);
                log.ui("Search history cleared");
              }
            }}
          />
        </div>
      </header>

      {/* ── BODY ───────────────────────────────────────────────── */}
      <div className="app-body">
        {/* Mobile overlay */}
        <div
          className={`mob-overlay${sidebarOpen ? " open" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* ── FROZEN LEFT PANEL ──────────────────────────────── */}
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          {/* Mobile close */}
          <div className={`show-mob ${styles.mobileCloseHeader}`}>
            <span className={styles.sidebarTitle}>
              Search
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className={styles.mobileCloseBtn}
            >
              ✕
            </button>
          </div>
          <SearchPanel
            onSearch={handleSearch}
            loading={loading}
            statusMsg={statusMsg}
            searchHistory={searchHist}
            onHistorySelect={handleHistorySelect}
          />
        </aside>

        {/* ── MAIN CONTENT ───────────────────────────────────── */}
        <main className="main-content">
          {/* Clarification banner */}
          {clarifyMsg && !loading && !result && (
            <div className={styles.clarifyBanner}>
              <div className={styles.clarifyHeader}>
                <span className={styles.clarifyIcon}>💬</span>
                <div>
                  <div className={styles.clarifyTitle}>
                    Need a bit more detail
                  </div>
                  <div className={styles.clarifyText}>
                    {clarifyMsg}
                  </div>
                </div>
              </div>
              {suggestedPrompt && (
                <div className={styles.clarifyActions}>
                  <span className={styles.clarifyHintText}>
                    Try:
                  </span>
                  <button
                    onClick={() =>
                      handleSearch({
                        zip_code: "",
                        budget: 450000,
                        property_type: "SFH",
                        min_beds: 3,
                        strategy: "LTR",
                        prompt_text: suggestedPrompt,
                      })
                    }
                    className={styles.suggestedBtn}
                  >
                    ✨ {suggestedPrompt}
                  </button>
                  <button
                    onClick={() => {
                      setClarifyMsg("");
                      setSuggestedPrompt("");
                    }}
                    className={styles.dismissBtn}
                  >
                    ✕ Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className={styles.loadingContainer}>
              <div className={`spinner ${styles.loadingSpinner}`} />
              <div className={styles.textCenter}>
                <div className={styles.loadingTextTitle}>
                  Searching properties...
                </div>
                <div className={styles.loadingTextSub}>
                  {statusMsg}
                </div>
              </div>
            </div>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Query badge row */}
              <div className={styles.queryBadgeRow}>
                {lastQuery && (
                  <div className={styles.queryBadge}>
                    ✨ "{lastQuery}"
                  </div>
                )}
                <div className={styles.queryDate}>
                  {result.location_display || result.zip_code} ·{" "}
                  {new Date().toLocaleDateString()}
                </div>
              </div>

              {/* Tab bar + title */}
              <div className={styles.tabBarHeader}>
                <div>
                  <div className={styles.tabTitle}>
                    🏆 Top 5 Investment Properties
                  </div>
                </div>
                <div className={styles.tabGroup}>
                  {(["list", "charts", "favorites"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTab(t);
                        log.nav("Tab changed", { tab: t });
                      }}
                      className={`${styles.tabButton} ${tab === t ? styles.tabButtonActive : ""}`}
                    >
                      {t === "list"
                        ? "📋 Cards"
                        : t === "charts"
                          ? "📊 Charts"
                          : `❤️ Saved${favList.length > 0 ? ` (${favList.length})` : ""}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cards view */}
              {tab === "list" && (
                <>
                  {/* Cards + optional chat split */}
                  {!chatProp && (
                    <PropertyGrid
                      properties={displayProps}
                      onSelectProperty={handleSelectProp}
                      selectedProperty={chatProp}
                      favorites={favAddresses}
                      onToggleFavorite={toggleFavorite}
                    />
                  )}
                  {chatProp && (
                    <div
                      className={styles.splitViewContainer}
                    >
                      <div className={styles.splitViewLeft}>
                        <PropertyGrid
                          properties={displayProps}
                          onSelectProperty={handleSelectPropToggle}
                          selectedProperty={chatProp}
                          favorites={favAddresses}
                          onToggleFavorite={toggleFavorite}
                        />
                      </div>
                      <div className={styles.splitViewRight}>
                        <PropertyChat
                          property={chatProp}
                          mortgageRate={result.mortgage_rate || 7.2}
                          onClose={() => {
                            setChatProp(null);
                            log.ui("Chat closed");
                          }}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Charts view */}
              {tab === "charts" && (
                <ComparisonCharts properties={displayProps} compact={false} />
              )}

              {/* Favorites view */}
              {tab === "favorites" &&
                (favList.length === 0 ? (
                  <div className={styles.favoritesEmpty}>
                    <div className={styles.favoritesEmptyIcon}>❤️</div>
                    <div className={styles.favoritesEmptyTitle}>
                      No saved properties yet
                    </div>
                    <div className={styles.favoritesEmptySub}>
                      Click the heart on any card to save it here
                    </div>
                  </div>
                ) : (
                  <PropertyGrid
                    properties={favList}
                    onSelectProperty={handleSelectProp}
                    selectedProperty={chatProp}
                    favorites={favAddresses}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
            </>
          )}
        </main>
      </div>

      {/* ── Log viewer modal ───────────────────────────────── */}
      {showLog && <LogViewer onClose={() => setShowLog(false)} />}
      {showAgent && <AgentPanel onClose={() => setShowAgent(false)} />}
    </div>
  );
}

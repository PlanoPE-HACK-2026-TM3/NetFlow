"""
NetFlow — Application Logger  v1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Single place that configures Python's logging for the entire
backend process. Import and call configure_logging() once at
startup — all other modules just do:

    import logging
    log = logging.getLogger("netflow.whatever")

DEBUG MODE  (set DEBUG=true in .env or pass --debug on CLI)
  • Level: DEBUG on every netflow.* logger
  • Format: timestamp | level | logger | file:line | message
  • Extra: request-id, stage timing, tool call args/results
  • Coloured output to stderr using ANSI codes (Windows-safe)

NORMAL MODE (default)
  • Level: INFO on netflow.*, WARNING on everything else
  • Format: timestamp | level | logger | message
  • No file:line, no argument dumps

OUTPUT TARGETS
  • stderr always (captured by uvicorn / process supervisor)
  • Rotating file: logs/netflow.log  (10 MB × 5 backups)
  • Debug file:    logs/netflow_debug.log  (debug mode only, 50 MB × 3)

LOGGER TREE  (hierarchy — child loggers inherit parent config)
  netflow                   root app logger
  netflow.startup           boot sequence events
  netflow.config            env var loading, validation
  netflow.request           per-request lifecycle (req-id, timing)
  netflow.agent             agent orchestrator + sub-agents
  netflow.agent.market      Market Analyst Agent
  netflow.agent.scorer      Property Scorer Agent
  netflow.agent.risk        Risk Advisor Agent
  netflow.agent.user        UserAgent security pipeline
  netflow.mcp               MCP server + PromptGuard
  netflow.service.rentcast  RentCast API calls
  netflow.service.fred      FRED API calls
  netflow.cache             in-process TTL caches
  netflow.sse               Server-Sent Events stream
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys
import time
from pathlib import Path


# ── ANSI colour codes (Windows 10+ supports them natively) ───

_RESET  = "\033[0m"
_BOLD   = "\033[1m"
_DIM    = "\033[2m"

_COLOURS = {
    "DEBUG":    "\033[36m",    # cyan
    "INFO":     "\033[32m",    # green
    "WARNING":  "\033[33m",    # amber
    "ERROR":    "\033[31m",    # red
    "CRITICAL": "\033[35m",    # magenta
}

# Logger name → short colour tag shown in output
_LOGGER_COLOURS = {
    "netflow.startup":         "\033[94m",   # bright blue
    "netflow.request":         "\033[96m",   # bright cyan
    "netflow.agent":           "\033[95m",   # bright magenta
    "netflow.agent.market":    "\033[32m",   # green
    "netflow.agent.scorer":    "\033[33m",   # amber
    "netflow.agent.risk":      "\033[31m",   # red
    "netflow.agent.user":      "\033[35m",   # magenta
    "netflow.mcp":             "\033[34m",   # blue
    "netflow.service.rentcast":"\033[36m",   # cyan
    "netflow.service.fred":    "\033[36m",   # cyan
    "netflow.cache":           "\033[90m",   # dark grey
    "netflow.sse":             "\033[92m",   # bright green
}


class _ColourFormatter(logging.Formatter):
    """
    Coloured formatter for stderr output.
    DEBUG mode: timestamp | LEVEL | logger[file:line] | message
    INFO  mode: timestamp | LEVEL | logger | message
    """

    def __init__(self, debug: bool = False):
        super().__init__()
        self._debug = debug

    def format(self, record: logging.LogRecord) -> str:
        level_colour = _COLOURS.get(record.levelname, "")
        logger_colour = _LOGGER_COLOURS.get(record.name, "\033[37m")  # white default

        ts = time.strftime("%H:%M:%S", time.localtime(record.created))
        ms = f"{int(record.msecs):03d}"

        level_tag  = f"{level_colour}{_BOLD}{record.levelname:8s}{_RESET}"
        logger_tag = f"{logger_colour}{record.name}{_RESET}"

        if self._debug:
            # Include file + line number
            loc = f"{_DIM}{record.filename}:{record.lineno}{_RESET}"
            header = f"{_DIM}{ts}.{ms}{_RESET}  {level_tag}  {logger_tag}  {loc}"
        else:
            header = f"{_DIM}{ts}.{ms}{_RESET}  {level_tag}  {logger_tag}"

        msg = record.getMessage()

        # If the record has extra structured fields (req_id, stage, etc.),
        # append them as  key=value  pairs in dim colour
        extras = []
        for key in ("req_id", "stage", "tool", "duration_ms", "sid", "intent"):
            val = record.__dict__.get(key)
            if val is not None:
                extras.append(f"{_DIM}{key}={val}{_RESET}")

        suffix = ("  " + "  ".join(extras)) if extras else ""

        # Exception info
        exc_text = ""
        if record.exc_info:
            exc_text = "\n" + self.formatException(record.exc_info)

        return f"{header}  {msg}{suffix}{exc_text}"


class _FileFormatter(logging.Formatter):
    """Plain text formatter for log files — no ANSI codes."""

    DEBUG_FMT = "%(asctime)s.%(msecs)03d  %(levelname)-8s  %(name)s  %(filename)s:%(lineno)d  %(message)s"
    INFO_FMT  = "%(asctime)s.%(msecs)03d  %(levelname)-8s  %(name)s  %(message)s"

    def __init__(self, debug: bool = False):
        fmt = self.DEBUG_FMT if debug else self.INFO_FMT
        super().__init__(fmt=fmt, datefmt="%Y-%m-%d %H:%M:%S")


# ── Public API ────────────────────────────────────────────────

def configure_logging(debug: bool | None = None) -> bool:
    """
    Configure logging for the entire NetFlow backend.
    Call once at process startup (before importing other modules).

    Args:
        debug: True = DEBUG level; False = INFO; None = read DEBUG env var

    Returns:
        bool: True if debug mode is active
    """
    if debug is None:
        debug = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

    # ── Create logs/ directory ────────────────────────────────
    log_dir = Path(__file__).parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)

    # ── Root logger: WARNING level (third-party noise suppressed) ──
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if debug else logging.INFO)

    # Remove any existing handlers (avoid duplicate logs on reload)
    root.handlers.clear()

    # ── Handler 1: Coloured stderr ────────────────────────────
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.DEBUG if debug else logging.INFO)
    stderr_handler.setFormatter(_ColourFormatter(debug=debug))
    root.addHandler(stderr_handler)

    # ── Handler 2: Rotating file — always on ──────────────────
    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / "netflow.log",
        maxBytes=10 * 1024 * 1024,   # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(_FileFormatter(debug=False))
    root.addHandler(file_handler)

    # ── Handler 3: Debug file — only in debug mode ────────────
    if debug:
        debug_handler = logging.handlers.RotatingFileHandler(
            log_dir / "netflow_debug.log",
            maxBytes=50 * 1024 * 1024,  # 50 MB
            backupCount=3,
            encoding="utf-8",
        )
        debug_handler.setLevel(logging.DEBUG)
        debug_handler.setFormatter(_FileFormatter(debug=True))
        root.addHandler(debug_handler)

    # ── Silence noisy third-party loggers ─────────────────────
    for noisy in ("uvicorn.access", "httpx", "httpcore",
                  "langchain", "langsmith", "openai"):
        logging.getLogger(noisy).setLevel(
            logging.DEBUG if debug else logging.WARNING
        )

    # ── Set netflow.* loggers to appropriate level ────────────
    logging.getLogger("netflow").setLevel(
        logging.DEBUG if debug else logging.INFO
    )

    # ── Startup announcement ──────────────────────────────────
    startup_log = logging.getLogger("netflow.startup")
    mode_str = "DEBUG" if debug else "INFO"
    startup_log.info(
        "Logging configured | level=%s | file=logs/netflow.log%s",
        mode_str,
        " | debug_file=logs/netflow_debug.log" if debug else "",
    )
    if debug:
        startup_log.debug(
            "DEBUG mode active — all tool args, stage timings, "
            "cache hits/misses, and request IDs will be logged"
        )

    return debug


def get_logger(name: str) -> logging.Logger:
    """
    Return a child logger under the netflow.* tree.

    Usage:
        log = get_logger("netflow.agent.market")
        log.debug("Cache hit for ZIP %s", zip_code, extra={"stage": "market"})
    """
    return logging.getLogger(name)

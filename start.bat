@echo off
setlocal enabledelayedexpansion

REM ══════════════════════════════════════════════════════════
REM  NetFlow — Windows App Runner  v2
REM  Full startup with debug mode support + health checks
REM
REM  Usage:
REM    start.bat              Normal mode (INFO logging)
REM    start.bat --debug      Debug mode  (DEBUG logging + debug log file)
REM    start.bat --mcp        Also start MCP server on port 8001
REM    start.bat --debug --mcp  Both
REM
REM  Complete startup flow:
REM    1. Parse args  (debug / mcp flags)
REM    2. Check .env  (create from template if missing)
REM    3. Start Ollama              (background, port 11434)
REM    4. Create/activate venv      (if not present)
REM    5. Install dependencies      (pip install -e . + requirements.txt)
REM    6. Copy .env → backend/.env  (config sync)
REM    7. Start FastAPI backend     (uvicorn, port 8000)
REM    8. Wait for backend health   (GET /health, 10-second timeout)
REM    9. Start Next.js frontend    (npm run dev, port 3000)
REM   10. (Optional) Start MCP      (port 8001 if --mcp flag)
REM   11. Print service URLs
REM ══════════════════════════════════════════════════════════

title NetFlow - AI Real Estate Intelligence
color 0B

REM ── Parse arguments ──────────────────────────────────────
set DEBUG_FLAG=
set MCP_FLAG=
set LOG_LEVEL=info
set DEBUG_ENV=false

:parse_args
if "%~1"=="" goto done_args
if /i "%~1"=="--debug" (
    set DEBUG_FLAG=1
    set LOG_LEVEL=debug
    set DEBUG_ENV=true
)
if /i "%~1"=="--mcp" set MCP_FLAG=1
shift
goto parse_args
:done_args

echo.
echo  ==========================================
if defined DEBUG_FLAG (
    echo   NetFlow  [DEBUG MODE]
    echo   All logs written to logs\netflow_debug.log
) else (
    echo   NetFlow - AI Real Estate Intelligence
)
echo  ==========================================
echo.

REM ── Step 1: Check .env ───────────────────────────────────
echo [1/10] Checking configuration...
if not exist ".env" (
    echo        .env not found - creating from template
    if exist ".env.example" (
        copy .env.example .env >nul
        echo        Created .env from .env.example
        echo        DEMO_MODE will be active until you add API keys
    ) else (
        echo        WARNING: .env.example not found - creating minimal .env
        echo DEMO_MODE=false>  .env
        echo DEBUG=false>>     .env
        echo OLLAMA_BASE_URL=http://localhost:11434>> .env
        echo OLLAMA_MODEL=llama3>> .env
    )
)

REM Inject DEBUG setting into .env if --debug flag was passed
if defined DEBUG_FLAG (
    REM Update or append DEBUG=true
    powershell -NoProfile -Command ^
      "(Get-Content .env) -replace 'DEBUG=.*','DEBUG=true' | Set-Content .env; " ^
      "if (-not (Select-String -Path .env -Pattern 'DEBUG=')) { Add-Content .env 'DEBUG=true' }"
    echo        DEBUG=true written to .env
)
echo [OK] Configuration ready

REM ── Step 2: Ollama ───────────────────────────────────────
echo.
echo [2/10] Starting Ollama...
where ollama >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] Ollama not found
    echo        AI scoring will use rule-based fallback
    echo        Download: https://ollama.com
) else (
    REM Check if already running
    curl -s http://localhost:11434/api/tags >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        echo [OK]   Ollama already running on :11434
    ) else (
        start "NetFlow - Ollama" /MIN cmd /c "ollama serve"
        timeout /t 3 /nobreak >nul
        echo [OK]   Ollama starting on :11434
    )
)

REM ── Step 3: Virtual environment ──────────────────────────
echo.
echo [3/10] Checking virtual environment...
if not exist "venv" (
    echo        Creating venv...
    python -m venv venv
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create venv. Is Python installed?
        echo         Install from https://python.org
        pause & exit /b 1
    )
    echo [OK]   venv created
) else (
    echo [OK]   venv exists
)

REM ── Step 4: Install dependencies ─────────────────────────
echo.
echo [4/10] Installing Python dependencies...
call venv\Scripts\activate.bat
pip install -e . -q --disable-pip-version-check 2>nul
pip install -r backend\requirements.txt -q --disable-pip-version-check
echo [OK]   Dependencies installed

REM ── Step 5: Create logs directory ────────────────────────
echo.
echo [5/10] Creating logs directory...
if not exist "logs" mkdir logs
echo [OK]   logs\ ready

REM ── Step 6: Sync .env → backend\.env ─────────────────────
echo.
echo [6/10] Syncing config files...
copy /Y .env backend\.env >nul
if not exist "frontend\.env.local" (
    echo NEXT_PUBLIC_API_URL=http://localhost:8000> frontend\.env.local
)
echo [OK]   .env synced to backend\.env

REM ── Step 7: Start backend ────────────────────────────────
echo.
echo [7/10] Starting FastAPI backend...
if defined DEBUG_FLAG (
    echo        Log level: DEBUG  ^(all tool args + stage timings^)
    echo        Debug log: logs\netflow_debug.log
    set UVICORN_LOG=debug
) else (
    set UVICORN_LOG=info
)

start "NetFlow - Backend" cmd /k "cd /d %CD% && venv\Scripts\activate && set DEBUG=%DEBUG_ENV% && uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 --log-level %UVICORN_LOG%"
echo [OK]   Backend starting...

REM ── Step 8: Wait for backend health check ────────────────
echo.
echo [8/10] Waiting for backend to be ready...
set /a TRIES=0
:health_loop
timeout /t 2 /nobreak >nul
set /a TRIES+=1
curl -s http://localhost:8000/health >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK]   Backend healthy after %TRIES%x2 seconds
    goto health_done
)
if %TRIES% GEQ 15 (
    echo [WARN] Backend not responding after 30s - check the Backend window for errors
    goto health_done
)
echo        Waiting... attempt %TRIES%/15
goto health_loop
:health_done

REM ── Step 9: Frontend ─────────────────────────────────────
echo.
echo [9/10] Starting Next.js frontend...
if not exist "frontend\node_modules" (
    echo        Installing npm packages ^(first run - takes ~60s^)...
    start "NetFlow - Frontend" cmd /k "cd /d %CD%\frontend && npm install && npm run dev"
) else (
    start "NetFlow - Frontend" cmd /k "cd /d %CD%\frontend && npm run dev"
)
echo [OK]   Frontend starting on :3000

REM ── Step 10: MCP server (optional) ───────────────────────
if defined MCP_FLAG (
    echo.
    echo [10/10] Starting MCP server...
    start "NetFlow - MCP" cmd /k "cd /d %CD% && venv\Scripts\activate && set DEBUG=%DEBUG_ENV% && venv\Scripts\python.exe -m backend.mcp.server --transport sse --port 8001"
    echo [OK]   MCP server starting on :8001
) else (
    echo.
    echo [10/10] MCP server: skipped  ^(use start.bat --mcp to enable^)
)

REM ── Final status ─────────────────────────────────────────
echo.
echo  ══════════════════════════════════════════
echo   NetFlow is running!
echo  ══════════════════════════════════════════
echo   Frontend  :  http://localhost:3000
echo   API       :  http://localhost:8000
echo   Docs      :  http://localhost:8000/docs
echo   Health    :  http://localhost:8000/health
if defined MCP_FLAG (
    echo   MCP       :  http://localhost:8001/mcp/health
)
echo.
if defined DEBUG_FLAG (
    echo   DEBUG MODE ACTIVE
    echo   Logs      :  logs\netflow.log
    echo   Debug log :  logs\netflow_debug.log
    echo   MCP log   :  logs\netflow_debug.log  ^(stderr^)
    echo.
    echo   What debug mode logs:
    echo     * Every HTTP request with req_id + duration
    echo     * UserAgent: sanitised chars, intent, extracted params
    echo     * Agent: stage timings, cache hits/misses
    echo     * MarketAnalyst: live data values from FRED + RentCast
    echo     * PropertyScorer: token estimates, batch size
    echo     * RiskAdvisor: risk counts per level
    echo     * LLM: prompt sizes, response validation
    echo     * SSE: stream milestones, top-3 scores
    echo     * MCP: tool name, arg keys, duration
)
echo  ══════════════════════════════════════════
echo.
echo  Close the individual terminal windows to stop services.
echo  Press any key to dismiss this window.
echo.
pause >nul

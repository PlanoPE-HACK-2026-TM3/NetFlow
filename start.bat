@echo off
REM NetFlow — Windows startup script
REM Double-click this file or run from Command Prompt

title NetFlow - AI Real Estate Intelligence
color 0B

echo.
echo  ==========================================
echo   NetFlow - AI Real Estate Intelligence
echo  ==========================================
echo.

REM Check .env
if not exist ".env" (
    echo [INFO] Creating .env from template...
    copy .env.example .env >nul
    echo [INFO] DEMO_MODE active - no real API calls needed to start.
    echo [INFO] Edit .env to add RentCast + FRED keys for live data.
    echo.
)

REM Step 1: Ollama
echo [1/3] Starting Ollama...
where ollama >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] Ollama not found - AI will use rule-based scoring.
    echo        Download from https://ollama.com
) else (
    start "NetFlow - Ollama" /MIN cmd /c "ollama serve"
    timeout /t 3 /nobreak >nul
    echo [OK] Ollama starting on :11434
)

REM Step 2: Python backend
echo [2/3] Starting FastAPI backend...
if not exist "venv" (
    echo        Creating virtual environment...
    python -m venv venv
)
start "NetFlow - Backend" cmd /k "venv\Scripts\activate && pip install -e . -q && pip install -r backend\requirements.txt -q && copy /Y .env backend\.env && uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000"
timeout /t 6 /nobreak >nul

REM Step 3: Frontend
echo [3/3] Starting Next.js frontend...
if not exist "frontend\.env.local" (
    echo NEXT_PUBLIC_API_URL=http://localhost:8000 > frontend\.env.local
)
start "NetFlow - Frontend" cmd /k "cd frontend && npm install && npm run dev"
timeout /t 5 /nobreak >nul

echo.
echo  ==========================================
echo   NetFlow is starting!
echo  ==========================================
echo   Frontend  :  http://localhost:3000
echo   API Docs  :  http://localhost:8000/docs
echo   Ollama    :  http://localhost:11434
echo  ==========================================
echo.
echo  Close the individual terminal windows to stop services.
echo.
pause

@echo off
REM =============================================================================
REM NetFlow - one-shot setup for Windows
REM
REM Restores dotfiles that some Windows extractors strip during zip extraction,
REM then creates .env from the template.
REM
REM Run once after extracting the archive (from the netflow-docker folder):
REM   setup.bat
REM =============================================================================

setlocal

echo NetFlow setup
echo -------------

REM --- .env --------------------------------------------------------------------
if exist ".env" (
    echo - .env already exists - leaving it alone.
) else (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
        echo + .env created from .env.example
    ) else (
        if exist "env.example" (
            copy /Y "env.example" ".env" >nul
            echo + .env created from env.example
        ) else (
            echo x Neither .env.example nor env.example found. Aborting.
            exit /b 1
        )
    )
)

REM --- .dockerignore (root) ----------------------------------------------------
if not exist ".dockerignore" (
    if exist "dockerignore" (
        copy /Y "dockerignore" ".dockerignore" >nul
        echo + .dockerignore restored
    )
) else (
    echo - .dockerignore already present
)

REM --- frontend/.dockerignore --------------------------------------------------
if not exist "frontend\.dockerignore" (
    if exist "frontend\dockerignore" (
        copy /Y "frontend\dockerignore" "frontend\.dockerignore" >nul
        echo + frontend/.dockerignore restored
    )
) else (
    echo - frontend/.dockerignore already present
)

echo.
echo Setup complete. Next:
echo   docker compose up --build -d
echo   docker compose logs -f
echo   Open http://localhost:3000 when backend reports healthy.

endlocal

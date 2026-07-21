@echo off
REM WithYou pair API — Batch Manager slot (port 9610, Cloudflare path /withyou)
REM Window title must match WITHYOU_MATCH in Batch_Manager\.env
cd /d "%~dp0"
title WithYouAPI

:loop
REM Free :9610 so code/HTML updates always load after BM slot restart
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9610" ^| findstr "LISTENING"') do (
  echo [WithYouAPI] freeing PID %%a on :9610 ...
  taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [WithYouAPI] starting on :9610 ...
python "%~dp0api_server.py"
echo [WithYouAPI] exited — restart in 5s ...
timeout /t 5 /nobreak >nul
goto loop

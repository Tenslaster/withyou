@echo off
title WithYou stack
cd /d "%~dp0"

echo Starting WithYou API on :9610 ...
start "WithYou-API" /MIN python "%~dp0server\api_server.py"
timeout /t 2 /nobreak >nul

echo Starting Expo (WithYou app) ...
cd /d "%~dp0withyou-app"
start "WithYou-Expo" cmd /k "npx expo start"

echo.
echo API:  http://127.0.0.1:9610/health
echo Public (if cloudflared up): https://crew.kingdom.forum/withyou/health
echo Open Expo Go and scan the QR code.
echo.
pause

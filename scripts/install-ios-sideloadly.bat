@echo off
title WithYou iOS free install (Sideloadly)
echo ============================================================
echo  WithYou iPhone install WITHOUT paid Apple Developer ($99)
echo ============================================================
echo.
echo  You only need a FREE Apple ID (iCloud).
echo  Sideloadly will re-sign the IPA for 7 days, then re-sign again.
echo.
echo  Steps:
echo   1. Download Sideloadly: https://sideloadly.io/
echo   2. Plug iPhone USB + Trust
echo   3. Drag IPA into Sideloadly
echo   4. Login with FREE Apple ID
echo   5. On iPhone: Settings - General - VPN ^& Device Management - Trust
echo.
echo  IPA will be here when CI succeeds:
echo   %~dp0..\dist\WithYou-for-Sideloadly.ipa
echo.
echo  Full guide: %~dp0..\docs\FREE_SIGNING.md
echo.
start https://sideloadly.io/
pause

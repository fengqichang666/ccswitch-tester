@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   CCSwitch Tester - Build Latest
echo ========================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-latest.ps1"
set "exitCode=%ERRORLEVEL%"

echo.
if not "%exitCode%"=="0" (
  echo Build failed. Press any key to close.
  pause >nul
) else (
  echo Build completed. Press any key to close.
  pause >nul
)

exit /b %exitCode%

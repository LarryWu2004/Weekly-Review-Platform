@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
cd /d "%ROOT%"
title Weekly Review Launcher

if not defined APP_PUBLIC_URL set "APP_PUBLIC_URL=http://localhost:3001"
if not defined PLATFORM_LAUNCH_SECRET set "PLATFORM_LAUNCH_SECRET=local-platform-launch-secret-change-before-production"
if not defined NEXUSOS_TENANT_ID set "NEXUSOS_TENANT_ID=8133c675-3bb4-4ace-ba10-1e83299cf761"
if not defined WEEKLY_LAUNCH_USER_ID set "WEEKLY_LAUNCH_USER_ID=a3f0d748-5104-4703-a230-f5d3931a56b2"
if not defined ENABLE_LOCAL_TEST_ENTRY set "ENABLE_LOCAL_TEST_ENTRY=true"

echo.
echo ========================================
echo   Weekly Review Platform - Start Server
echo ========================================
echo.

where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22 or later first.
  goto :failed
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js with npm enabled.
  goto :failed
)

if not exist "%ROOT%package.json" (
  echo [ERROR] package.json was not found in %ROOT%
  goto :failed
)

if not exist "%ROOT%node_modules" (
  echo [1/5] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :failed
) else (
  echo [1/5] Dependencies are ready.
)

echo [2/5] Building the latest application...
call npm.cmd run build
if errorlevel 1 goto :failed

echo [3/5] Checking the platform API mock...
call :check_url "http://localhost:18080/health"
if errorlevel 1 (
  echo       Starting mock server on port 18080...
  start "Weekly Review Mock" /min cmd /k "cd /d ""%ROOT%tools\external-app-api-mock"" && npm.cmd start"
) else (
  echo       Mock server is already running.
)

echo [4/5] Starting the weekly review server on port 3001...
call :stop_existing_app
start "Weekly Review App" /min cmd /k "cd /d ""%ROOT%"" && npm.cmd start"

echo [5/5] Waiting for the application health check...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$deadline = (Get-Date).AddSeconds(45);" ^
  "do {" ^
  "  try {" ^
  "    $health = Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 2;" ^
  "    if ($health.status -eq 'ok' -and $health.service -eq 'nexus-weekly') { exit 0 }" ^
  "  } catch {}" ^
  "  Start-Sleep -Milliseconds 500" ^
  "} while ((Get-Date) -lt $deadline);" ^
  "exit 1"

if errorlevel 1 (
  echo [ERROR] The application did not become ready within 45 seconds.
  echo         Check the "Weekly Review App" and "Weekly Review Mock" windows.
  goto :failed
)

echo.
echo [OK] Weekly Review Platform is running.
echo      Creating a local platform session for %WEEKLY_LAUNCH_USER_ID% ...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$headers = @{ Authorization = 'Bearer ' + $env:PLATFORM_LAUNCH_SECRET; 'Content-Type' = 'application/json' };" ^
  "$body = @{ tenant_id = $env:NEXUSOS_TENANT_ID; user_id = $env:WEEKLY_LAUNCH_USER_ID } | ConvertTo-Json;" ^
  "$launch = Invoke-RestMethod -Method Post -Uri ($env:APP_PUBLIC_URL + '/auth/platform/launch') -Headers $headers -Body $body;" ^
  "Start-Process $launch.launch_url"
if errorlevel 1 goto :failed
exit /b 0

:check_url
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%~1' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:stop_existing_app
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try {" ^
  "  $health = Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 2;" ^
  "  if ($health.service -ne 'nexus-weekly') { exit 0 }" ^
  "  $connection = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "  if ($connection) {" ^
  "    $process = Get-Process -Id $connection.OwningProcess -ErrorAction Stop;" ^
  "    if ($process.ProcessName -eq 'node') { Stop-Process -Id $process.Id -Force }" ^
  "  }" ^
  "} catch {}"
exit /b 0

:failed
echo.
echo Startup failed. Press any key to close this window.
pause >nul
exit /b 1

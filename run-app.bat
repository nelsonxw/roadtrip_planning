@echo off
rem RoadTrip AI launcher for Windows.
rem   run-app.bat            build from the current source, then start the app
rem   run-app.bat --dev      start the development server instead (hot reload, no build)

setlocal
cd /d "%~dp0"
title RoadTrip AI launcher
echo === RoadTrip AI launcher ===

rem 1. Node.js 20 or newer
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Node.js 20 or newer is required. Found major version %NODE_MAJOR%. Install a newer version from https://nodejs.org.
  pause
  exit /b 1
)

rem 2. Settings file with your keys
if not exist ".env.local" (
  echo Missing .env.local. Copy .env.example to .env.local, add your keys, then run this file again.
  pause
  exit /b 1
)

rem 3. npm packages
if not exist "node_modules\next" (
  echo Installing packages. The first run takes a few minutes...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and the messages above.
    pause
    exit /b 1
  )
)

rem 4. Firestore key file from .env.local
findstr /b "GOOGLE_APPLICATION_CREDENTIALS=" .env.local >nul
if errorlevel 1 (
  echo GOOGLE_APPLICATION_CREDENTIALS is missing from .env.local. Add the path to your Firebase service account key, then run this file again.
  pause
  exit /b 1
)

rem 5. Port 3000 must be free
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo Port 3000 is already in use. Close the other program or the old RoadTrip server window, then run this file again.
  pause
  exit /b 1
)

rem 6. Production build, only when the source changed since the last build (skipped in dev mode; --rebuild forces it)
if /i "%~1"=="--dev" goto start_server
if /i "%~1"=="--rebuild" goto build
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\needs-build.ps1"
if not errorlevel 1 (
  echo The build is up to date.
  goto start_server
)
:build
echo Building the app. This takes about a minute...
call npm run build
if errorlevel 1 (
  echo Build failed. See the messages above.
  pause
  exit /b 1
)

:start_server
if /i "%~1"=="--dev" (
  start "RoadTrip server (keep open)" cmd /k "npx next dev -p 3000"
) else (
  start "RoadTrip server (keep open)" cmd /k "npx next start -p 3000"
)
echo Waiting for the server to start...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-for-port.ps1" -Port 3000 -TimeoutSeconds 60
start "" http://localhost:3000
echo.
echo RoadTrip AI is running at http://localhost:3000
echo Keep the "RoadTrip server" window open while you use the app. Close it to stop.
pause

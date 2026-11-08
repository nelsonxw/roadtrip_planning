@echo off
rem RoadTrip AI launcher for Windows.
rem   run-app.bat            start the app (builds first if needed)
rem   run-app.bat --rebuild  rebuild before starting
rem   run-app.bat --dev      start the development server instead (hot reload)

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

rem 4. Prisma client
if not exist "node_modules\.prisma\client\index.js" (
  echo Generating the database client...
  call npx prisma generate
  if errorlevel 1 (
    echo Prisma client generation failed. See the messages above.
    pause
    exit /b 1
  )
)

rem 5. Database connection string from .env.local (quotes removed)
for /f "tokens=1,* delims==" %%a in ('findstr /b "DATABASE_URL=" .env.local') do set DATABASE_URL=%%b
set DATABASE_URL=%DATABASE_URL:"=%
if not defined DATABASE_URL (
  echo DATABASE_URL is missing from .env.local.
  pause
  exit /b 1
)

rem 6. Local database: start it in its own window if it is not running
echo %DATABASE_URL% | findstr /c:"localhost:5433" >nul
if not errorlevel 1 (
  netstat -ano | findstr /r /c:":5433 .*LISTENING" >nul
  if errorlevel 1 (
    echo Starting the local database in a separate window...
    start "RoadTrip database (keep open)" cmd /k "npm run db:dev"
    timeout /t 15 /nobreak >nul
  )
)

rem 7. Apply database migrations
call npx prisma migrate deploy
if errorlevel 1 (
  echo Database migration failed. Make sure the database window shows "ready", or check DATABASE_URL in .env.local.
  pause
  exit /b 1
)

rem 8. Port 3000 must be free
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo Port 3000 is already in use. Close the other program or the old RoadTrip server window, then run this file again.
  pause
  exit /b 1
)

rem 9. Production build (skipped in dev mode and when an existing build is up to date)
if /i "%~1"=="--dev" goto start_server
if /i "%~1"=="--rebuild" set NEED_BUILD=1
if not exist ".next\BUILD_ID" set NEED_BUILD=1
if defined NEED_BUILD (
  echo Building the app. This takes about a minute...
  call npm run build
  if errorlevel 1 (
    echo Build failed. See the messages above.
    pause
    exit /b 1
  )
)

:start_server
if /i "%~1"=="--dev" (
  start "RoadTrip server (keep open)" cmd /k "npx next dev -p 3000"
) else (
  start "RoadTrip server (keep open)" cmd /k "npx next start -p 3000"
)
echo Waiting for the server to start...
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo.
echo RoadTrip AI is running at http://localhost:3000
echo Keep the "RoadTrip server" window open while you use the app. Close it to stop.
pause

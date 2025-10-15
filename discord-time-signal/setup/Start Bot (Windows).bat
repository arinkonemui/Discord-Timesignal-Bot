@echo on
setlocal
chcp 65001 >nul

rem Go to project root (this .bat is under setup\)
cd /d "%~dp0\.."

echo ==== Current Dir: %CD% ====

if not exist "package.json" (
  echo [ERROR] package.json not found. Place this file under setup\ and keep project files one level up.
  pause & exit /b 1
)
if not exist ".env" (
  echo [ERROR] .env not found. Place .env here: %CD%
  pause & exit /b 1
)

where node >nul 2>&1 || (echo [ERROR] node not found. Install Node.js and re-run.& pause & exit /b 1)
where npm  >nul 2>&1 || (echo [ERROR] npm not found.  Install Node.js and re-run.& pause & exit /b 1)

if not exist "node_modules" (
  if exist "package-lock.json" (
    echo ==== npm ci --omit=dev ====
    call npm ci --omit=dev || (echo [ERROR] npm ci failed.& pause & exit /b 1)
  ) else (
    echo ==== npm install --omit=dev ====
    call npm install --omit=dev || (echo [ERROR] npm install failed.& pause & exit /b 1)
  )
)

node -e "require.resolve('ini')" 1>nul 2>nul
if errorlevel 1 (
  echo ==== Installing 'ini' ====
  call npm i ini || (echo [WARN] failed to install 'ini'. Continuing...)
)

echo ==== Run: npm start ====
call npm run start --loglevel=info
set "APP_EXIT=%errorlevel%"

if not "%APP_EXIT%"=="0" (
  echo ==== npm start failed (code %APP_EXIT%). Trying direct Node fallback... ====
  if exist "index.js" (
    node --env-file=.env index.js
    set "APP_EXIT=%errorlevel%"
  ) else (
    echo [ERROR] No index.js to run directly. Please define "scripts.start" or provide index.js.
  )
)

echo ==== ExitCode: %APP_EXIT% ====
pause
exit /b %APP_EXIT%

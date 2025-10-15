@echo on
setlocal
rem ※ 文字化け防止用。不要ならこの行は消してOK
chcp 65001 >nul

rem この .bat がある setup フォルダから 1つ上（プロジェクトルート）へ
cd /d "%~dp0\.."

echo ==== Current Dir: %CD% ====

rem 必須ファイルチェック
if not exist "package.json" (
  echo [ERROR] package.json not found. Place this bat under setup\ and keep project files one level up.
  pause & exit /b 1
)

if not exist ".env" (
  echo [ERROR] .env not found. Place .env here: %CD%
  pause & exit /b 1
)

rem Node/NPM 存在チェック
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js or fix PATH.
  pause & exit /b 1
)

rem 依存（初回だけ / 必要に応じて有効化）
rem call npm ci  || call npm install

echo ==== Run: npm start ====
call npm run start --loglevel=info
echo ==== ExitCode: %errorlevel% ====
pause

@echo off
REM run npm start from project root (one level up)
cd /d "%~dp0\.."

IF NOT EXIST ".env" (
  echo .env が見つかりません。先に「Run Setup (Windows).bat」を実行して .env を作成してください。
  pause
  exit /b 1
)

npm start
pause

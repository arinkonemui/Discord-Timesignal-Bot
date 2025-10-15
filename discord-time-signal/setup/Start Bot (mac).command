#!/usr/bin/env bash
# Save as UTF-8 (no BOM) with LF line endings.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR" || { echo "[ERROR] cannot cd to project root"; read -rp "Press Enter to exit..."; exit 1; }

echo "==== Current Dir: $PWD ===="

if [[ ! -f "package.json" ]]; then
  echo "[ERROR] package.json not found in $PWD"
  read -rp "Press Enter to exit..."; exit 1
fi
if [[ ! -f ".env" ]]; then
  echo "[ERROR] .env not found in $PWD"
  read -rp "Press Enter to exit..."; exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] node not found. Install Node.js first."
  read -rp "Press Enter to exit..."; exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm not found. Install Node.js (npm) first."
  read -rp "Press Enter to exit..."; exit 1
fi

if [[ ! -d "node_modules" ]]; then
  if [[ -f "package-lock.json" ]]; then
    echo "==== npm ci --omit=dev ===="
    npm ci --omit=dev || { echo "[ERROR] npm ci failed."; read -rp "Press Enter to exit..."; exit 1; }
  else
    echo "==== npm install --omit=dev ===="
    npm install --omit=dev || { echo "[ERROR] npm install failed."; read -rp "Press Enter to exit..."; exit 1; }
  fi
fi

node -e "require.resolve('ini')" >/dev/null 2>&1 || {
  echo "==== Installing 'ini' ===="
  npm i ini || echo "[WARN] failed to install 'ini'. Continuing..."
}

echo "==== Run: npm start ===="
npm run start --loglevel=info
APP_EXIT=$?

if [[ $APP_EXIT -ne 0 ]]; then
  echo "==== npm start failed (code $APP_EXIT). Trying direct Node fallback... ===="
  if [[ -f "index.js" ]]; then
    node --env-file=.env index.js
    APP_EXIT=$?
  else
    echo "[ERROR] No index.js to run directly. Define scripts.start or provide index.js."
  fi
fi

echo "==== ExitCode: $APP_EXIT ===="
read -rp "Press Enter to close..."
exit $APP_EXIT

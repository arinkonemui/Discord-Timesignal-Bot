#!/usr/bin/env bash
set -euo pipefail

# この .command (setup/ 配下) から 1つ上＝プロジェクトルートへ
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "==== Current Dir: $PWD ===="

# .env 必須
if [[ ! -f ".env" ]]; then
  echo "[ERROR] .env not found. Place it here: $PWD"
  read -rp "Press Enter to exit..."; exit 1
fi

# Node / npm 確認
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] node not found. Please install Node.js."
  read -rp "Press Enter to exit..."; exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm not found. Please install Node.js (npm)."
  read -rp "Press Enter to exit..."; exit 1
fi

# package.json 確認
if [[ ! -f "package.json" ]]; then
  echo "[ERROR] package.json not found in $PWD"
  read -rp "Press Enter to exit..."; exit 1
fi

# 必要なら依存導入（初回のみ使う／普段はコメントアウトのままでOK）
# npm ci || npm install

echo "==== Run: npm start ===="
# ログレベルはお好みで info/debug
npm run start --loglevel=info || {
  echo "==== ExitCode: $? ===="
  read -rp "Press Enter to exit..."; exit 1
}

echo "==== ExitCode: 0 ===="
read -rp "Press Enter to close..."

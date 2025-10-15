#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Discord Time Signal: Unix setup =="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Please install Node.js LTS from https://nodejs.org/" >&2
  exit 1
fi
echo "Node: $(node -v)"

# Dependencies
if npm ci; then
  :
else
  echo "npm ci failed. Trying npm i ..."
  npm i
fi

# .env
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    cat > .env <<'EOF'
DISCORD_TOKEN=ここにBotのトークンを入力
CLIENT_ID=ここにDiscordのクライアントIDを入力
TZ=Asia/Tokyo
DAVE_DISABLE=1
VOICE_READY_TIMEOUT_MS=5000
EOF
  fi
  echo ".env created. Please edit DISCORD_TOKEN and CLIENT_ID."
fi

# folders
mkdir -p audio configs

echo "✅ Setup done. Start with: npm start"

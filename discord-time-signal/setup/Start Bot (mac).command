#!/usr/bin/env bash
# Double-click to start bot on macOS (from setup/)
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  osascript -e 'display alert ".env not found. Please run Run Setup (mac).command first."'
  exit 1
fi

# Open a new Terminal window and run npm start in project root
osascript -e 'tell app "Terminal" to do script "cd \"'"$(pwd)"'\"; npm start"'

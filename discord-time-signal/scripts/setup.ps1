<# Windows Setup for Discord Time Signal Bot
  使い方:
    - このファイルをダブルクリック
    - もしくは PowerShell で: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#>

$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot\..

Write-Host "== Discord Time Signal: Windows setup =="

# 1) Node.js 確認
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (!$node) {
  Write-Warning "Node.js が見つかりません。https://nodejs.org/ から LTS をインストールしてください。"
  Read-Host "Enter を押すと終了します"
  Pop-Location; exit 1
}
Write-Host "Node: $((node -v))"

# 2) 依存導入（再現性のため npm ci 推奨）
try {
  npm ci
} catch {
  Write-Warning "npm ci に失敗しました。npm i を試します。"
  npm i
}

# 3) .env 作成（無ければ）
if (!(Test-Path ".\.env")) {
  if (Test-Path ".\.env.example") {
    Copy-Item .\.env.example .\.env
    Write-Host ".env を作成しました。DISCORD_TOKEN と CLIENT_ID を編集してください。"
  } else {
    @"
DISCORD_TOKEN=ここにBotのトークンを入力
CLIENT_ID=ここにDiscordのクライアントIDを入力
TZ=Asia/Tokyo
DAVE_DISABLE=1
VOICE_READY_TIMEOUT_MS=5000
"@ | Out-File -FilePath .\.env -Encoding UTF8
    Write-Host ".env を新規作成しました。DISCORD_TOKEN と CLIENT_ID を編集してください。"
  }
}

# 4) 必要フォルダ（空でも作る）
if (!(Test-Path ".\audio"))   { New-Item -ItemType Directory .\audio   | Out-Null }
if (!(Test-Path ".\configs")) { New-Item -ItemType Directory .\configs | Out-Null }

Write-Host "✅ セットアップ完了。次のいずれかで起動できます:"
Write-Host "  - Start Bot (Windows).bat をダブルクリック"
Write-Host "  - ターミナルで: npm start"
Read-Host "Enter を押して閉じます"
Pop-Location

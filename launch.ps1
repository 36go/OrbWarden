# OrbWarden - Launch Script
# Run this to start OrbWarden in dev mode.
# Usage: powershell -ExecutionPolicy Bypass -File launch.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== Starting OrbWarden ===" -ForegroundColor Cyan

# Check for node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "[...] Installing dependencies..." -ForegroundColor Yellow
    pnpm install
}

# Start dev server + app
Write-Host "[...] Launching OrbWarden..." -ForegroundColor Yellow
pnpm run tauri:dev

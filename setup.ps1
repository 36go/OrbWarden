# OrbWarden - Windows Setup Script
# Run this script in PowerShell to install dependencies and build the app.
# Usage: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== OrbWarden Setup ===" -ForegroundColor Cyan

# Check for Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed. Download from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js $(node --version)" -ForegroundColor Green

# Check for Rust
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Rust is not installed. Download from https://rustup.rs/" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Rust $(rustc --version)" -ForegroundColor Green

# Check for pnpm
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "[...] Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
}
Write-Host "[OK] pnpm $(pnpm --version)" -ForegroundColor Green

# Install dependencies
Write-Host "[...] Installing project dependencies..." -ForegroundColor Yellow
pnpm install

# Build
Write-Host "[...] Building OrbWarden..." -ForegroundColor Yellow
pnpm run tauri:build

Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "The installer is in: src-tauri/target/release/bundle/" -ForegroundColor Cyan

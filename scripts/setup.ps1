# One-shot dev setup (Windows): install web + functions dependencies.
# Usage:  scripts\setup.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> Web dependencies (npm install)" -ForegroundColor Cyan
Push-Location "$root\web"
npm install
Pop-Location

Write-Host "==> Functions dependencies (python venv + pip)" -ForegroundColor Cyan
Push-Location "$root\functions"
python -m venv venv
& ".\venv\Scripts\pip.exe" install -q -r requirements.txt
Pop-Location

Write-Host ""
Write-Host "Setup complete. To run locally on the Firebase emulators:" -ForegroundColor Green
Write-Host "  1) firebase emulators:start      (terminal 1)"
Write-Host "  2) cd web; npm run dev           (terminal 2)  ->  http://localhost:5173"
Write-Host ""
Write-Host "Needs the Firebase CLI (npm i -g firebase-tools) and JDK 21 for the emulators."

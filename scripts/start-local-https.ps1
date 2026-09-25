$ErrorActionPreference = 'Stop'
$rsomWorkspace = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $rsomWorkspace
if (-not (Test-Path -LiteralPath '.local-https/bin/caddy.exe')) { throw 'Run scripts/install-local-https.ps1 first.' }
if (-not (Test-Path -LiteralPath 'dist/sw.js')) { throw 'Run npm run build first.' }
& '.\.local-https\bin\caddy.exe' run --config Caddyfile.local --adapter caddyfile

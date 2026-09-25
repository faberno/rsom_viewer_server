$ErrorActionPreference = 'Stop'
$rsomWorkspace = Split-Path -Parent $PSScriptRoot
$rsomRootCertificate = Join-Path $rsomWorkspace '.local-https/storage/pki/authorities/local/root.crt'
$rsomPublicDirectory = Join-Path $rsomWorkspace '.local-https/public'
if (-not (Test-Path -LiteralPath $rsomRootCertificate)) { throw 'Start the local HTTPS server first so it can create its certificate.' }
New-Item -ItemType Directory -Path $rsomPublicDirectory -Force | Out-Null
# DER certificate only; private keys always stay in the separate storage directory.
& certutil -f -decode $rsomRootCertificate (Join-Path $rsomPublicDirectory 'rsom-root.cer')
if ($LASTEXITCODE -ne 0) { throw 'Public certificate conversion failed.' }

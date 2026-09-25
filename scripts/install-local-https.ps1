$ErrorActionPreference = 'Stop'
$rsomWorkspace = Split-Path -Parent $PSScriptRoot
$rsomLocal = Join-Path $rsomWorkspace '.local-https'
$rsomBin = Join-Path $rsomLocal 'bin'
New-Item -ItemType Directory -Path $rsomBin -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $rsomLocal 'public') -Force | Out-Null

# Portable official Caddy release. No system installation or root-trust changes.
$rsomRelease = Invoke-RestMethod -Uri 'https://api.github.com/repos/caddyserver/caddy/releases/latest' -Headers @{ 'User-Agent' = 'RSOM-local-setup' }
$rsomAsset = @($rsomRelease.assets | Where-Object { $_.name -match '^caddy_.*_windows_amd64\.zip$' })
if ($rsomAsset.Count -ne 1) { throw 'Could not identify the official Windows x64 Caddy archive.' }
$rsomAsset = $rsomAsset[0]
if ($rsomAsset.browser_download_url -notlike 'https://github.com/caddyserver/caddy/releases/download/*') { throw 'Unexpected Caddy download source.' }
$rsomArchive = Join-Path $rsomLocal $rsomAsset.name
Invoke-WebRequest -UseBasicParsing -Uri $rsomAsset.browser_download_url -OutFile $rsomArchive
$rsomExpected = $rsomAsset.digest
if ($rsomExpected -match '^sha256:([a-fA-F0-9]{64})$') {
    $rsomExpected = $Matches[1]
} else {
    $rsomChecksums = @($rsomRelease.assets | Where-Object { $_.name -match 'checksums\.txt$' })
    if ($rsomChecksums.Count -ne 1) { throw 'Could not identify official Caddy checksums.' }
    $rsomChecksumText = (Invoke-WebRequest -UseBasicParsing -Uri $rsomChecksums[0].browser_download_url).Content
    $rsomChecksumLine = $rsomChecksumText -split "`n" | Where-Object { $_ -match ([regex]::Escape($rsomAsset.name) + '\s*$') }
    if (-not $rsomChecksumLine -or $rsomChecksumLine -notmatch '^([a-fA-F0-9]{64})\s') { throw 'No matching SHA-256 checksum found.' }
    $rsomExpected = $Matches[1]
}
$rsomActual = (Get-FileHash -LiteralPath $rsomArchive -Algorithm SHA256).Hash
if ($rsomActual -ne $rsomExpected) { throw 'Caddy download checksum mismatch; refusing to extract.' }
Expand-Archive -LiteralPath $rsomArchive -DestinationPath $rsomBin -Force
& (Join-Path $rsomBin 'caddy.exe') version
if ($LASTEXITCODE -ne 0) { throw 'Caddy could not run.' }
Write-Output 'Portable HTTPS server installed in .local-https/bin. No system certificates were installed.'

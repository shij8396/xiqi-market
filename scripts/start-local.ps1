$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Path (Join-Path $projectRoot '.runtime') -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
}
& node scripts/local-db.js
if ($LASTEXITCODE -ne 0) { throw 'Database startup failed; see README.md' }
& node scripts/init-db.js
if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html'))) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
}
$healthy = $false
try { $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3088/health' -TimeoutSec 2; $healthy = $response.data.status -eq 'ready' } catch {}
if (-not $healthy) {
    $nodePath = (Get-Command node.exe).Source
    $process = Start-Process -FilePath $nodePath -ArgumentList @('server/index.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.runtime/server.out.log') -RedirectStandardError (Join-Path $projectRoot '.runtime/server.err.log') -PassThru
    $process.Id | Set-Content -LiteralPath (Join-Path $projectRoot '.runtime/server.pid')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3088/health' -TimeoutSec 2; if ($response.data.status -eq 'ready') { $healthy = $true; break } } catch {}
    }
}
if (-not $healthy) { throw 'Server did not become ready; see .runtime/server.err.log' }
Write-Host 'XiQi Campus Market: http://127.0.0.1:3088'

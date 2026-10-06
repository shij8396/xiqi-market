param(
    [Parameter(Mandatory = $true)][string]$ServerAddress,
    [string]$ServerUser = 'admin',
    [string]$KeyPath = '',
    [string]$LocalAddress = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $KeyPath) { $KeyPath = Join-Path $projectRoot ".runtime/deploy-$ServerAddress-ed25519" }
if (-not (Test-Path -LiteralPath $KeyPath)) { throw "Missing SSH private key: $KeyPath" }
$sshPath = (Get-Command ssh.exe).Source
if (-not $LocalAddress) {
    $LocalAddress = (Get-NetIPAddress -InterfaceAlias WLAN -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' } | Select-Object -First 1).IPAddress
}
New-Item -ItemType Directory -Path (Join-Path $projectRoot '.runtime') -Force | Out-Null
function Test-TunnelPort {
    $socket = [Net.Sockets.TcpClient]::new()
    try {
        $connect = $socket.ConnectAsync('127.0.0.1', 8443)
        return ($connect.Wait(1000) -and $socket.Connected)
    } catch { return $false } finally { $socket.Dispose() }
}
if (-not (Test-TunnelPort)) {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        $arguments = @('-N', '-L', '127.0.0.1:8443:127.0.0.1:8443', '-i', ('"' + $KeyPath + '"'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', "$ServerUser@$ServerAddress")
        if ($LocalAddress) { $arguments = @('-b', $LocalAddress) + $arguments }
        $process = Start-Process -FilePath $sshPath -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardError (Join-Path $projectRoot '.runtime/server-tunnel.log') -PassThru
        for ($check = 0; $check -lt 12; $check++) {
            if (Test-TunnelPort) { break }
            if ($process.HasExited) { break }
            Start-Sleep -Milliseconds 500
        }
        if (Test-TunnelPort) {
            $process.Id | Set-Content -LiteralPath (Join-Path $projectRoot '.runtime/server-tunnel.pid')
            break
        }
        if (-not $process.HasExited) { Stop-Process -Id $process.Id }
    }
}
if (-not (Test-TunnelPort)) { throw 'SSH connection failed; see .runtime/server-tunnel.log' }
Write-Host 'Server test site: https://localhost:8443 (private test certificate)'

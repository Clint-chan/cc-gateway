param(
  [string]$ConfigPath = "config.capture.yaml",
  [int]$GatewayPort = 9443,
  [int]$MitmPort = 18080,
  [string]$UpstreamProxy = "http://127.0.0.1:10808",
  [string]$CaPath = "$env:USERPROFILE\\.mitmproxy\\mitmproxy-ca-cert.pem",
  [string]$FlowPath = "mitm/gateway.flows",
  [string]$MitmLogPath = "mitm/gateway.log",
  [string]$MitmErrPath = "mitm/gateway.err.log",
  [string]$GatewayOutPath = "mitm/gateway-server.out.log",
  [string]$GatewayErrPath = "mitm/gateway-server.err.log"
)

$ErrorActionPreference = "Stop"

function Stop-ListenerProcess {
  param([int]$Port)

  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 1
  }
}

Write-Host "Cleaning previous capture state..."

Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
Stop-ListenerProcess -Port $GatewayPort

foreach ($path in @($FlowPath, $MitmLogPath, $MitmErrPath, $GatewayOutPath, $GatewayErrPath)) {
  if (Test-Path $path) {
    Remove-Item $path -Force
  }
}

Write-Host "Starting mitmdump on port $MitmPort..."
$mitm = Start-Process -FilePath "mitmdump.exe" `
  -ArgumentList "-q", "-p", "$MitmPort", "--mode", "upstream:$UpstreamProxy", "-s", "mitm/capture.py", "-w", $FlowPath `
  -WorkingDirectory (Get-Location).Path `
  -RedirectStandardOutput $MitmLogPath `
  -RedirectStandardError $MitmErrPath `
  -PassThru

Start-Sleep -Seconds 2

Write-Host "Starting capture gateway on port $GatewayPort..."
$gateway = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "set NODE_EXTRA_CA_CERTS=$CaPath && node dist/index.js $ConfigPath" `
  -WorkingDirectory (Get-Location).Path `
  -RedirectStandardOutput $GatewayOutPath `
  -RedirectStandardError $GatewayErrPath `
  -PassThru

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Capture session started."
Write-Host "mitmdump PID: $($mitm.Id)"
Write-Host "gateway PID:  $($gateway.Id)"
Write-Host ""
Write-Host "Next:"
Write-Host "1. Run your Claude Code test against https://localhost:$GatewayPort"
Write-Host "2. Then run: .\\scripts\\finalize-gateway-capture.ps1"


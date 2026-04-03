param(
  [switch]$StopGateway,
  [int]$GatewayPort = 9443,
  [string]$FlowPath = "mitm/gateway.flows",
  [string]$DirectFlowPath = "mitm/claude-cli.flows",
  [string]$UrlFilter = "/v1/messages"
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

Write-Host "Stopping mitmdump to flush .flows..."
Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

if ($StopGateway) {
  Write-Host "Stopping capture gateway on port $GatewayPort..."
  Stop-ListenerProcess -Port $GatewayPort
}

if (-not (Test-Path $FlowPath)) {
  throw "Missing flow file: $FlowPath"
}

Write-Host ""
Write-Host "Latest gateway signals:"
python mitm/extract_signals.py $FlowPath

if (Test-Path $DirectFlowPath) {
  Write-Host ""
  Write-Host "Diff against direct capture ($UrlFilter):"
  python mitm/diff_signals.py $DirectFlowPath $FlowPath $UrlFilter
}


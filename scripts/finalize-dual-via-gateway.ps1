param(
  [switch]$StopGateway,
  [int]$GatewayPort = 9443,
  [string]$GatewayFlowPath = "mitm/dual-gateway.flows",
  [string]$DirectFlowPath = "mitm/dual-direct.flows"
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

Write-Host "Stopping mitmdump instances to flush .flows..."
Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

if ($StopGateway) {
  Write-Host "Stopping capture gateway on port $GatewayPort..."
  Stop-ListenerProcess -Port $GatewayPort
}

foreach ($path in @($DirectFlowPath, $GatewayFlowPath)) {
  if (-not (Test-Path $path)) {
    throw "Missing flow file: $path"
  }
}

Write-Host ""
Write-Host "Direct side-channel signals (/api/eval/):"
python mitm/extract_signals.py $DirectFlowPath 20 /api/eval/

Write-Host ""
Write-Host "Direct side-channel signals (/v1/messages):"
python mitm/extract_signals.py $DirectFlowPath 20 /v1/messages

Write-Host ""
Write-Host "Direct side-channel signals (/api/event_logging/):"
python mitm/extract_signals.py $DirectFlowPath 20 /api/event_logging/

Write-Host ""
Write-Host "Gateway-upstream signals (/api/eval/):"
python mitm/extract_signals.py $GatewayFlowPath 20 /api/eval/

Write-Host ""
Write-Host "Gateway-upstream signals (/v1/messages):"
python mitm/extract_signals.py $GatewayFlowPath 20 /v1/messages

Write-Host ""
Write-Host "Gateway-upstream signals (/api/event_logging/):"
python mitm/extract_signals.py $GatewayFlowPath 20 /api/event_logging/

Write-Host ""
Write-Host "Gateway-upstream control-plane hits:"
Select-String -Path "mitm\\dual-gateway.log" -Pattern '/api/eval/|v1/mcp_servers|claude_cli/bootstrap|oauth/account/settings|claude_code_grove|mcp-registry|event_logging' | ForEach-Object { $_.Line }

Write-Host ""
Write-Host "Direct side-channel hits:"
Select-String -Path "mitm\\dual-direct.log" -Pattern '/api/eval/|v1/mcp_servers|claude_cli/bootstrap|oauth/account/settings|claude_code_grove|mcp-registry|event_logging' | ForEach-Object { $_.Line }

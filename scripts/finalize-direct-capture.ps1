param(
  [string]$FlowPath = "mitm/direct.flows"
)

$ErrorActionPreference = "Stop"

Write-Host "Stopping mitmdump to flush .flows..."
Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

if (-not (Test-Path $FlowPath)) {
  throw "Missing flow file: $FlowPath"
}

Write-Host ""
Write-Host "Latest direct signals:"
python mitm/extract_signals.py $FlowPath

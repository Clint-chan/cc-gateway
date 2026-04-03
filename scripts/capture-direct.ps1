param(
  [int]$MitmPort = 18081,
  [string]$UpstreamProxy = "http://127.0.0.1:10808",
  [string]$FlowPath = "mitm/direct.flows",
  [string]$MitmLogPath = "mitm/direct.log",
  [string]$MitmErrPath = "mitm/direct.err.log"
)

$ErrorActionPreference = "Stop"

Write-Host "Cleaning previous direct-capture state..."

Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force

foreach ($path in @($FlowPath, $MitmLogPath, $MitmErrPath)) {
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

Write-Host ""
Write-Host "Direct capture started."
Write-Host "mitmdump PID: $($mitm.Id)"
Write-Host ""
Write-Host "Next:"
Write-Host "1. Open a fresh PowerShell."
Write-Host "2. Point Claude Code at this MITM proxy:"
Write-Host "   `$env:HTTP_PROXY='http://127.0.0.1:$MitmPort'"
Write-Host "   `$env:HTTPS_PROXY='http://127.0.0.1:$MitmPort'"
Write-Host "   `$env:ALL_PROXY='http://127.0.0.1:$MitmPort'"
Write-Host "3. Remove quiet-mode env vars for alignment:"
Write-Host "   Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue"
Write-Host "   Remove-Item Env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC -ErrorAction SilentlyContinue"
Write-Host "4. Run a direct Claude Code request, for example:"
Write-Host "   claude -p 'hello'"
Write-Host "5. Then run: .\\scripts\\finalize-direct-capture.ps1"

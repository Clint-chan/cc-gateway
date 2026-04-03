param(
  [string]$ConfigPath = "config.capture.yaml",
  [string]$WorkspacePath = "$env:USERPROFILE\cc-alignment-capture\trusted-eval",
  [int]$GatewayPort = 9443,
  [int]$GatewayMitmPort = 18080,
  [string]$GatewayUpstreamProxy = "http://127.0.0.1:10808",
  [int]$DirectMitmPort = 18081,
  [string]$DirectUpstreamProxy = "http://127.0.0.1:10808",
  [string]$CaPath = "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem",
  [string]$GatewayFlowPath = "mitm/dual-gateway.flows",
  [string]$GatewayLogPath = "mitm/dual-gateway.log",
  [string]$GatewayErrPath = "mitm/dual-gateway.err.log",
  [string]$DirectFlowPath = "mitm/dual-direct.flows",
  [string]$DirectLogPath = "mitm/dual-direct.log",
  [string]$DirectErrPath = "mitm/dual-direct.err.log",
  [string]$GatewayOutPath = "mitm/dual-gateway-server.out.log",
  [string]$GatewayServerErrPath = "mitm/dual-gateway-server.err.log",
  [string]$ClientToken = "ea8bb4e71d365b9d7b53c747696c0d1f52ffdb961ecd974fd36d6887d0121713",
  [ValidateSet("external-auth-token", "managed-oauth")]
  [string]$AuthMode = "managed-oauth",
  [string]$GatewayManagedOAuthToken = "gateway-managed"
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

Write-Host "Cleaning previous dual-capture state..."

Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
Stop-ListenerProcess -Port $GatewayPort

foreach ($path in @(
  $GatewayFlowPath,
  $GatewayLogPath,
  $GatewayErrPath,
  $DirectFlowPath,
  $DirectLogPath,
  $DirectErrPath,
  $GatewayOutPath,
  $GatewayServerErrPath
)) {
  if (Test-Path $path) {
    Remove-Item $path -Force
  }
}

Write-Host "Starting direct-side-channel mitmdump on port $DirectMitmPort..."
$directMitm = Start-Process -FilePath "mitmdump.exe" `
  -ArgumentList "-q", "-p", "$DirectMitmPort", "--mode", "upstream:$DirectUpstreamProxy", "-s", "mitm/capture.py", "-w", $DirectFlowPath `
  -WorkingDirectory (Get-Location).Path `
  -RedirectStandardOutput $DirectLogPath `
  -RedirectStandardError $DirectErrPath `
  -PassThru

Start-Sleep -Seconds 2

Write-Host "Starting gateway-upstream mitmdump on port $GatewayMitmPort..."
$gatewayMitm = Start-Process -FilePath "mitmdump.exe" `
  -ArgumentList "-q", "-p", "$GatewayMitmPort", "--mode", "upstream:$GatewayUpstreamProxy", "-s", "mitm/capture.py", "-w", $GatewayFlowPath `
  -WorkingDirectory (Get-Location).Path `
  -RedirectStandardOutput $GatewayLogPath `
  -RedirectStandardError $GatewayErrPath `
  -PassThru

Start-Sleep -Seconds 2

Write-Host "Starting capture gateway on port $GatewayPort..."
$gateway = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "set NODE_EXTRA_CA_CERTS=$CaPath && node dist/index.js $ConfigPath" `
  -WorkingDirectory (Get-Location).Path `
  -RedirectStandardOutput $GatewayOutPath `
  -RedirectStandardError $GatewayServerErrPath `
  -PassThru

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Dual capture session started."
Write-Host "direct mitmdump PID:   $($directMitm.Id)"
Write-Host "gateway mitmdump PID:  $($gatewayMitm.Id)"
Write-Host "gateway server PID:    $($gateway.Id)"
Write-Host ""
Write-Host "Client test environment:"
Write-Host "  Workspace: $WorkspacePath"
Write-Host "  ANTHROPIC_BASE_URL=https://localhost:$GatewayPort"
Write-Host "  auth_mode=$AuthMode"
switch ($AuthMode) {
  "external-auth-token" {
    Write-Host "  ANTHROPIC_AUTH_TOKEN=$ClientToken"
  }
  "managed-oauth" {
    Write-Host "  CLAUDE_CODE_OAUTH_TOKEN=$GatewayManagedOAuthToken"
    Write-Host "  ANTHROPIC_CUSTOM_HEADERS=x-api-key: $ClientToken"
  }
}
Write-Host "  HTTP_PROXY=http://127.0.0.1:$DirectMitmPort"
Write-Host "  HTTPS_PROXY=http://127.0.0.1:$DirectMitmPort"
Write-Host "  ALL_PROXY=http://127.0.0.1:$DirectMitmPort"
Write-Host "  NO_PROXY=localhost,127.0.0.1"
Write-Host "  NODE_TLS_REJECT_UNAUTHORIZED=0"
Write-Host ""
Write-Host "Recommended probe:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\\scripts\\probe-trusted-via-gateway.ps1 -EnableDirectMitm -AuthMode $AuthMode"
Write-Host ""
Write-Host "Next:"
Write-Host "1. Run the trusted via-gateway client request from the workspace above"
Write-Host "2. Then run: .\\scripts\\finalize-dual-via-gateway.ps1"

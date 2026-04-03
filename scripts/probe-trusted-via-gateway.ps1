param(
  [string]$WorkspacePath = "$env:USERPROFILE\cc-alignment-capture\trusted-eval",
  [string]$GatewayUrl = "https://localhost:9443",
  [string]$ClientToken = "ea8bb4e71d365b9d7b53c747696c0d1f52ffdb961ecd974fd36d6887d0121713",
  [ValidateSet("external-auth-token", "managed-oauth")]
  [string]$AuthMode = "managed-oauth",
  [string]$GatewayManagedOAuthToken = "gateway-managed",
  [switch]$EnableDirectMitm,
  [int]$DirectMitmPort = 18081,
  [ValidateSet("hello")]
  [string]$Probe = "hello"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $WorkspacePath)) {
  throw "Workspace path not found: $WorkspacePath"
}

$resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspacePath).Path

$env:ANTHROPIC_BASE_URL = $GatewayUrl
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

Remove-Item Env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_OAUTH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_CUSTOM_HEADERS -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue

switch ($AuthMode) {
  "external-auth-token" {
    $env:ANTHROPIC_AUTH_TOKEN = $ClientToken
  }
  "managed-oauth" {
    $env:CLAUDE_CODE_OAUTH_TOKEN = $GatewayManagedOAuthToken
    $env:ANTHROPIC_CUSTOM_HEADERS = "x-api-key: $ClientToken"
  }
}

if ($EnableDirectMitm) {
  $proxy = "http://127.0.0.1:$DirectMitmPort"
  $env:HTTP_PROXY = $proxy
  $env:HTTPS_PROXY = $proxy
  $env:ALL_PROXY = $proxy
  $env:NO_PROXY = "localhost,127.0.0.1"
} else {
  Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
  Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
  Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
  Remove-Item Env:NO_PROXY -ErrorAction SilentlyContinue
}

Push-Location $resolvedWorkspace
try {
  Write-Host ""
  Write-Host "Trusted via-gateway probe"
  Write-Host "========================="
  Write-Host "workspace_path: $resolvedWorkspace"
  Write-Host "gateway_url: $GatewayUrl"
  Write-Host "auth_mode: $AuthMode"
  Write-Host "direct_mitm_enabled: $EnableDirectMitm"
  if ($EnableDirectMitm) {
    Write-Host "direct_mitm_port: $DirectMitmPort"
    Write-Host "no_proxy: $env:NO_PROXY"
  }
  Write-Host ""

  switch ($Probe) {
    "hello" {
      & claude -p "hello"
    }
  }
}
finally {
  Pop-Location
}

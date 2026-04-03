param(
  [string]$WorkspacePath = "$env:USERPROFILE\cc-alignment-capture\trusted-eval",
  [ValidateSet("remote-control", "headless-hello")]
  [string]$Probe = "remote-control",
  [int]$MitmPort = 18081
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $WorkspacePath)) {
  throw "Workspace path not found: $WorkspacePath"
}

$resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspacePath).Path

$env:HTTP_PROXY = "http://127.0.0.1:$MitmPort"
$env:HTTPS_PROXY = "http://127.0.0.1:$MitmPort"
$env:ALL_PROXY = "http://127.0.0.1:$MitmPort"
$env:NODE_EXTRA_CA_CERTS = "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.pem"

Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_OAUTH_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_CUSTOM_HEADERS -ErrorAction SilentlyContinue
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue

Push-Location $resolvedWorkspace
try {
  Write-Host ""
  Write-Host "GrowthBook eval probe"
  Write-Host "====================="
  Write-Host "workspace_path: $resolvedWorkspace"
  Write-Host "probe: $Probe"
  Write-Host "mitm_port: $MitmPort"
  Write-Host ""

  switch ($Probe) {
    "remote-control" {
      & claude remote-control
    }
    "headless-hello" {
      & claude -p "hello"
    }
  }
}
finally {
  Pop-Location
}

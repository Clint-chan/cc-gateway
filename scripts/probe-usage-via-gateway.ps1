param(
  [string]$GatewayUrl = "https://localhost:8443",
  [string]$ClientToken = "ea8bb4e71d365b9d7b53c747696c0d1f52ffdb961ecd974fd36d6887d0121713",
  [string]$OutputPath,
  [switch]$Raw
)

$ErrorActionPreference = "Stop"

$usageUrl = "$($GatewayUrl.TrimEnd('/'))/api/oauth/usage"
$tempPath = if ($OutputPath) {
  $OutputPath
} else {
  Join-Path $env:TEMP "cc-gateway-usage.json"
}

Write-Host ""
Write-Host "Usage probe via gateway"
Write-Host "======================="
Write-Host "usage_url: $usageUrl"
Write-Host "output_path: $tempPath"
Write-Host ""

& curl.exe --noproxy "*" -sk `
  -H "x-api-key: $ClientToken" `
  -H "anthropic-beta: oauth-2025-04-20" `
  $usageUrl `
  -o $tempPath

if (-not (Test-Path $tempPath)) {
  throw "Usage probe did not produce output: $tempPath"
}

if ($Raw) {
  Get-Content -Path $tempPath -Raw
  exit 0
}

$payload = Get-Content -Path $tempPath -Raw | ConvertFrom-Json
[pscustomobject]@{
  five_hour_utilization = $payload.five_hour.utilization
  five_hour_resets_at = $payload.five_hour.resets_at
  seven_day_utilization = $payload.seven_day.utilization
  seven_day_resets_at = $payload.seven_day.resets_at
  seven_day_sonnet_utilization = $payload.seven_day_sonnet.utilization
  seven_day_opus_utilization = $payload.seven_day_opus.utilization
  extra_usage_enabled = $payload.extra_usage.is_enabled
  extra_usage_utilization = $payload.extra_usage.utilization
  extra_usage_used_credits = $payload.extra_usage.used_credits
  raw_path = $tempPath
} | Format-List

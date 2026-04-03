param(
  [string]$WorkspacePath = "$env:USERPROFILE\cc-alignment-capture\trusted-eval",
  [ValidateSet("managed-oauth", "external-auth-token")]
  [string]$AuthMode = "managed-oauth",
  [string[]]$RepeatCounts = @("1", "2", "3"),
  [string[]]$DelayValues = @("0", "250", "1000"),
  [switch]$ArchiveRuns,
  [string]$ArchiveRoot = "artifacts/captures/event-logging-matrix",
  [string]$JsonPath
)

$ErrorActionPreference = "Stop"

function Expand-IntegerValues {
  param([string[]]$Values)

  $expanded = @()
  foreach ($value in $Values) {
    foreach ($part in ($value -split ",")) {
      $trimmed = $part.Trim()
      if ([string]::IsNullOrWhiteSpace($trimmed)) {
        continue
      }

      $parsed = 0
      if (-not [int]::TryParse($trimmed, [ref]$parsed)) {
        throw "Values contains a non-integer entry: $trimmed"
      }
      if ($parsed -lt 0) {
        throw "Values must be zero or positive integers. Invalid value: $parsed"
      }

      $expanded += $parsed
    }
  }

  if ($expanded.Count -eq 0) {
    throw "Values resolved to an empty list."
  }

  return $expanded
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$thresholdScript = Join-Path $PSScriptRoot "sweep-event-logging-threshold.ps1"
$delayList = Expand-IntegerValues -Values $DelayValues
$matrixResults = @()

foreach ($delay in $delayList) {
  Write-Host ""
  Write-Host "Event logging matrix sweep"
  Write-Host "=========================="
  Write-Host "auth_mode: $AuthMode"
  Write-Host "delay_ms: $delay"
  Write-Host ""

  $tempJsonPath = Join-Path $env:TEMP ("event-logging-threshold-{0}-{1}-{2}.json" -f $AuthMode, $delay, [guid]::NewGuid().ToString("N"))
  $invokeArgs = @{
    WorkspacePath      = $WorkspacePath
    AuthMode           = $AuthMode
    RepeatCounts       = $RepeatCounts
    DelayMilliseconds  = $delay
    JsonPath           = $tempJsonPath
  }
  if ($ArchiveRuns) {
    $invokeArgs.ArchiveRuns = $true
    $invokeArgs.ArchiveRoot = (Join-Path $ArchiveRoot ("d{0}" -f $delay))
  }

  & $thresholdScript @invokeArgs | Out-Host

  $thresholdRows = Get-Content -Path $tempJsonPath -Raw | ConvertFrom-Json
  foreach ($row in $thresholdRows) {
    $matrixResults += [pscustomobject]@{
      AuthMode             = $row.AuthMode
      DelayMilliseconds    = [int]$delay
      RepeatCount          = [int]$row.RepeatCount
      EventDirectCount     = [int]$row.EventDirectCount
      EventGatewayCount    = [int]$row.EventGatewayCount
      EventOwner           = [string]$row.EventOwner
      EvalDirectCount      = [int]$row.EvalDirectCount
      EvalGatewayCount     = [int]$row.EvalGatewayCount
      EvalOwner            = [string]$row.EvalOwner
      MessagesGatewayCount = [int]$row.MessagesGatewayCount
    }
  }

  Remove-Item -LiteralPath $tempJsonPath -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Matrix summary"
Write-Host "=============="
$matrixResults |
  Sort-Object DelayMilliseconds, RepeatCount |
  Format-Table DelayMilliseconds, RepeatCount, EventDirectCount, EventGatewayCount, EventOwner, EvalDirectCount, MessagesGatewayCount -AutoSize

if ($JsonPath) {
  $jsonParent = Split-Path -Parent $JsonPath
  if ($jsonParent) {
    New-Item -ItemType Directory -Force -Path $jsonParent | Out-Null
  }
  $matrixResults |
    Sort-Object DelayMilliseconds, RepeatCount |
    ConvertTo-Json -Depth 5 |
    Out-File -FilePath $JsonPath -Encoding utf8
}

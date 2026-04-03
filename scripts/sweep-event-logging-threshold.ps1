param(
  [string]$WorkspacePath = "$env:USERPROFILE\cc-alignment-capture\trusted-eval",
  [ValidateSet("managed-oauth", "external-auth-token")]
  [string]$AuthMode = "managed-oauth",
  [string[]]$RepeatCounts = @("1", "2", "3"),
  [int]$DelayMilliseconds = 250,
  [switch]$ArchiveRuns,
  [string]$ArchiveRoot = "artifacts/captures/event-logging-threshold"
)

$ErrorActionPreference = "Stop"

function Expand-RepeatCounts {
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
        throw "RepeatCounts contains a non-integer value: $trimmed"
      }
      if ($parsed -lt 1) {
        throw "RepeatCounts must be positive integers. Invalid value: $parsed"
      }

      $expanded += $parsed
    }
  }

  if ($expanded.Count -eq 0) {
    throw "RepeatCounts resolved to an empty list."
  }

  return $expanded
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$captureScript = Join-Path $PSScriptRoot "capture-dual-via-gateway.ps1"
$probeScript = Join-Path $PSScriptRoot "probe-trusted-via-gateway.ps1"
$finalizeScript = Join-Path $PSScriptRoot "finalize-dual-via-gateway.ps1"
$summaryScript = Join-Path $repoRoot "mitm\summarize_control_plane_matrix.py"
$repeatCountList = Expand-RepeatCounts -Values $RepeatCounts

if ($ArchiveRuns) {
  $timestamp = Get-Date -Format "yyyy-MM-ddTHHmmss"
  $archiveSessionRoot = Join-Path $repoRoot (Join-Path $ArchiveRoot "$AuthMode-$timestamp")
  New-Item -ItemType Directory -Force -Path $archiveSessionRoot | Out-Null
}

$results = @()

foreach ($repeatCount in $repeatCountList) {
  Write-Host ""
  Write-Host "Event logging threshold sweep"
  Write-Host "============================"
  Write-Host "auth_mode: $AuthMode"
  Write-Host "repeat_count: $repeatCount"
  Write-Host "delay_ms: $DelayMilliseconds"
  Write-Host ""

  & $captureScript -AuthMode $AuthMode | Out-Host
  & $probeScript `
    -WorkspacePath $WorkspacePath `
    -EnableDirectMitm `
    -AuthMode $AuthMode `
    -RepeatCount $repeatCount `
    -DelayMilliseconds $DelayMilliseconds | Out-Host
  & $finalizeScript -StopGateway | Out-Host

  $summaryJson = & python $summaryScript --mode-label "$AuthMode-r$repeatCount" --format json
  $summary = $summaryJson | ConvertFrom-Json

  $eventRow = $summary.rows | Where-Object { $_.key -eq "event_logging" }
  $evalRow = $summary.rows | Where-Object { $_.key -eq "growthbook_eval" }
  $messageRow = $summary.rows | Where-Object { $_.key -eq "messages" }

  $results += [pscustomobject]@{
    AuthMode             = $AuthMode
    RepeatCount          = $repeatCount
    DelayMilliseconds    = $DelayMilliseconds
    EventDirectCount     = $eventRow.direct_count
    EventGatewayCount    = $eventRow.gateway_count
    EventOwner           = $eventRow.inferred_owner
    EvalDirectCount      = $evalRow.direct_count
    EvalGatewayCount     = $evalRow.gateway_count
    EvalOwner            = $evalRow.inferred_owner
    MessagesGatewayCount = $messageRow.gateway_count
  }

  if ($ArchiveRuns) {
    $runDir = Join-Path $archiveSessionRoot ("r{0}-d{1}" -f $repeatCount, $DelayMilliseconds)
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null

    foreach ($file in @(
      "mitm/dual-direct.log",
      "mitm/dual-direct.flows",
      "mitm/dual-gateway.log",
      "mitm/dual-gateway.flows"
    )) {
      $sourcePath = Join-Path $repoRoot $file
      if (Test-Path $sourcePath) {
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $runDir (Split-Path $file -Leaf)) -Force
      }
    }

    $summaryJson | Out-File -FilePath (Join-Path $runDir "summary.json") -Encoding utf8
  }
}

Write-Host ""
Write-Host "Sweep summary"
Write-Host "============="
$results | Format-Table -AutoSize

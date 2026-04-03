param(
  [string]$WorkspacePath = "$env:USERPROFILE\cc-alignment-capture\trusted-eval",
  [ValidateSet("managed-oauth", "external-auth-token")]
  [string]$AuthMode = "managed-oauth",
  [string[]]$ProbeTypes = @("hello", "hello-json-verbose", "hello-stream-json-verbose"),
  [string[]]$RepeatCounts = @("1", "2"),
  [int]$DelayMilliseconds = 250,
  [switch]$ArchiveRuns,
  [string]$ArchiveRoot = "artifacts/captures/event-logging-probe-matrix",
  [string]$JsonPath
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$thresholdScript = Join-Path $PSScriptRoot "sweep-event-logging-threshold.ps1"
$matrixResults = @()

foreach ($probe in $ProbeTypes) {
  Write-Host ""
  Write-Host "Event logging probe matrix"
  Write-Host "=========================="
  Write-Host "auth_mode: $AuthMode"
  Write-Host "probe: $probe"
  Write-Host "delay_ms: $DelayMilliseconds"
  Write-Host ""

  $tempJsonPath = Join-Path $env:TEMP ("event-logging-probe-{0}-{1}-{2}.json" -f $AuthMode, $probe, [guid]::NewGuid().ToString("N"))
  $invokeArgs = @{
    WorkspacePath      = $WorkspacePath
    AuthMode           = $AuthMode
    Probe              = $probe
    RepeatCounts       = $RepeatCounts
    DelayMilliseconds  = $DelayMilliseconds
    JsonPath           = $tempJsonPath
  }
  if ($ArchiveRuns) {
    $invokeArgs.ArchiveRuns = $true
    $invokeArgs.ArchiveRoot = (Join-Path $ArchiveRoot $probe)
  }

  & $thresholdScript @invokeArgs | Out-Host

  $thresholdRows = Get-Content -Path $tempJsonPath -Raw | ConvertFrom-Json
  foreach ($row in $thresholdRows) {
    $matrixResults += [pscustomobject]@{
      AuthMode             = [string]$row.AuthMode
      Probe                = [string]$row.Probe
      DelayMilliseconds    = [int]$row.DelayMilliseconds
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
Write-Host "Probe matrix summary"
Write-Host "===================="
$matrixResults |
  Sort-Object Probe, RepeatCount |
  Format-Table Probe, RepeatCount, DelayMilliseconds, EventDirectCount, EventGatewayCount, EventOwner, EvalDirectCount, MessagesGatewayCount -AutoSize

if ($JsonPath) {
  $jsonParent = Split-Path -Parent $JsonPath
  if ($jsonParent) {
    New-Item -ItemType Directory -Force -Path $jsonParent | Out-Null
  }
  $matrixResults |
    Sort-Object Probe, RepeatCount |
    ConvertTo-Json -Depth 5 |
    Out-File -FilePath $JsonPath -Encoding utf8
}

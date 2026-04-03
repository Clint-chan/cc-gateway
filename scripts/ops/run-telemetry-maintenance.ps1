param(
  [string]$Label = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$OutputPath = '',
  [switch]$OpenReport
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
  $current = Resolve-Path .
  while ($true) {
    if (Test-Path (Join-Path $current 'package.json')) {
      return $current
    }
    $parent = Split-Path $current -Parent
    if (-not $parent -or $parent -eq $current) {
      throw 'Could not locate repository root from the current working directory.'
    }
    $current = $parent
  }
}

$repoRoot = Resolve-RepoRoot
Set-Location $repoRoot

if (-not $OutputPath) {
  $OutputPath = Join-Path $repoRoot ("artifacts\\reports\\telemetry-{0}.md" -f $Label)
}

$outputDir = Split-Path $OutputPath -Parent
if ($outputDir) {
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$command = @(
  'python',
  'mitm/render_telemetry_report.py',
  '--label',
  $Label,
  '--output',
  $OutputPath
)

Write-Host "[telemetry] generating maintenance report..." -ForegroundColor Cyan
Write-Host ("[telemetry] repo root: {0}" -f $repoRoot)
Write-Host ("[telemetry] output: {0}" -f $OutputPath)

& $command[0] $command[1..($command.Length - 1)]
if ($LASTEXITCODE -ne 0) {
  throw "Telemetry report generation failed with exit code $LASTEXITCODE"
}

$preview = Get-Content $OutputPath -TotalCount 24
Write-Host ''
Write-Host '[telemetry] report preview:' -ForegroundColor Green
$preview | ForEach-Object { Write-Host $_ }

if ($OpenReport) {
  Invoke-Item $OutputPath
}

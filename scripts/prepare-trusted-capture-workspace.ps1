param(
  [string]$WorkspacePath = "$env:USERPROFILE\cc-alignment-capture\trusted-eval",
  [string]$ConfigPath = "$env:USERPROFILE\.claude.json",
  [switch]$RevokeTrust
)

$ErrorActionPreference = "Stop"

function Normalize-ProjectKey {
  param([string]$Path)

  return (($Path -replace "\\", "/").TrimEnd("/"))
}

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Set-NotePropertyValue {
  param(
    [object]$InputObject,
    [string]$Name,
    $Value
  )

  $property = $InputObject.PSObject.Properties[$Name]
  if ($property) {
    $property.Value = $Value
    return
  }

  Add-Member -InputObject $InputObject -MemberType NoteProperty -Name $Name -Value $Value
}

function Set-WorkspaceMarker {
  param(
    [string]$Path,
    [bool]$Trusted
  )

  $markerPath = Join-Path $Path "CAPTURE_WORKSPACE.md"
  $lines = @(
    '# Trusted Capture Workspace',
    '',
    'This directory exists only for Claude Code telemetry capture experiments.',
    '',
    '- Purpose: trigger trusted GrowthBook and telemetry code paths without reusing the home directory or the main repo root.',
    '- Managed by: scripts/prepare-trusted-capture-workspace.ps1.',
    ('- Current trust target: ' + ($(if ($Trusted) { 'trusted' } else { 'not trusted' }))),
    '',
    'Use this workspace together with:',
    '- scripts/inspect-growthbook-state.ps1',
    '- scripts/probe-growthbook-eval-direct.ps1',
    '- scripts/capture-direct.ps1',
    '- scripts/finalize-direct-capture.ps1'
  )
  Set-Content -LiteralPath $markerPath -Value $lines -Encoding utf8
}

if (-not (Test-Path $ConfigPath)) {
  throw "Claude global config not found: $ConfigPath"
}

Ensure-Directory -Path $WorkspacePath

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "$ConfigPath.capture-backup-$timestamp"
Copy-Item -LiteralPath $ConfigPath -Destination $backupPath -Force

$raw = Get-Content -LiteralPath $ConfigPath -Raw -Encoding utf8
$config = $raw | ConvertFrom-Json

if (-not $config.PSObject.Properties["projects"] -or $null -eq $config.projects) {
  Add-Member -InputObject $config -MemberType NoteProperty -Name "projects" -Value ([pscustomobject]@{})
}

$projectKey = Normalize-ProjectKey -Path (Resolve-Path -LiteralPath $WorkspacePath).Path
$currentProject = $config.projects.PSObject.Properties[$projectKey].Value

if ($null -eq $currentProject) {
  $currentProject = [pscustomobject]@{}
}

Set-NotePropertyValue -InputObject $currentProject -Name "hasTrustDialogAccepted" -Value (-not $RevokeTrust)
if (-not $currentProject.PSObject.Properties["projectOnboardingSeenCount"]) {
  Add-Member -InputObject $currentProject -MemberType NoteProperty -Name "projectOnboardingSeenCount" -Value 0
}

Set-NotePropertyValue -InputObject $config.projects -Name $projectKey -Value $currentProject
$json = $config | ConvertTo-Json -Depth 100
Set-Content -LiteralPath $ConfigPath -Value $json -Encoding utf8

Set-WorkspaceMarker -Path $WorkspacePath -Trusted (-not $RevokeTrust)

Write-Host ""
Write-Host "Trusted capture workspace updated."
Write-Host "workspace_path: $WorkspacePath"
Write-Host "project_key: $projectKey"
Write-Host "trusted: $(-not $RevokeTrust)"
Write-Host "config_backup: $backupPath"
Write-Host ""
Write-Host "Next:"
Write-Host "1. powershell -ExecutionPolicy Bypass -File .\\scripts\\inspect-growthbook-state.ps1 -CurrentPath `"$WorkspacePath`""
Write-Host "2. powershell -ExecutionPolicy Bypass -File .\\scripts\\capture-direct.ps1"
Write-Host "3. powershell -ExecutionPolicy Bypass -File .\\scripts\\probe-growthbook-eval-direct.ps1 -WorkspacePath `"$WorkspacePath`""
Write-Host "4. powershell -ExecutionPolicy Bypass -File .\\scripts\\finalize-direct-capture.ps1"

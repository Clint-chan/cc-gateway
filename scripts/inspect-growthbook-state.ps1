param(
  [string]$ConfigPath = "$env:USERPROFILE\.claude.json",
  [string]$CurrentPath = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

function Normalize-ConfigPath {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }

  return (($Path -replace "\\", "/").TrimEnd("/"))
}

function Get-NearestProjectEntry {
  param(
    [object]$Projects,
    [string]$Path
  )

  if (-not $Projects) {
    return $null
  }

  $normalizedPath = Normalize-ConfigPath $Path
  $matches = @()

  foreach ($property in $Projects.PSObject.Properties) {
    $key = Normalize-ConfigPath $property.Name
    if (
      $normalizedPath -eq $key -or
      $normalizedPath.StartsWith("$key/", [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      $matches += [pscustomobject]@{
        Key    = $property.Name
        Value  = $property.Value
        Length = $key.Length
      }
    }
  }

  return $matches | Sort-Object Length -Descending | Select-Object -First 1
}

if (-not (Test-Path $ConfigPath)) {
  throw "Claude global config not found: $ConfigPath"
}

$configItem = Get-Item $ConfigPath
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json

$cachedProps = @()
if ($config.cachedGrowthBookFeatures) {
  $cachedProps = @($config.cachedGrowthBookFeatures.PSObject.Properties)
}

$currentProject = Get-NearestProjectEntry -Projects $config.projects -Path $CurrentPath
$homeProject = Get-NearestProjectEntry -Projects $config.projects -Path $env:USERPROFILE

$relevantGlobalEnvKeys = @(
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DISABLE_TELEMETRY",
  "ANTHROPIC_BASE_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY"
)

$globalEnvRows = @()
if ($config.env) {
  foreach ($property in $config.env.PSObject.Properties) {
    if ($relevantGlobalEnvKeys -contains $property.Name) {
      $globalEnvRows += [pscustomobject]@{
        Name  = $property.Name
        Value = $property.Value
      }
    }
  }
}

$gateKeys = @(
  "tengu_ccr_bridge",
  "tengu_bridge_repl_v2",
  "tengu_bridge_min_version",
  "tengu_1p_event_batch_config",
  "tengu_copper_bridge"
)

$gateRows = @()
foreach ($gateKey in $gateKeys) {
  $value = $null
  if ($config.cachedGrowthBookFeatures) {
    $property = $config.cachedGrowthBookFeatures.PSObject.Properties[$gateKey]
    if ($property) {
      $value = $property.Value
    }
  }

  $gateRows += [pscustomobject]@{
    Gate  = $gateKey
    Value = if ($null -eq $value) { "<missing>" } else { ($value | ConvertTo-Json -Compress -Depth 8) }
  }
}

Write-Host ""
Write-Host "GrowthBook State"
Write-Host "================="
Write-Host "config_path: $($configItem.FullName)"
Write-Host "config_last_write: $($configItem.LastWriteTime.ToString('o'))"
Write-Host "current_cwd: $CurrentPath"
Write-Host "cached_feature_count: $($cachedProps.Count)"
Write-Host ""

Write-Host "Project Trust"
Write-Host "-------------"
if ($currentProject) {
  Write-Host "current_project_key: $($currentProject.Key)"
  Write-Host "current_project_trust: $($currentProject.Value.hasTrustDialogAccepted)"
} else {
  Write-Host "current_project_key: <missing>"
  Write-Host "current_project_trust: <unknown>"
}

if ($homeProject) {
  Write-Host "home_project_key: $($homeProject.Key)"
  Write-Host "home_project_trust: $($homeProject.Value.hasTrustDialogAccepted)"
} else {
  Write-Host "home_project_key: <missing>"
  Write-Host "home_project_trust: <unknown>"
}
Write-Host ""

Write-Host "Relevant Global Env"
Write-Host "-------------------"
if ($globalEnvRows.Count -gt 0) {
  $globalEnvRows | Format-Table -AutoSize
} else {
  Write-Host "<none>"
}
Write-Host ""

Write-Host "Selected Cached Gates"
Write-Host "---------------------"
$gateRows | Format-Table -AutoSize
Write-Host ""

Write-Host "Recommendations"
Write-Host "---------------"
if ($cachedProps.Count -gt 0) {
  Write-Host "- Disk-cached GrowthBook flags are present. Missing /api/eval in a short run is inconclusive."
} else {
  Write-Host "- No cached GrowthBook flags were found. Cold-start capture should be easier to reason about."
}

if (-not $currentProject -or -not $currentProject.Value.hasTrustDialogAccepted) {
  Write-Host "- Current cwd is not trusted in project config. Interactive/local-jsx commands may skip GrowthBook auth headers."
}

Write-Host "- Non-interactive `claude -p ...` still has implicit trust per reference source, but its GrowthBook init is fire-and-forget."
Write-Host "- For reliable /api/eval capture, prefer a trusted long-lived session or a non-interactive path that explicitly blocks on a GrowthBook gate."

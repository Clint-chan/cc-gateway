param(
  [string]$ConfigPath = "$env:USERPROFILE\.claude.json",
  [string]$BackupRoot = "artifacts\\captures\\grove-cache",
  [string]$AccountUuid,
  [switch]$ClearAll,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ConfigPath)) {
  throw "Claude global config not found: $ConfigPath"
}

$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json

if (-not $config.PSObject.Properties["groveConfigCache"]) {
  Write-Host "grove_cache_present: False"
  Write-Host "removed_keys: <none>"
  return
}

$targetKeys = @()
if ($ClearAll) {
  $targetKeys = @($config.groveConfigCache.PSObject.Properties.Name)
} else {
  $resolvedAccountUuid = $AccountUuid
  if ([string]::IsNullOrWhiteSpace($resolvedAccountUuid) -and $config.oauthAccount) {
    $resolvedAccountUuid = $config.oauthAccount.accountUuid
  }

  if ([string]::IsNullOrWhiteSpace($resolvedAccountUuid)) {
    throw "AccountUuid was not provided and oauthAccount.accountUuid is missing."
  }

  if ($config.groveConfigCache.PSObject.Properties[$resolvedAccountUuid]) {
    $targetKeys = @($resolvedAccountUuid)
  }
}

if ($targetKeys.Count -eq 0) {
  Write-Host "grove_cache_present: True"
  Write-Host "removed_keys: <none>"
  return
}

Write-Host "target_keys: $($targetKeys -join ', ')"

if ($DryRun) {
  Write-Host "dry_run: True"
  return
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $BackupRoot ("claude-config-before-grove-reset-{0}.json" -f $timestamp)
Copy-Item $ConfigPath $backupPath -Force

foreach ($targetKey in $targetKeys) {
  $config.groveConfigCache.PSObject.Properties.Remove($targetKey)
}

if (@($config.groveConfigCache.PSObject.Properties).Count -eq 0) {
  $config.PSObject.Properties.Remove("groveConfigCache")
}

$json = $config | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($ConfigPath, $json, (New-Object System.Text.UTF8Encoding($false)))

$remainingCount = 0
$reloaded = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if ($reloaded.PSObject.Properties["groveConfigCache"]) {
  $remainingCount = @($reloaded.groveConfigCache.PSObject.Properties).Count
}

Write-Host "backup_path: $backupPath"
Write-Host "removed_keys: $($targetKeys -join ', ')"
Write-Host "remaining_keys: $remainingCount"

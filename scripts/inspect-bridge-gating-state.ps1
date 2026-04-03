param(
  [string]$ConfigPath = "$env:USERPROFILE\.claude.json",
  [string]$CredentialsPath = "$env:USERPROFILE\.claude\.credentials.json"
)

$ErrorActionPreference = "Stop"

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content $Path -Raw | ConvertFrom-Json
  } catch {
    throw "Failed to parse JSON file: $Path"
  }
}

function Get-EnvValueOrNull {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  return $Value
}

function Format-Value {
  param([object]$Value)

  if ($null -eq $Value) {
    return "<null>"
  }

  if ($Value -is [System.Array]) {
    if ($Value.Count -eq 0) {
      return "<empty>"
    }

    return ($Value -join ", ")
  }

  if ($Value -is [string]) {
    return $Value
  }

  if ($Value -is [bool]) {
    return $Value.ToString()
  }

  if ($Value -is [System.Collections.IDictionary] -or $Value.PSObject.Properties.Count -gt 0) {
    try {
      return ($Value | ConvertTo-Json -Compress -Depth 20)
    } catch {
      return [string]$Value
    }
  }

  return [string]$Value
}

$config = Read-JsonFile -Path $ConfigPath
$credentials = Read-JsonFile -Path $CredentialsPath

$envAnthropicAuthToken = Get-EnvValueOrNull -Value $env:ANTHROPIC_AUTH_TOKEN
$envClaudeOauthToken = Get-EnvValueOrNull -Value $env:CLAUDE_CODE_OAUTH_TOKEN

$localOauth = $null
if ($credentials -and $credentials.claudeAiOauth) {
  $localOauth = $credentials.claudeAiOauth
}

$oauthAccount = $null
if ($config -and $config.oauthAccount) {
  $oauthAccount = $config.oauthAccount
}

$cachedGrowthBookFeatures = $null
if ($config -and $config.cachedGrowthBookFeatures) {
  $cachedGrowthBookFeatures = $config.cachedGrowthBookFeatures
}

$effectiveAuthMode = "none"
$effectiveTokenSource = "none"
$effectiveScopes = @()
$effectiveSubscriptionType = $null
$effectiveRateLimitTier = $null

if ($envClaudeOauthToken) {
  $effectiveAuthMode = "managed-oauth-env-token"
  $effectiveTokenSource = "CLAUDE_CODE_OAUTH_TOKEN"
  $effectiveScopes = @("user:inference")
  $effectiveSubscriptionType = $null
  $effectiveRateLimitTier = $null
} elseif ($envAnthropicAuthToken) {
  $effectiveAuthMode = "external-auth-token"
  $effectiveTokenSource = "ANTHROPIC_AUTH_TOKEN"
  $effectiveScopes = @()
  $effectiveSubscriptionType = $null
  $effectiveRateLimitTier = $null
} elseif ($localOauth -and $localOauth.accessToken) {
  $effectiveAuthMode = "local-claude-ai-oauth"
  $effectiveTokenSource = "claude.ai secure storage"
  $effectiveScopes = @($localOauth.scopes)
  $effectiveSubscriptionType = $localOauth.subscriptionType
  $effectiveRateLimitTier = $localOauth.rateLimitTier
}

$isAnthropicAuthEnabled = ($effectiveAuthMode -ne "external-auth-token" -and $effectiveAuthMode -ne "none")
$hasAccessToken = ($effectiveAuthMode -ne "none")
$isClaudeAiSubscriber = $isAnthropicAuthEnabled -and ($effectiveScopes -contains "user:inference")
$hasProfileScope = $effectiveScopes -contains "user:profile"
$organizationUuid = $null
if ($oauthAccount) {
  $organizationUuid = $oauthAccount.organizationUuid
}

$cachedBridgeGate = $null
$cachedBridgeMinVersion = $null
$cachedBridgeReplV2 = $null
if ($cachedGrowthBookFeatures) {
  if ($cachedGrowthBookFeatures.PSObject.Properties["tengu_ccr_bridge"]) {
    $cachedBridgeGate = $cachedGrowthBookFeatures.tengu_ccr_bridge
  }
  if ($cachedGrowthBookFeatures.PSObject.Properties["tengu_bridge_min_version"]) {
    $cachedBridgeMinVersion = $cachedGrowthBookFeatures.tengu_bridge_min_version
  }
  if ($cachedGrowthBookFeatures.PSObject.Properties["tengu_bridge_repl_v2"]) {
    $cachedBridgeReplV2 = $cachedGrowthBookFeatures.tengu_bridge_repl_v2
  }
}

$expectedState = ""
$expectedReason = ""
$expectedError = ""

if (-not $hasAccessToken) {
  $expectedState = "blocked-no-token"
  $expectedReason = "Remote Control fast-path exits before bridge checks if no OAuth access token is available."
  $expectedError = "Remote Control requires authentication first."
} elseif (-not $isClaudeAiSubscriber) {
  $expectedState = "blocked-subscription"
  $expectedReason = "Bridge requires a claude.ai subscriber session. external auth token paths fail here."
  $expectedError = "Error: Remote Control requires a claude.ai subscription. Run `claude auth login` to sign in with your claude.ai account."
} elseif (-not $hasProfileScope) {
  $expectedState = "blocked-profile-scope"
  $expectedReason = "Bridge requires a full-scope login token. Inference-only env OAuth tokens fail here."
  $expectedError = "Error: Remote Control requires a full-scope login token. Long-lived tokens (from `claude setup-token` or CLAUDE_CODE_OAUTH_TOKEN) are limited to inference-only for security reasons. Run `claude auth login` to use Remote Control."
} elseif ([string]::IsNullOrWhiteSpace($organizationUuid)) {
  $expectedState = "blocked-organization-context"
  $expectedReason = "Bridge eligibility also requires oauthAccount.organizationUuid."
  $expectedError = "Error: Unable to determine your organization for Remote Control eligibility. Run `claude auth login` to refresh your account information."
} elseif ($cachedBridgeGate -eq $false) {
  $expectedState = "likely-blocked-feature-gate"
  $expectedReason = "The cached bridge gate is false. Runtime still performs a blocking refresh on false or missing, but the current account is very likely to fail at the final entitlement gate."
  $expectedError = "Error: Remote Control is not yet enabled for your account."
} elseif ($cachedBridgeGate -eq $true) {
  $expectedState = "eligible-from-cache"
  $expectedReason = "The cached bridge gate is true. The command can still fail later on version or policy checks."
  $expectedError = "<none>"
} else {
  $expectedState = "needs-blocking-gate-check"
  $expectedReason = "No cached bridge gate is present. Runtime will do a blocking GrowthBook fetch before deciding."
  $expectedError = "<unknown until runtime>"
}

Write-Host ""
Write-Host "Bridge Gating State"
Write-Host "==================="
Write-Host "config_path: $ConfigPath"
Write-Host "credentials_path: $CredentialsPath"
Write-Host ""

Write-Host "Effective Auth"
Write-Host "--------------"
Write-Host "effective_auth_mode: $effectiveAuthMode"
Write-Host "effective_token_source: $effectiveTokenSource"
Write-Host "has_access_token: $hasAccessToken"
Write-Host "is_anthropic_auth_enabled: $isAnthropicAuthEnabled"
Write-Host "effective_scopes: $(Format-Value $effectiveScopes)"
Write-Host "effective_subscription_type: $(Format-Value $effectiveSubscriptionType)"
Write-Host "effective_rate_limit_tier: $(Format-Value $effectiveRateLimitTier)"
Write-Host "is_claude_ai_subscriber: $isClaudeAiSubscriber"
Write-Host "has_profile_scope: $hasProfileScope"
Write-Host ""

Write-Host "Bridge Inputs"
Write-Host "-------------"
Write-Host "organization_uuid: $(Format-Value $organizationUuid)"
Write-Host "cached_tengu_ccr_bridge: $(Format-Value $cachedBridgeGate)"
Write-Host "cached_tengu_bridge_repl_v2: $(Format-Value $cachedBridgeReplV2)"
Write-Host "cached_tengu_bridge_min_version: $(Format-Value $cachedBridgeMinVersion)"
Write-Host ""

Write-Host "Expected Runtime Result"
Write-Host "-----------------------"
Write-Host "expected_state: $expectedState"
Write-Host "expected_error: $expectedError"
Write-Host ""

Write-Host "Explanation"
Write-Host "-----------"
Write-Host "- $expectedReason"
Write-Host ""

Write-Host "Recommendations"
Write-Host "---------------"
switch ($expectedState) {
  "blocked-subscription" {
    Write-Host "- Do not use remote-control as a probe in external-auth-token mode."
    Write-Host "- Switch to a direct local Claude.ai session if you need bridge-specific research."
  }
  "blocked-profile-scope" {
    Write-Host "- managed-oauth env tokens cannot satisfy Remote Control."
    Write-Host "- Use a real `claude auth login` session for bridge experiments."
  }
  "blocked-organization-context" {
    Write-Host "- Refresh the local Claude.ai login so oauthAccount.organizationUuid is repopulated."
  }
  "likely-blocked-feature-gate" {
    Write-Host "- Treat remote-control as an entitlement probe, not as a generic /api/eval/* probe."
    Write-Host "- If you still need proof, run `claude remote-control` once and compare the returned error text."
  }
  "eligible-from-cache" {
    Write-Host "- If the command still fails, the next checks are bridge min version and policy limits."
  }
  "needs-blocking-gate-check" {
    Write-Host "- Run `claude remote-control` directly to resolve the blocking bridge gate."
  }
  default {
    Write-Host "- Establish a valid Claude.ai login before using bridge diagnostics."
  }
}

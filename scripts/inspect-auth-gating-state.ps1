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

  if ($Value -is [bool]) {
    return $Value.ToString()
  }

  return [string]$Value
}

$config = Read-JsonFile -Path $ConfigPath
$credentials = Read-JsonFile -Path $CredentialsPath

$envAnthropicAuthToken = Get-EnvValueOrNull -Value $env:ANTHROPIC_AUTH_TOKEN
$envClaudeOauthToken = Get-EnvValueOrNull -Value $env:CLAUDE_CODE_OAUTH_TOKEN
$envCustomHeaders = Get-EnvValueOrNull -Value $env:ANTHROPIC_CUSTOM_HEADERS
$envBaseUrl = Get-EnvValueOrNull -Value $env:ANTHROPIC_BASE_URL

$localOauth = $null
if ($credentials -and $credentials.claudeAiOauth) {
  $localOauth = $credentials.claudeAiOauth
}

$oauthAccount = $null
if ($config -and $config.oauthAccount) {
  $oauthAccount = $config.oauthAccount
}

$effectiveAuthMode = "none"
$effectiveTokenSource = "none"
$isAnthropicAuthEnabled = $false
$effectiveScopes = @()
$effectiveSubscriptionType = $null
$effectiveRateLimitTier = $null
$effectiveReason = ""

if ($envClaudeOauthToken) {
  $effectiveAuthMode = "managed-oauth-env-token"
  $effectiveTokenSource = "CLAUDE_CODE_OAUTH_TOKEN"
  $isAnthropicAuthEnabled = $true
  $effectiveScopes = @("user:inference")
  $effectiveSubscriptionType = $null
  $effectiveRateLimitTier = $null
  $effectiveReason = "Reference auth.ts treats CLAUDE_CODE_OAUTH_TOKEN as an inference-only OAuth token. subscriptionType and rateLimitTier are forced to null."
} elseif ($envAnthropicAuthToken) {
  $effectiveAuthMode = "external-auth-token"
  $effectiveTokenSource = "ANTHROPIC_AUTH_TOKEN"
  $isAnthropicAuthEnabled = $false
  $effectiveScopes = @()
  $effectiveSubscriptionType = $null
  $effectiveRateLimitTier = $null
  $effectiveReason = "Reference auth.ts gives ANTHROPIC_AUTH_TOKEN precedence and exits the Claude.ai subscriber path."
} elseif ($localOauth -and $localOauth.accessToken) {
  $effectiveAuthMode = "local-claude-ai-oauth"
  $effectiveTokenSource = "claude.ai secure storage"
  $isAnthropicAuthEnabled = $true
  $effectiveScopes = @($localOauth.scopes)
  $effectiveSubscriptionType = $localOauth.subscriptionType
  $effectiveRateLimitTier = $localOauth.rateLimitTier
  $effectiveReason = "No env override is present, so the local Claude.ai OAuth session remains the effective auth source."
}

$isClaudeAiSubscriber = $isAnthropicAuthEnabled -and ($effectiveScopes -contains "user:inference")
$isConsumerSubscriber = $isClaudeAiSubscriber -and ($effectiveSubscriptionType -in @("max", "pro"))
$hasOauthAccountInfo = $false
if ($oauthAccount -and $oauthAccount.accountUuid) {
  $hasOauthAccountInfo = $true
}

$expectedGroveState = ""
$expectedGroveReason = ""

if (-not $isAnthropicAuthEnabled) {
  $expectedGroveState = "suppressed"
  $expectedGroveReason = "Claude.ai subscriber auth is not active, so Grove gating will not run."
} elseif (-not $isClaudeAiSubscriber) {
  $expectedGroveState = "suppressed"
  $expectedGroveReason = "The effective auth source is not treated as Claude.ai subscriber auth."
} elseif (-not $isConsumerSubscriber) {
  $expectedGroveState = "suppressed"
  $expectedGroveReason = "Grove requires isConsumerSubscriber(), and the effective subscriptionType is null or non-consumer."
} elseif (-not $hasOauthAccountInfo) {
  $expectedGroveState = "suppressed"
  $expectedGroveReason = "Grove qualification also needs oauthAccount.accountUuid in global config."
} else {
  $expectedGroveState = "eligible"
  $expectedGroveReason = "The client has Claude.ai subscriber auth, a consumer subscription, and oauthAccount info. Grove surfaces may still be cache-sensitive."
}

$localSubscriptionType = $null
$localRateLimitTier = $null
$localScopes = @()
if ($localOauth) {
  $localSubscriptionType = $localOauth.subscriptionType
  $localRateLimitTier = $localOauth.rateLimitTier
  $localScopes = @($localOauth.scopes)
}

Write-Host ""
Write-Host "Auth Gating State"
Write-Host "================="
Write-Host "config_path: $ConfigPath"
Write-Host "credentials_path: $CredentialsPath"
Write-Host ""

Write-Host "Environment Overrides"
Write-Host "---------------------"
Write-Host "ANTHROPIC_BASE_URL: $(Format-Value $envBaseUrl)"
Write-Host "ANTHROPIC_AUTH_TOKEN: $(if ($envAnthropicAuthToken) { '<set>' } else { '<unset>' })"
Write-Host "CLAUDE_CODE_OAUTH_TOKEN: $(if ($envClaudeOauthToken) { '<set>' } else { '<unset>' })"
Write-Host "ANTHROPIC_CUSTOM_HEADERS: $(Format-Value $envCustomHeaders)"
Write-Host ""

Write-Host "Local Claude.ai State"
Write-Host "---------------------"
Write-Host "local_oauth_present: $(if ($localOauth) { 'True' } else { 'False' })"
Write-Host "local_scopes: $(Format-Value $localScopes)"
Write-Host "local_subscription_type: $(Format-Value $localSubscriptionType)"
Write-Host "local_rate_limit_tier: $(Format-Value $localRateLimitTier)"
Write-Host "oauth_account_uuid: $(Format-Value $oauthAccount.accountUuid)"
Write-Host "oauth_account_email: $(Format-Value $oauthAccount.emailAddress)"
Write-Host ""

Write-Host "Effective Runtime Interpretation"
Write-Host "--------------------------------"
Write-Host "effective_auth_mode: $effectiveAuthMode"
Write-Host "effective_token_source: $effectiveTokenSource"
Write-Host "is_anthropic_auth_enabled: $isAnthropicAuthEnabled"
Write-Host "effective_scopes: $(Format-Value $effectiveScopes)"
Write-Host "effective_subscription_type: $(Format-Value $effectiveSubscriptionType)"
Write-Host "effective_rate_limit_tier: $(Format-Value $effectiveRateLimitTier)"
Write-Host "is_claude_ai_subscriber: $isClaudeAiSubscriber"
Write-Host "is_consumer_subscriber: $isConsumerSubscriber"
Write-Host ""

Write-Host "Grove Expectation"
Write-Host "-----------------"
Write-Host "expected_grove_state: $expectedGroveState"
Write-Host "has_oauth_account_info: $hasOauthAccountInfo"
Write-Host ""

Write-Host "Explanation"
Write-Host "-----------"
Write-Host "- Effective auth source: $effectiveReason"
Write-Host "- Grove gating: $expectedGroveReason"
Write-Host ""

Write-Host "Recommendations"
Write-Host "---------------"
if ($expectedGroveState -eq "eligible") {
  Write-Host "- If Grove endpoints still do not appear, inspect groveConfigCache and consider a cold-cache capture."
  Write-Host "- For a cold-cache run, use scripts\\clear-grove-cache.ps1 before capture."
} else {
  Write-Host "- Do not keep treating missing Grove requests as a capture failure in this auth mode."
  Write-Host "- If you need Grove/account-settings traffic, switch to a trusted direct run that uses the local Claude.ai subscriber session."
}

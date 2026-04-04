import { request as httpsRequest } from 'https'
import { log } from './logger.js'
import { getProxyAgent } from './net.js'

const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const DEFAULT_SCOPES = [
  'user:inference',
  'user:profile',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
]

type OAuthTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type OAuthFailureHint =
  | 'none'
  | 'reauth_required'
  | 'upstream_rejected'
  | 'network_error'
  | 'unknown'

export type OAuthRuntimeState = {
  status: 'valid' | 'refreshing' | 'degraded'
  failure_hint: OAuthFailureHint
  refresh_failures: number
  has_access_token: boolean
  expires_at?: string
  last_refresh_attempt_at?: string
  last_refresh_success_at?: string
  next_retry_at?: string
  last_error?: string
}

let cachedTokens: OAuthTokens | null = null
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let oauthState: OAuthRuntimeState = {
  status: 'degraded',
  failure_hint: 'unknown',
  refresh_failures: 0,
  has_access_token: false,
}

/**
 * Initialize OAuth with a refresh token.
 * The gateway holds the refresh token and manages access token lifecycle.
 * Client machines never need to contact platform.claude.com.
 */
export async function initOAuth(oauth: {
  access_token?: string
  refresh_token: string
  expires_at?: number
}): Promise<void> {
  const now = Date.now()
  const expiresAt = oauth.expires_at ?? 0
  const fiveMinutes = 5 * 60 * 1000
  clearRefreshTimer()

  if (oauth.access_token && expiresAt > now + fiveMinutes) {
    cachedTokens = {
      accessToken: oauth.access_token,
      refreshToken: oauth.refresh_token,
      expiresAt,
    }
    oauthState = {
      status: 'valid',
      failure_hint: 'none',
      refresh_failures: 0,
      has_access_token: true,
      expires_at: new Date(expiresAt).toISOString(),
      last_refresh_success_at: new Date().toISOString(),
    }
    const remaining = Math.round((expiresAt - now) / 60_000)
    log('info', `Using existing access token (expires in ${remaining} min)`)
    scheduleRefresh(oauth.refresh_token)
    return
  }

  if (oauth.access_token) {
    log('info', 'Access token expired, refreshing...')
  } else {
    log('info', 'No access token provided, refreshing...')
  }

  await attemptRefresh(oauth.refresh_token)
}

function scheduleRefresh(refreshToken: string) {
  if (!cachedTokens) return

  const msUntilExpiry = cachedTokens.expiresAt - Date.now()
  const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 10_000) // 5 min before expiry, minimum 10s
  const nextRetryAt = new Date(Date.now() + refreshIn).toISOString()
  oauthState = {
    ...oauthState,
    status: 'valid',
    failure_hint: 'none',
    has_access_token: true,
    expires_at: new Date(cachedTokens.expiresAt).toISOString(),
    next_retry_at: nextRetryAt,
  }

  clearRefreshTimer()
  refreshTimer = setTimeout(() => {
    void attemptRefresh(cachedTokens?.refreshToken || refreshToken)
  }, refreshIn)
}

/**
 * Get the current valid access token.
 * Returns null if no token available.
 */
export function getAccessToken(): string | null {
  if (!cachedTokens) return null
  if (Date.now() >= cachedTokens.expiresAt) {
    oauthState = {
      ...oauthState,
      status: 'degraded',
      has_access_token: false,
      expires_at: new Date(cachedTokens.expiresAt).toISOString(),
      failure_hint: oauthState.failure_hint === 'none' ? 'unknown' : oauthState.failure_hint,
    }
    log('warn', 'OAuth token expired, waiting for refresh...')
    return null
  }
  return cachedTokens.accessToken
}

export function getOAuthRuntimeState(): OAuthRuntimeState {
  const hasUsableAccessToken = Boolean(cachedTokens && Date.now() < cachedTokens.expiresAt)
  return {
    ...oauthState,
    has_access_token: hasUsableAccessToken,
    expires_at: cachedTokens ? new Date(cachedTokens.expiresAt).toISOString() : oauthState.expires_at,
  }
}

async function attemptRefresh(refreshToken: string): Promise<void> {
  const attemptAt = new Date().toISOString()
  const previousSuccess = oauthState.last_refresh_success_at
  const failureCount = oauthState.refresh_failures

  oauthState = {
    ...oauthState,
    status: 'refreshing',
    last_refresh_attempt_at: attemptAt,
    next_retry_at: undefined,
  }

  try {
    log('info', 'Auto-refreshing OAuth token...')
    cachedTokens = await refreshOAuthToken(refreshToken)
    const successAt = new Date().toISOString()
    oauthState = {
      status: 'valid',
      failure_hint: 'none',
      refresh_failures: 0,
      has_access_token: true,
      expires_at: new Date(cachedTokens.expiresAt).toISOString(),
      last_refresh_attempt_at: attemptAt,
      last_refresh_success_at: successAt,
    }
    log('info', `OAuth token acquired, expires at ${new Date(cachedTokens.expiresAt).toISOString()}`)
    scheduleRefresh(cachedTokens.refreshToken || refreshToken)
  } catch (err) {
    const classified = classifyOAuthFailure(err)
    const retryInMs = 30_000
    const nextRetryAt = new Date(Date.now() + retryInMs).toISOString()

    cachedTokens = null
    oauthState = {
      status: 'degraded',
      failure_hint: classified.failure_hint,
      refresh_failures: failureCount + 1,
      has_access_token: false,
      last_refresh_attempt_at: attemptAt,
      last_refresh_success_at: previousSuccess,
      next_retry_at: nextRetryAt,
      last_error: classified.message,
    }

    log('error', 'OAuth refresh failed; gateway entering degraded mode', {
      failure_hint: classified.failure_hint,
      refresh_failures: oauthState.refresh_failures,
      next_retry_at: nextRetryAt,
      detail: classified.message,
    })

    clearRefreshTimer()
    refreshTimer = setTimeout(() => {
      void attemptRefresh(refreshToken)
    }, retryInMs)
  }
}

function classifyOAuthFailure(err: unknown): { failure_hint: OAuthFailureHint; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  const normalized = message.toLowerCase()

  if (normalized.includes('invalid_grant')) {
    return {
      failure_hint: 'reauth_required',
      message,
    }
  }
  if (normalized.includes('oauth refresh failed (4')) {
    return {
      failure_hint: 'upstream_rejected',
      message,
    }
  }
  if (
    normalized.includes('econn') ||
    normalized.includes('timed out') ||
    normalized.includes('socket') ||
    normalized.includes('network')
  ) {
    return {
      failure_hint: 'network_error',
      message,
    }
  }

  return {
    failure_hint: 'unknown',
    message,
  }
}

function clearRefreshTimer() {
  if (!refreshTimer) return
  clearTimeout(refreshTimer)
  refreshTimer = undefined
}

function refreshOAuthToken(refreshToken: string): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      scope: DEFAULT_SCOPES.join(' '),
    })

    const url = new URL(TOKEN_URL)
    const proxyAgent = getProxyAgent()
    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        agent: proxyAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          if (res.statusCode !== 200) {
            reject(new Error(`OAuth refresh failed (${res.statusCode}): ${JSON.stringify(data)}`))
            return
          }
          resolve({
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
          })
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

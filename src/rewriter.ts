import { createHash } from 'crypto'
import type { Config } from './config.js'
import { log } from './logger.js'

const FINGERPRINT_SALT = '59cf53e54c78'

/**
 * Rewrite identity fields in the API request body.
 *
 * Handles two request types:
 * 1. /v1/messages - rewrite metadata.user_id JSON blob
 * 2. /api/event_logging/batch - rewrite event_data identity/env/process fields
 */
export function rewriteBody(body: Buffer, path: string, config: Config): Buffer {
  return rewriteBodyWithHeaders(body, path, config)
}

export function rewriteBodyWithHeaders(
  body: Buffer,
  path: string,
  config: Config,
  headers?: Record<string, string | string[] | undefined>,
): Buffer {
  const text = body.toString('utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON - pass through unchanged
    return body
  }

  if (path.startsWith('/v1/messages')) {
    rewriteMessagesBody(parsed, config, headers)
  } else if (path.includes('/api/eval/')) {
    rewriteEvalBody(parsed, config, headers)
  } else if (path.includes('/event_logging/batch')) {
    rewriteEventBatch(parsed, config, headers)
  } else if (path.includes('/policy_limits') || path.includes('/settings')) {
    // These are GET-like requests, usually no body to rewrite
    // But if they do have a body, rewrite identity fields
    rewriteGenericIdentity(parsed, config)
  }

  return Buffer.from(JSON.stringify(parsed), 'utf-8')
}

/**
 * Rewrite /api/eval/* payloads used by GrowthBook / remote evaluation.
 * These requests can carry device and account fingerprint attributes outside
 * of the main telemetry batch path.
 */
function rewriteEvalBody(
  body: any,
  config: Config,
  headers?: Record<string, string | string[] | undefined>,
) {
  if (typeof body !== 'object' || body === null) return

  const attrs = body.attributes
  if (typeof attrs !== 'object' || attrs === null) return
  const canonicalVersion = getCanonicalVersion(config, headers)

  if (attrs.id) attrs.id = config.identity.device_id
  if (attrs.deviceID) attrs.deviceID = config.identity.device_id
  if (attrs.platform) attrs.platform = config.env.platform
  if (attrs.email) attrs.email = config.identity.email
  if (attrs.appVersion) attrs.appVersion = canonicalVersion

  // If the client is pointed at a gateway/custom base URL, the host itself
  // becomes a fingerprint signal in GrowthBook targeting. Keep this absent.
  delete attrs.apiBaseUrlHost

  // The payload includes a top-level url in some cases; avoid leaking a
  // gateway origin or local network address through this side channel.
  if (body.url) body.url = ''
}

/**
 * Rewrite /v1/messages request body.
 * Key field: metadata.user_id (JSON-stringified object with device_id, account_uuid, session_id)
 */
function rewriteMessagesBody(
  body: any,
  config: Config,
  headers?: Record<string, string | string[] | undefined>,
) {
  const canonicalVersion = getCanonicalVersion(config, headers)
  const billingFingerprint = computeFingerprintFromRequestBody(body, canonicalVersion)

  // Rewrite metadata.user_id
  if (body?.metadata?.user_id) {
    try {
      const userId = JSON.parse(body.metadata.user_id)
      userId.device_id = config.identity.device_id
      body.metadata.user_id = JSON.stringify(userId)
      log('debug', `Rewrote metadata.user_id device_id`)
    } catch {
      log('warn', `Failed to parse metadata.user_id`)
    }
  }

  // Rewrite system prompt: billing header + environment block
  if (Array.isArray(body.system)) {
    for (let i = 0; i < body.system.length; i++) {
      const item = body.system[i]
      if (typeof item === 'string') {
        body.system[i] = rewritePromptText(item, config, headers, billingFingerprint)
      } else if (item?.text) {
        item.text = rewritePromptText(item.text, config, headers, billingFingerprint)
      }
    }
  } else if (typeof body.system === 'string') {
    body.system = rewritePromptText(body.system, config, headers, billingFingerprint)
  }

  // Rewrite user messages that may contain <system-reminder> with env info
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === 'string') {
        msg.content = rewritePromptText(msg.content, config, headers, billingFingerprint)
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.text) {
            block.text = rewritePromptText(block.text, config, headers, billingFingerprint)
          }
        }
      }
    }
  }
}

/**
 * Comprehensive text rewriter for system prompt and user messages.
 * Rewrites:
 * 1. Billing header (cc_version fingerprint)
 * 2. <env> block (Platform, Shell, OS Version, Working directory)
 * 3. Inline environment references (Primary working directory, etc.)
 * 4. Home directory paths that leak username
 */
function rewritePromptText(
  text: string,
  config: Config,
  headers?: Record<string, string | string[] | undefined>,
  billingFingerprint = '000',
): string {
  const pe = config.prompt_env
  if (!pe) return text

  let result = text
  const canonicalVersion = getCanonicalVersion(config, headers)

  // 1. Billing header fingerprint
  result = result.replace(
    /cc_version=[\d.]+\.[a-f0-9]{3}/g,
    `cc_version=${canonicalVersion}.${billingFingerprint}`,
  )

  if (config.client?.entrypoint) {
    result = result.replace(
      /cc_entrypoint=[^;\s]+/g,
      `cc_entrypoint=${config.client.entrypoint}`,
    )
  }

  // Bun-based official clients overwrite this placeholder in the native HTTP
  // stack before bytes hit the wire. A Node gateway cannot do that, so leaving
  // `cch=00000` in place is a strong non-official signal. Strip it entirely.
  result = result.replace(/\s*cch=00000;/g, '')

  // 2. <env> block format (older prompt format):
  //    Platform: linux
  //    Shell: bash
  //    OS Version: Linux 6.5.0-xxx
  //    Working directory: /home/bob/project
  result = result.replace(
    /Platform:\s*\S+/g,
    `Platform: ${pe.platform}`,
  )
  result = result.replace(
    /Shell:\s*\S+/g,
    `Shell: ${pe.shell}`,
  )
  result = result.replace(
    /OS Version:\s*[^\n<]+/g,
    `OS Version: ${pe.os_version}`,
  )

  // 3. Working directory / Primary working directory
  //    Matches: "Working directory: /any/path" or "Primary working directory: /any/path"
  result = result.replace(
    /((?:Primary )?[Ww]orking directory:\s*)\/\S+/g,
    `$1${pe.working_dir}`,
  )

  // 4. Home directory paths: /Users/xxx/, /home/xxx/, C:\Users\xxx\
  //    Replace with canonical home path to prevent username leakage
  //    Only replace the home prefix, keep the rest of the path
  result = result.replace(
    /\/(?:Users|home)\/[^/\s]+\//g,
    `${pe.working_dir.match(/^\/[^/]+\/[^/]+\//)?.[0] || '/Users/user/'}`,
  )

  return result
}

/**
 * Rewrite /api/event_logging/batch payload.
 * Each event has event_data with identity, env, and process fields.
 */
function rewriteEventBatch(
  body: any,
  config: Config,
  headers?: Record<string, string | string[] | undefined>,
) {
  if (!Array.isArray(body?.events)) return
  const canonicalVersion = getCanonicalVersion(config, headers)

  for (const event of body.events) {
    if (!event?.event_data) continue
    const data = event.event_data

    // Identity fields
    if (data.device_id) data.device_id = config.identity.device_id
    if (data.email) data.email = config.identity.email

    if (config.client?.entrypoint && data.entrypoint) {
      data.entrypoint = config.client.entrypoint
    }

    if (config.client?.client_type && data.client_type) {
      data.client_type = config.client.client_type
    }

    // Environment fingerprint - replace entirely with canonical
    if (data.env) {
      data.env = buildCanonicalEnv(config)
    }

    // Process metrics - generate realistic values
    if (data.process) {
      data.process = buildCanonicalProcess(data.process, config)
    }

    if (data.env && typeof data.env === 'object') {
      data.env.version = canonicalVersion
      data.env.version_base = config.env.version_base || canonicalVersion
    }

    // Strip fields that leak gateway URL or proxy usage
    // logging.ts:143 adds baseUrl = ANTHROPIC_BASE_URL to every api event
    delete data.baseUrl
    delete data.base_url
    // detectGateway() adds gateway type if base URL matches known providers
    delete data.gateway

    // Additional metadata - rewrite base64-encoded blob if present
    if (data.additional_metadata) {
      data.additional_metadata = rewriteAdditionalMetadata(data.additional_metadata, config)
    }

    log('debug', `Rewrote event: ${data.event_name || 'unknown'}`)
  }
}

function rewriteGenericIdentity(body: any, config: Config) {
  if (typeof body !== 'object' || body === null) return
  if (body.device_id) body.device_id = config.identity.device_id
  if (body.email) body.email = config.identity.email
}

/**
 * Build canonical env object from config.
 * Merges config env values into the expected structure.
 */
function buildCanonicalEnv(
  config: Config,
  headers?: Record<string, string | string[] | undefined>,
): Record<string, unknown> {
  const canonicalVersion = getCanonicalVersion(config, headers)
  const env: Record<string, unknown> = {
    platform: config.env.platform,
    platform_raw: config.env.platform_raw || config.env.platform,
    arch: config.env.arch,
    node_version: config.env.node_version,
    terminal: config.env.terminal,
    package_managers: config.env.package_managers,
    runtimes: config.env.runtimes,
    is_running_with_bun: config.env.is_running_with_bun ?? false,
    is_ci: false,
    is_claubbit: false,
    is_claude_code_remote: false,
    is_local_agent_mode: false,
    is_conductor: false,
    is_github_action: false,
    is_claude_code_action: false,
    is_claude_ai_auth: config.env.is_claude_ai_auth ?? true,
    version: canonicalVersion,
    version_base: config.env.version_base || canonicalVersion,
    build_time: config.env.build_time,
    deployment_environment: config.env.deployment_environment,
    vcs: config.env.vcs,
  }

  const optionalKeys = [
    'remote_environment_type',
    'coworker_type',
    'claude_code_container_id',
    'claude_code_remote_session_id',
    'github_event_name',
    'github_actions_runner_environment',
    'github_actions_runner_os',
    'github_action_ref',
    'github_actions_metadata',
    'wsl_version',
    'linux_distro_id',
    'linux_distro_version',
    'linux_kernel',
  ] as const

  for (const key of optionalKeys) {
    if (config.env[key] !== undefined) {
      ;(env as Record<string, unknown>)[key] = config.env[key]
    }
  }

  if (config.env.tags !== undefined) {
    env.tags = Array.isArray(config.env.tags)
      ? config.env.tags
      : String(config.env.tags)
          .split(',')
          .map(v => v.trim())
          .filter(Boolean)
  }

  return env
}

/**
 * Generate realistic process metrics.
 * Keeps uptime from the real event but normalizes hardware-identifying fields.
 */
function buildCanonicalProcess(original: any, config: Config): any {
  // If it's a base64 string, decode → rewrite → re-encode
  if (typeof original === 'string') {
    try {
      const decoded = JSON.parse(Buffer.from(original, 'base64').toString('utf-8'))
      const rewritten = rewriteProcessFields(decoded, config)
      return Buffer.from(JSON.stringify(rewritten)).toString('base64')
    } catch {
      return original
    }
  }

  // If it's already an object
  if (typeof original === 'object') {
    return rewriteProcessFields(original, config)
  }

  return original
}

function rewriteProcessFields(proc: any, config: Config): any {
  const {
    constrained_memory,
    rss_range,
    heap_total_range,
    heap_used_range,
    external_range,
    array_buffers_range,
    cpu_percent_range,
  } = config.process
  return {
    ...proc,
    constrainedMemory: constrained_memory,
    rss: randomInRange(rss_range[0], rss_range[1]),
    heapTotal: randomInRange(heap_total_range[0], heap_total_range[1]),
    heapUsed: randomInRange(heap_used_range[0], heap_used_range[1]),
    ...(external_range
      ? { external: randomInRange(external_range[0], external_range[1]) }
      : {}),
    ...(array_buffers_range
      ? { arrayBuffers: randomInRange(array_buffers_range[0], array_buffers_range[1]) }
      : {}),
    ...(cpu_percent_range
      ? { cpuPercent: randomInRange(cpu_percent_range[0], cpu_percent_range[1]) }
      : {}),
    // Keep uptime and cpuUsage as-is. They vary with live runtime activity and
    // are less device-specific than memory layout signals.
  }
}

function rewriteAdditionalMetadata(original: string, config: Config): string {
  try {
    const decoded = JSON.parse(Buffer.from(original, 'base64').toString('utf-8'))
    // rh (repo hash) is fine to keep - users work on different repos naturally
    // Strip fields that leak gateway URL
    delete decoded.baseUrl
    delete decoded.base_url
    delete decoded.gateway
    return Buffer.from(JSON.stringify(decoded)).toString('base64')
  } catch {
    return original
  }
}

function randomInRange(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min))
}

function getCanonicalVersion(
  config: Config,
  headers?: Record<string, string | string[] | undefined>,
): string {
  const inboundUserAgent = headers
    ? getHeaderValue(headers, 'user-agent')
    : undefined

  const ua = inboundUserAgent || config.client?.user_agent
  if (typeof ua === 'string') {
    const match = ua.match(/claude-(?:cli|code)\/([0-9][0-9A-Za-z.\-]*)/)
    if (match?.[1]) {
      log('debug', `Canonical version resolved from user-agent: ${match[1]}`)
      return match[1]
    }
  }

  log('debug', `Canonical version fell back to config.env.version: ${String(config.env.version)}`)
  return String(config.env.version)
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const direct = headers[name]
  if (typeof direct === 'string') return direct
  if (Array.isArray(direct)) return direct.join(', ')

  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase())
  if (!key) return undefined
  const value = headers[key]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ')
  return undefined
}

function computeFingerprintFromRequestBody(body: any, version: string): string {
  const firstUserText = extractFirstUserMessageText(body)
  return computeBillingFingerprint(firstUserText, version)
}

function extractFirstUserMessageText(body: any): string {
  if (!Array.isArray(body?.messages)) return ''

  for (const msg of body.messages) {
    if (msg?.role !== 'user') continue
    const content = msg.content
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content)) {
      const textBlock = content.find(
        (block: any) => block?.type === 'text' && typeof block?.text === 'string',
      )
      if (textBlock?.text) {
        return textBlock.text
      }
    }
  }

  return ''
}

function computeBillingFingerprint(messageText: string, version: string): string {
  const chars = [4, 7, 20].map(i => messageText[i] || '0').join('')
  const fingerprintInput = `${FINGERPRINT_SALT}${chars}${version}`
  const hash = createHash('sha256').update(fingerprintInput).digest('hex')
  return hash.slice(0, 3)
}

/**
 * Rewrite HTTP headers to canonical identity.
 */
export function rewriteHeaders(
  headers: Record<string, string | string[] | undefined>,
  config: Config,
): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue
    const v = Array.isArray(value) ? value.join(', ') : value
    const lower = key.toLowerCase()

    // Skip hop-by-hop headers and auth (gateway injects the real OAuth token)
    if ([
      'host',
      'connection',
      'proxy-authorization',
      'proxy-connection',
      'transfer-encoding',
      'authorization',
      'x-api-key',
      'x-claude-remote-container-id',
      'x-claude-remote-session-id',
    ].includes(lower)) {
      continue
    }

    if (lower === 'user-agent') {
      // Preserve the official client's original user agent whenever present.
      // Replacing it with a home-grown canonical string creates a stronger
      // fingerprint mismatch than simply forwarding the real first-party one.
      out[key] = config.client?.user_agent || v
    } else if (lower === 'x-anthropic-billing-header') {
      // Rewrite billing header
      out[key] = v
        .replace(/cc_version=[\d.]+\.[a-f0-9]{3}/g, `cc_version=${getCanonicalVersion(config)}.000`)
        .replace(/\s*cch=00000;/g, '')
    } else {
      out[key] = v
    }
  }

  return out
}

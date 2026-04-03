import { existsSync, readFileSync } from 'fs'
import { parse } from 'yaml'
import { dirname, resolve } from 'path'

export type TokenEntry = {
  name: string
  token: string
}

export type Config = {
  server: {
    port: number
    tls: {
      cert: string
      key: string
    }
  }
  upstream: {
    url: string
  }
  network?: {
    proxy_url?: string
  }
  fingerprint_profile?: string
  capacity_profile?: {
    id?: string
    admission_mode?: 'observe-only'
    max_active_sessions_hint?: number
    rolling_window_budget_hint?: number
    weekly_budget_hint?: number
    peak_hour_multiplier?: number
    drain_threshold?: number
  }
  auth: {
    tokens: TokenEntry[]
  }
  oauth: {
    access_token?: string
    refresh_token: string
    expires_at?: number
  }
  client?: {
    user_agent?: string
    entrypoint?: string
    client_type?: string
    required_betas?: string[]
  }
  identity: {
    device_id: string
    email: string
  }
  env: Record<string, unknown>
  // System prompt environment masking - must be consistent with env above
  prompt_env: {
    platform: string        // "darwin" — must match env.platform
    shell: string           // "zsh"
    os_version: string      // "Darwin 24.4.0" — uname -sr output
    working_dir: string     // "/Users/jack/projects" — canonical home path prefix
  }
  process: {
    constrained_memory: number
    rss_range: [number, number]
    heap_total_range: [number, number]
    heap_used_range: [number, number]
    external_range?: [number, number]
    array_buffers_range?: [number, number]
    cpu_percent_range?: [number, number]
  }
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    audit: boolean
    file?: string
    audit_file?: string
  }
}

type FingerprintProfile = {
  client?: Config['client']
  env?: Config['env']
  prompt_env?: Config['prompt_env']
  process?: Config['process']
}

type RawConfig = Omit<Config, 'client' | 'env' | 'prompt_env' | 'process'> & {
  client?: Config['client']
  env?: Config['env']
  prompt_env?: Config['prompt_env']
  process?: Config['process']
}

const ENV_PLACEHOLDER_RE = /\$\{([A-Z0-9_]+)(?::-(.*?))?\}/g

function stripInlineComment(value: string): string {
  let inSingle = false
  let inDouble = false

  for (let idx = 0; idx < value.length; idx++) {
    const current = value[idx]
    const prev = idx > 0 ? value[idx - 1] : ''

    if (current === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (current === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble
      continue
    }
    if (current === '#' && !inSingle && !inDouble) {
      const before = idx === 0 ? '' : value[idx - 1]
      if (before === '' || /\s/.test(before)) {
        return value.slice(0, idx).trimEnd()
      }
    }
  }

  return value.trim()
}

function decodeEnvValue(rawValue: string): string {
  const value = stripInlineComment(rawValue.trim())
  if (value.length === 0) return ''

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const quote = value[0]
    const inner = value.slice(1, -1)
    if (quote === "'") return inner
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }

  return value
}

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return

  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const equalsIndex = normalized.indexOf('=')
    if (equalsIndex <= 0) continue

    const key = normalized.slice(0, equalsIndex).trim()
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue
    if (process.env[key] !== undefined) continue

    const rawValue = normalized.slice(equalsIndex + 1)
    process.env[key] = decodeEnvValue(rawValue)
  }
}

function interpolateEnv(raw: string): string {
  return raw.replace(ENV_PLACEHOLDER_RE, (_, name: string, fallback?: string) => {
    const value = process.env[name]
    if (value !== undefined && value !== '') return value
    if (fallback !== undefined) return fallback
    throw new Error(`config: missing env var ${name}`)
  })
}

function normalizeOptionalStrings(config: Config): void {
  if (config.network && (config.network.proxy_url == null || config.network.proxy_url === '')) {
    delete config.network.proxy_url
  }
  if (config.oauth.access_token == null || config.oauth.access_token === '') {
    delete config.oauth.access_token
  }
  if (config.oauth.expires_at == null || Number.isNaN(Number(config.oauth.expires_at))) {
    delete config.oauth.expires_at
  } else if (typeof config.oauth.expires_at !== 'number') {
    config.oauth.expires_at = Number(config.oauth.expires_at)
  }
  if (config.logging.file == null || config.logging.file === '') {
    delete config.logging.file
  }
  if (config.logging.audit_file == null || config.logging.audit_file === '') {
    delete config.logging.audit_file
  }
  if (config.capacity_profile?.max_active_sessions_hint != null) {
    config.capacity_profile.max_active_sessions_hint = Number(config.capacity_profile.max_active_sessions_hint)
  }
  if (config.capacity_profile?.rolling_window_budget_hint != null) {
    config.capacity_profile.rolling_window_budget_hint = Number(config.capacity_profile.rolling_window_budget_hint)
  }
  if (config.capacity_profile?.weekly_budget_hint != null) {
    config.capacity_profile.weekly_budget_hint = Number(config.capacity_profile.weekly_budget_hint)
  }
  if (config.capacity_profile?.peak_hour_multiplier != null) {
    config.capacity_profile.peak_hour_multiplier = Number(config.capacity_profile.peak_hour_multiplier)
  }
  if (config.capacity_profile?.drain_threshold != null) {
    config.capacity_profile.drain_threshold = Number(config.capacity_profile.drain_threshold)
  }
}

function loadYamlWithEnv<T>(path: string): T {
  const raw = readFileSync(path, 'utf-8')
  return parse(interpolateEnv(raw)) as T
}

function resolveFingerprintProfilePath(configPath: string, profileRef: string): string {
  const configDir = dirname(configPath)
  const directHint = profileRef.includes('/') || profileRef.includes('\\') || profileRef.endsWith('.yaml') || profileRef.endsWith('.yml')
  const candidates = directHint
    ? [resolve(configDir, profileRef)]
    : [
        resolve(configDir, 'profiles', 'fingerprints', `${profileRef}.yaml`),
        resolve(configDir, 'profiles', 'fingerprints', `${profileRef}.yml`),
        resolve(configDir, profileRef),
      ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  throw new Error(`config: fingerprint_profile not found for ${profileRef}`)
}

function loadFingerprintProfile(configPath: string, profileRef?: string): FingerprintProfile | undefined {
  if (!profileRef) return undefined

  const profilePath = resolveFingerprintProfilePath(configPath, profileRef)
  return loadYamlWithEnv<FingerprintProfile>(profilePath)
}

function mergeFingerprintProfile(rawConfig: RawConfig, profile?: FingerprintProfile): Config {
  return {
    ...rawConfig,
    client: {
      ...(profile?.client ?? {}),
      ...(rawConfig.client ?? {}),
    },
    env: {
      ...(profile?.env ?? {}),
      ...(rawConfig.env ?? {}),
    },
    prompt_env: {
      ...(profile?.prompt_env ?? {}),
      ...(rawConfig.prompt_env ?? {}),
    },
    process: {
      ...(profile?.process ?? {}),
      ...(rawConfig.process ?? {}),
    },
  } as Config
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || resolve(process.cwd(), 'config.yaml')
  const envPath = resolve(dirname(filePath), '.env')

  loadDotEnv(envPath)

  const rawConfig = loadYamlWithEnv<RawConfig>(filePath)
  const fingerprintProfile = loadFingerprintProfile(filePath, rawConfig.fingerprint_profile)
  const config = mergeFingerprintProfile(rawConfig, fingerprintProfile)
  normalizeOptionalStrings(config)

  if (!config.identity?.device_id || config.identity.device_id.includes('0000000000')) {
    throw new Error('config: identity.device_id must be set to a real 64-char hex value. Run: npm run generate-identity')
  }
  if (!config.auth?.tokens?.length) {
    throw new Error('config: auth.tokens must have at least one entry')
  }
  if (!config.oauth?.refresh_token) {
    throw new Error('config: oauth.refresh_token is required. Do a browser OAuth login on the admin machine, then copy the refresh token from ~/.claude/.credentials.json')
  }
  if (!config.env || Object.keys(config.env).length === 0) {
    throw new Error('config: env must be supplied inline or via fingerprint_profile')
  }
  if (!config.prompt_env?.platform || !config.prompt_env?.shell || !config.prompt_env?.os_version || !config.prompt_env?.working_dir) {
    throw new Error('config: prompt_env must be supplied inline or via fingerprint_profile')
  }
  if (!config.process?.constrained_memory || !config.process?.rss_range || !config.process?.heap_total_range || !config.process?.heap_used_range) {
    throw new Error('config: process must be supplied inline or via fingerprint_profile')
  }
  if (config.capacity_profile?.max_active_sessions_hint != null && config.capacity_profile.max_active_sessions_hint <= 0) {
    throw new Error('config: capacity_profile.max_active_sessions_hint must be greater than zero')
  }
  if (config.capacity_profile?.drain_threshold != null) {
    if (config.capacity_profile.drain_threshold <= 0 || config.capacity_profile.drain_threshold > 1) {
      throw new Error('config: capacity_profile.drain_threshold must be within (0, 1]')
    }
  }

  return config
}

import { createHash, randomUUID } from 'crypto'
import type { IncomingHttpHeaders } from 'http'
import type { Config } from './config.js'
import { log } from './logger.js'

export type BusyState = 'IDLE' | 'BUSY'
export type DrainState = 'ACCEPTING' | 'DRAINING' | 'DRAINED'
export type AdmissionMode = 'observe-only'
export type QuotaState = 'UNKNOWN' | 'NORMAL' | 'LIMITED' | 'EXHAUSTED'

export type CapacityProfile = {
  id: string
  admission_mode: AdmissionMode
  max_active_sessions_hint: number
  rolling_window_budget_hint?: number
  weekly_budget_hint?: number
  peak_hour_multiplier?: number
  drain_threshold: number
}

export type RuntimeAccount = {
  id: string
  email: string
  device_id: string
  fingerprint_profile_id: string
  proxy_url?: string
  busy_state: BusyState
  drain_state: DrainState
  quota_state: QuotaState
  capacity_profile: CapacityProfile
  budget_state: {
    rolling_window_utilization?: number
    rolling_window_resets_at?: string
    threshold_surpassed?: boolean
    retry_after_seconds?: number
    observed_at?: string
    raw_header_count: number
  }
}

export type RoutingDecision = {
  lease_id: string
  account_id: string
  fingerprint_profile_id: string
  capacity_profile_id: string
  proxy_url?: string
  affinity_key?: string
  affinity_source: 'request-header' | 'request-body' | 'none'
  queue_wait_ms: number
  selected_at: string
}

export type SchedulerSnapshot = {
  account_id: string
  fingerprint_profile_id: string
  capacity_profile_id: string
  busy_state: BusyState
  drain_state: DrainState
  active_sessions: number
  sticky_affinities: number
  admission_mode: AdmissionMode
  max_active_sessions_hint: number
  quota_state: QuotaState
  rolling_window_utilization?: number
  rolling_window_resets_at?: string
  threshold_surpassed?: boolean
  retry_after_seconds?: number
  budget_observed_at?: string
  rolling_window_budget_hint?: number
  weekly_budget_hint?: number
  peak_hour_multiplier?: number
  drain_threshold: number
  raw_budget_header_count: number
  proxy_bound: boolean
}

type SchedulingContext = {
  client_name: string
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: Buffer
}

type ActiveLease = {
  affinity_key?: string
}

export type RequestLease = {
  decision: RoutingDecision
  complete: (status: number, headers?: IncomingHttpHeaders) => void
  fail: (status: number, error?: Error) => void
}

export class SingleAccountScheduler {
  private readonly account: RuntimeAccount
  private readonly leases = new Map<string, ActiveLease>()
  private readonly stickyAffinities = new Map<string, string>()

  constructor(config: Config) {
    this.account = buildRuntimeAccount(config)
  }

  beginRequest(context: SchedulingContext): RequestLease {
    const leaseId = randomUUID()
    const affinity = extractAffinityKey(context.headers, context.body)
    const decision: RoutingDecision = {
      lease_id: leaseId,
      account_id: this.account.id,
      fingerprint_profile_id: this.account.fingerprint_profile_id,
      capacity_profile_id: this.account.capacity_profile.id,
      proxy_url: this.account.proxy_url,
      affinity_key: affinity.key,
      affinity_source: affinity.source,
      queue_wait_ms: 0,
      selected_at: new Date().toISOString(),
    }

    if (affinity.key) {
      this.stickyAffinities.set(affinity.key, this.account.id)
    }

    this.leases.set(leaseId, {
      affinity_key: affinity.key,
    })
    this.refreshBusyState()

    log('debug', 'Scheduler resolved request', {
      client: context.client_name,
      method: context.method,
      path: context.path,
      account_id: decision.account_id,
      fingerprint_profile_id: decision.fingerprint_profile_id,
      capacity_profile_id: decision.capacity_profile_id,
      affinity_source: decision.affinity_source,
      has_affinity_key: Boolean(decision.affinity_key),
      active_sessions: this.leases.size,
    })

    return {
      decision,
      complete: (status, headers) => this.finishLease(leaseId, status, headers),
      fail: (status, error) => this.finishLease(leaseId, status, undefined, error),
    }
  }

  snapshot(): SchedulerSnapshot {
    return {
      account_id: this.account.id,
      fingerprint_profile_id: this.account.fingerprint_profile_id,
      capacity_profile_id: this.account.capacity_profile.id,
      busy_state: this.account.busy_state,
      drain_state: this.account.drain_state,
      active_sessions: this.leases.size,
      sticky_affinities: this.stickyAffinities.size,
      admission_mode: this.account.capacity_profile.admission_mode,
      max_active_sessions_hint: this.account.capacity_profile.max_active_sessions_hint,
      quota_state: this.account.quota_state,
      rolling_window_utilization: this.account.budget_state.rolling_window_utilization,
      rolling_window_resets_at: this.account.budget_state.rolling_window_resets_at,
      threshold_surpassed: this.account.budget_state.threshold_surpassed,
      retry_after_seconds: this.account.budget_state.retry_after_seconds,
      budget_observed_at: this.account.budget_state.observed_at,
      rolling_window_budget_hint: this.account.capacity_profile.rolling_window_budget_hint,
      weekly_budget_hint: this.account.capacity_profile.weekly_budget_hint,
      peak_hour_multiplier: this.account.capacity_profile.peak_hour_multiplier,
      drain_threshold: this.account.capacity_profile.drain_threshold,
      raw_budget_header_count: this.account.budget_state.raw_header_count,
      proxy_bound: Boolean(this.account.proxy_url),
    }
  }

  private finishLease(
    leaseId: string,
    status: number,
    headers?: IncomingHttpHeaders,
    error?: Error,
  ) {
    this.observeResponseHeaders(headers)
    this.leases.delete(leaseId)
    this.refreshBusyState()

    log('debug', 'Scheduler completed request', {
      lease_id: leaseId,
      account_id: this.account.id,
      status,
      active_sessions: this.leases.size,
      error: error?.message,
    })
  }

  private refreshBusyState() {
    this.account.busy_state = this.leases.size > 0 ? 'BUSY' : 'IDLE'
  }

  private observeResponseHeaders(headers?: IncomingHttpHeaders) {
    if (!headers) return

    const budgetSignal = parseBudgetSignal(headers)
    if (!budgetSignal.present) return

    this.account.budget_state = {
      rolling_window_utilization: budgetSignal.rolling_window_utilization,
      rolling_window_resets_at: budgetSignal.rolling_window_resets_at,
      threshold_surpassed: budgetSignal.threshold_surpassed,
      retry_after_seconds: budgetSignal.retry_after_seconds,
      observed_at: new Date().toISOString(),
      raw_header_count: budgetSignal.raw_header_count,
    }

    if (budgetSignal.threshold_surpassed || (budgetSignal.rolling_window_utilization ?? 0) >= 1) {
      this.account.quota_state = 'EXHAUSTED'
      this.account.drain_state = 'DRAINED'
    } else if (
      budgetSignal.retry_after_seconds != null ||
      (budgetSignal.rolling_window_utilization != null &&
        budgetSignal.rolling_window_utilization >= this.account.capacity_profile.drain_threshold)
    ) {
      this.account.quota_state = 'LIMITED'
      this.account.drain_state = 'DRAINING'
    } else if (budgetSignal.rolling_window_utilization != null) {
      this.account.quota_state = 'NORMAL'
      this.account.drain_state = 'ACCEPTING'
    } else {
      this.account.quota_state = 'UNKNOWN'
    }

    log('debug', 'Scheduler observed upstream budget state', {
      account_id: this.account.id,
      quota_state: this.account.quota_state,
      drain_state: this.account.drain_state,
      rolling_window_utilization: this.account.budget_state.rolling_window_utilization,
      retry_after_seconds: this.account.budget_state.retry_after_seconds,
      raw_header_count: this.account.budget_state.raw_header_count,
    })
  }
}

export function createScheduler(config: Config) {
  return new SingleAccountScheduler(config)
}

function buildRuntimeAccount(config: Config): RuntimeAccount {
  const normalizedEmail = config.identity.email.trim().toLowerCase()
  const accountId = `acct-${createHash('sha1').update(normalizedEmail).digest('hex').slice(0, 12)}`
  const fingerprintProfileId = config.fingerprint_profile || 'inline-profile'
  const capacityProfileId = `cap-${fingerprintProfileId}`

  return {
    id: accountId,
    email: config.identity.email,
    device_id: config.identity.device_id,
    fingerprint_profile_id: fingerprintProfileId,
    proxy_url: config.network?.proxy_url,
    busy_state: 'IDLE',
    drain_state: 'ACCEPTING',
    quota_state: 'UNKNOWN',
    capacity_profile: buildCapacityProfile(config, capacityProfileId),
    budget_state: {
      raw_header_count: 0,
    },
  }
}

function buildCapacityProfile(config: Config, fallbackId: string): CapacityProfile {
  return {
    id: config.capacity_profile?.id || fallbackId,
    admission_mode: config.capacity_profile?.admission_mode || 'observe-only',
    max_active_sessions_hint: config.capacity_profile?.max_active_sessions_hint || 1,
    rolling_window_budget_hint: config.capacity_profile?.rolling_window_budget_hint,
    weekly_budget_hint: config.capacity_profile?.weekly_budget_hint,
    peak_hour_multiplier: config.capacity_profile?.peak_hour_multiplier,
    drain_threshold: config.capacity_profile?.drain_threshold ?? 0.9,
  }
}

function extractAffinityKey(
  headers: IncomingHttpHeaders,
  body: Buffer,
): { key?: string; source: RoutingDecision['affinity_source'] } {
  const headerCandidates = [
    headers['x-session-affinity-key'],
    headers['x-claude-session-id'],
    headers['x-conversation-id'],
  ]

  for (const candidate of headerCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return { key: candidate.trim(), source: 'request-header' }
    }
  }

  if (body.length === 0) {
    return { source: 'none' }
  }

  try {
    const payload = JSON.parse(body.toString('utf-8')) as {
      metadata?: {
        user_id?: string
      }
      conversation_id?: string
      session_id?: string
    }

    if (typeof payload.conversation_id === 'string' && payload.conversation_id.trim()) {
      return { key: payload.conversation_id.trim(), source: 'request-body' }
    }
    if (typeof payload.session_id === 'string' && payload.session_id.trim()) {
      return { key: payload.session_id.trim(), source: 'request-body' }
    }
    if (typeof payload.metadata?.user_id === 'string') {
      const userId = JSON.parse(payload.metadata.user_id) as {
        session_id?: string
      }
      if (typeof userId.session_id === 'string' && userId.session_id.trim()) {
        return { key: userId.session_id.trim(), source: 'request-body' }
      }
    }
  } catch {
    return { source: 'none' }
  }

  return { source: 'none' }
}

function parseBudgetSignal(headers: IncomingHttpHeaders): {
  present: boolean
  raw_header_count: number
  rolling_window_utilization?: number
  rolling_window_resets_at?: string
  threshold_surpassed?: boolean
  retry_after_seconds?: number
} {
  const normalizedHeaders = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), firstHeaderValue(value)] as const)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)

  const unifiedHeaders = normalizedHeaders.filter(([key]) => key.startsWith('anthropic-ratelimit-unified-'))
  const utilizationCandidates = unifiedHeaders
    .filter(([key]) => key.endsWith('-utilization') || key === 'anthropic-ratelimit-unified-utilization')
    .map(([, value]) => parseMaybeNumber(value))
    .filter((value): value is number => value != null)

  const resetHeader = unifiedHeaders.find(([key]) => key.endsWith('-reset') || key === 'anthropic-ratelimit-unified-reset')?.[1]
  const thresholdHeader = unifiedHeaders.find(([key]) => key.endsWith('surpassed-threshold'))?.[1]
  const retryAfter = normalizedHeaders.find(([key]) => key === 'retry-after')?.[1]
  const rollingWindowUtilization = utilizationCandidates.length > 0
    ? Math.max(...utilizationCandidates)
    : undefined

  return {
    present: unifiedHeaders.length > 0 || retryAfter != null,
    raw_header_count: unifiedHeaders.length,
    rolling_window_utilization: rollingWindowUtilization,
    rolling_window_resets_at: resetHeader,
    threshold_surpassed: parseMaybeBoolean(thresholdHeader),
    retry_after_seconds: parseMaybeNumber(retryAfter),
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length > 0) return value[0]
  return undefined
}

function parseMaybeNumber(value?: string): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseMaybeBoolean(value?: string): boolean | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return undefined
}

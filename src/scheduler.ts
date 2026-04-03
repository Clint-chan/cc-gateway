import { createHash, randomUUID } from 'crypto'
import type { IncomingHttpHeaders } from 'http'
import type { Config } from './config.js'
import { log } from './logger.js'

export type BusyState = 'IDLE' | 'BUSY'
export type DrainState = 'ACCEPTING' | 'DRAINING' | 'DRAINED'
export type AdmissionMode = 'observe-only'
export type QuotaState = 'UNKNOWN' | 'NORMAL' | 'LIMITED' | 'EXHAUSTED'
export type UsagePressureState = 'UNKNOWN' | 'NORMAL' | 'LIMITED' | 'EXHAUSTED'
export type AdmissionAdvice = 'OPEN' | 'QUEUE_PREFERRED' | 'BLOCK_NEW'
export type SchedulerReasonCode =
  | 'active_leases_present'
  | 'capacity_hint_reached'
  | 'live_retry_after'
  | 'live_threshold_surpassed'
  | 'live_utilization_above_drain_threshold'
  | 'usage_five_hour_above_hint'
  | 'usage_weekly_above_hint'
  | 'usage_window_exhausted'

export type UsageLimitSnapshot = {
  utilization: number
  resets_at?: string
}

export type ExtraUsageSnapshot = {
  is_enabled: boolean
  monthly_limit?: number
  used_credits?: number
  utilization?: number
}

export type UsageSnapshot = {
  observed_at: string
  pressure_state: UsagePressureState
  five_hour?: UsageLimitSnapshot
  seven_day?: UsageLimitSnapshot
  seven_day_sonnet?: UsageLimitSnapshot
  seven_day_opus?: UsageLimitSnapshot
  extra_usage?: ExtraUsageSnapshot
}

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
    usage?: UsageSnapshot
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
  busy_reason_codes: SchedulerReasonCode[]
  drain_state: DrainState
  drain_reason_codes: SchedulerReasonCode[]
  admission_advice: AdmissionAdvice
  admission_reason_codes: SchedulerReasonCode[]
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
  usage_pressure_state?: UsagePressureState
  usage_observed_at?: string
  usage_snapshot?: Omit<UsageSnapshot, 'observed_at' | 'pressure_state'>
  proxy_bound: boolean
}

export type AdmissionPreview = {
  advice: AdmissionAdvice
  reason_codes: SchedulerReasonCode[]
  projected_active_sessions: number
  busy_state: BusyState
  drain_state: DrainState
  quota_state: QuotaState
  usage_pressure_state?: UsagePressureState
  retry_after_seconds?: number
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
  path: string
}

export type RequestLease = {
  decision: RoutingDecision
  complete: (status: number, headers?: IncomingHttpHeaders, responseBody?: Buffer) => void
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
      path: context.path,
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
      complete: (status, headers, responseBody) => this.finishLease(leaseId, status, headers, responseBody),
      fail: (status, error) => this.finishLease(leaseId, status, undefined, undefined, error),
    }
  }

  snapshot(): SchedulerSnapshot {
    const busyReasonCodes = deriveBusyReasonCodes(this.leases.size, this.account.capacity_profile)
    const liveBudgetReasonCodes = deriveLiveBudgetReasonCodes(this.account)
    const usageReasonCodes = deriveUsageReasonCodes(this.account)
    const drainReasonCodes = deriveDrainReasonCodes(this.account, liveBudgetReasonCodes)
    const admissionAdvice = deriveAdmissionAdvice(this.account, this.leases.size)
    const admissionReasonCodes = deriveAdmissionReasonCodes(
      admissionAdvice,
      busyReasonCodes,
      liveBudgetReasonCodes,
      usageReasonCodes,
    )

    return {
      account_id: this.account.id,
      fingerprint_profile_id: this.account.fingerprint_profile_id,
      capacity_profile_id: this.account.capacity_profile.id,
      busy_state: this.account.busy_state,
      busy_reason_codes: busyReasonCodes,
      drain_state: this.account.drain_state,
      drain_reason_codes: drainReasonCodes,
      admission_advice: admissionAdvice,
      admission_reason_codes: admissionReasonCodes,
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
      usage_pressure_state: this.account.budget_state.usage?.pressure_state,
      usage_observed_at: this.account.budget_state.usage?.observed_at,
      usage_snapshot: this.account.budget_state.usage
        ? {
            five_hour: this.account.budget_state.usage.five_hour,
            seven_day: this.account.budget_state.usage.seven_day,
            seven_day_sonnet: this.account.budget_state.usage.seven_day_sonnet,
            seven_day_opus: this.account.budget_state.usage.seven_day_opus,
            extra_usage: this.account.budget_state.usage.extra_usage,
          }
        : undefined,
      proxy_bound: Boolean(this.account.proxy_url),
    }
  }

  previewIncomingAdmission(): AdmissionPreview {
    const projectedActiveSessions = this.leases.size + 1
    const busyReasonCodes = deriveIncomingBusyReasonCodes(
      this.leases.size,
      projectedActiveSessions,
      this.account.capacity_profile,
    )
    const liveBudgetReasonCodes = deriveLiveBudgetReasonCodes(this.account)
    const usageReasonCodes = deriveUsageReasonCodes(this.account)
    const advice = deriveProjectedAdmissionAdvice(
      this.account,
      projectedActiveSessions,
      busyReasonCodes,
    )

    return {
      advice,
      reason_codes: deriveAdmissionReasonCodes(
        advice,
        busyReasonCodes,
        liveBudgetReasonCodes,
        usageReasonCodes,
      ),
      projected_active_sessions: projectedActiveSessions,
      busy_state: projectedActiveSessions > 0 ? 'BUSY' : 'IDLE',
      drain_state: this.account.drain_state,
      quota_state: this.account.quota_state,
      usage_pressure_state: this.account.budget_state.usage?.pressure_state,
      retry_after_seconds: this.account.budget_state.retry_after_seconds,
    }
  }

  private finishLease(
    leaseId: string,
    status: number,
    headers?: IncomingHttpHeaders,
    responseBody?: Buffer,
    error?: Error,
  ) {
    const lease = this.leases.get(leaseId)
    this.observeResponse(lease?.path, headers, responseBody)
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

  private observeResponse(path?: string, headers?: IncomingHttpHeaders, responseBody?: Buffer) {
    this.observeResponseHeaders(headers)
    this.observeUsageResponse(path, responseBody)
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

  private observeUsageResponse(path?: string, responseBody?: Buffer) {
    if (!path?.startsWith('/api/oauth/usage') || !responseBody || responseBody.length === 0) {
      return
    }

    const usageSnapshot = parseUsageSnapshot(responseBody, this.account.capacity_profile)
    if (!usageSnapshot) return

    this.account.budget_state.usage = usageSnapshot

    log('debug', 'Scheduler observed usage snapshot', {
      account_id: this.account.id,
      usage_pressure_state: usageSnapshot.pressure_state,
      five_hour_utilization: usageSnapshot.five_hour?.utilization,
      seven_day_utilization: usageSnapshot.seven_day?.utilization,
      seven_day_sonnet_utilization: usageSnapshot.seven_day_sonnet?.utilization,
      seven_day_opus_utilization: usageSnapshot.seven_day_opus?.utilization,
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

function parseUsageSnapshot(
  responseBody: Buffer,
  capacityProfile: CapacityProfile,
): UsageSnapshot | undefined {
  try {
    const payload = JSON.parse(responseBody.toString('utf-8')) as {
      five_hour?: { utilization?: number | null; resets_at?: string | null } | null
      seven_day?: { utilization?: number | null; resets_at?: string | null } | null
      seven_day_sonnet?: { utilization?: number | null; resets_at?: string | null } | null
      seven_day_opus?: { utilization?: number | null; resets_at?: string | null } | null
      extra_usage?: {
        is_enabled?: boolean
        monthly_limit?: number | null
        used_credits?: number | null
        utilization?: number | null
      } | null
    }

    const usage = {
      five_hour: normalizeUsageLimit(payload.five_hour),
      seven_day: normalizeUsageLimit(payload.seven_day),
      seven_day_sonnet: normalizeUsageLimit(payload.seven_day_sonnet),
      seven_day_opus: normalizeUsageLimit(payload.seven_day_opus),
      extra_usage: normalizeExtraUsage(payload.extra_usage),
    }

    const pressureState = deriveUsagePressureState(usage, capacityProfile)
    if (
      !usage.five_hour &&
      !usage.seven_day &&
      !usage.seven_day_sonnet &&
      !usage.seven_day_opus &&
      !usage.extra_usage
    ) {
      return undefined
    }

    return {
      observed_at: new Date().toISOString(),
      pressure_state: pressureState,
      ...usage,
    }
  } catch {
    return undefined
  }
}

function normalizeUsageLimit(
  limit?: { utilization?: number | null; resets_at?: string | null } | null,
): UsageLimitSnapshot | undefined {
  if (!limit || limit.utilization == null) return undefined

  const utilization = normalizeUtilizationPercent(limit.utilization)
  if (utilization == null) return undefined

  return {
    utilization,
    resets_at: limit.resets_at || undefined,
  }
}

function normalizeExtraUsage(
  extra?: {
    is_enabled?: boolean
    monthly_limit?: number | null
    used_credits?: number | null
    utilization?: number | null
  } | null,
): ExtraUsageSnapshot | undefined {
  if (!extra) return undefined

  return {
    is_enabled: Boolean(extra.is_enabled),
    monthly_limit: parseMaybeNumber(extra.monthly_limit),
    used_credits: parseMaybeNumber(extra.used_credits),
    utilization: normalizeUtilizationPercent(extra.utilization),
  }
}

function deriveUsagePressureState(
  usage: {
    five_hour?: UsageLimitSnapshot
    seven_day?: UsageLimitSnapshot
    seven_day_sonnet?: UsageLimitSnapshot
    seven_day_opus?: UsageLimitSnapshot
  },
  capacityProfile: CapacityProfile,
): UsagePressureState {
  const rollingWindow = usage.five_hour?.utilization
  const weeklyWindow = [
    usage.seven_day?.utilization,
    usage.seven_day_sonnet?.utilization,
    usage.seven_day_opus?.utilization,
  ].filter((value): value is number => value != null)

  const maxWeekly = weeklyWindow.length > 0 ? Math.max(...weeklyWindow) : undefined
  const candidates = [rollingWindow, maxWeekly].filter((value): value is number => value != null)

  if (candidates.length === 0) {
    return 'UNKNOWN'
  }
  if (candidates.some(value => value >= 1)) {
    return 'EXHAUSTED'
  }
  if (
    (rollingWindow != null &&
      capacityProfile.rolling_window_budget_hint != null &&
      rollingWindow >= capacityProfile.rolling_window_budget_hint) ||
    (maxWeekly != null &&
      capacityProfile.weekly_budget_hint != null &&
      maxWeekly >= capacityProfile.weekly_budget_hint)
  ) {
    return 'LIMITED'
  }
  return 'NORMAL'
}

function deriveBusyReasonCodes(
  activeSessions: number,
  capacityProfile: CapacityProfile,
): SchedulerReasonCode[] {
  const reasonCodes: SchedulerReasonCode[] = []

  if (activeSessions > 0) {
    reasonCodes.push('active_leases_present')
  }
  if (activeSessions >= capacityProfile.max_active_sessions_hint) {
    reasonCodes.push('capacity_hint_reached')
  }

  return reasonCodes
}

function deriveIncomingBusyReasonCodes(
  currentActiveSessions: number,
  projectedActiveSessions: number,
  capacityProfile: CapacityProfile,
): SchedulerReasonCode[] {
  const reasonCodes: SchedulerReasonCode[] = []

  if (currentActiveSessions > 0) {
    reasonCodes.push('active_leases_present')
  }
  if (projectedActiveSessions > capacityProfile.max_active_sessions_hint) {
    reasonCodes.push('capacity_hint_reached')
  }

  return reasonCodes
}

function deriveLiveBudgetReasonCodes(account: RuntimeAccount): SchedulerReasonCode[] {
  const reasonCodes: SchedulerReasonCode[] = []

  if (account.budget_state.threshold_surpassed) {
    reasonCodes.push('live_threshold_surpassed')
  }
  if (account.budget_state.retry_after_seconds != null) {
    reasonCodes.push('live_retry_after')
  }
  if (
    account.budget_state.rolling_window_utilization != null &&
    account.budget_state.rolling_window_utilization >= account.capacity_profile.drain_threshold
  ) {
    reasonCodes.push('live_utilization_above_drain_threshold')
  }

  return reasonCodes
}

function deriveUsageReasonCodes(account: RuntimeAccount): SchedulerReasonCode[] {
  const usage = account.budget_state.usage
  if (!usage) return []

  const reasonCodes: SchedulerReasonCode[] = []
  if (usage.pressure_state === 'EXHAUSTED') {
    reasonCodes.push('usage_window_exhausted')
  }
  if (
    usage.five_hour?.utilization != null &&
    account.capacity_profile.rolling_window_budget_hint != null &&
    usage.five_hour.utilization >= account.capacity_profile.rolling_window_budget_hint
  ) {
    reasonCodes.push('usage_five_hour_above_hint')
  }

  const weeklyHint = account.capacity_profile.weekly_budget_hint
  const weeklyCandidates = [
    usage.seven_day?.utilization,
    usage.seven_day_sonnet?.utilization,
    usage.seven_day_opus?.utilization,
  ].filter((value): value is number => value != null)
  if (
    weeklyHint != null &&
    weeklyCandidates.length > 0 &&
    Math.max(...weeklyCandidates) >= weeklyHint
  ) {
    reasonCodes.push('usage_weekly_above_hint')
  }

  return reasonCodes
}

function deriveDrainReasonCodes(
  account: RuntimeAccount,
  liveBudgetReasonCodes: SchedulerReasonCode[],
): SchedulerReasonCode[] {
  if (account.drain_state === 'ACCEPTING') {
    return []
  }
  return liveBudgetReasonCodes
}

function deriveAdmissionAdvice(
  account: RuntimeAccount,
  activeSessions: number,
): AdmissionAdvice {
  if (account.quota_state === 'EXHAUSTED' || account.budget_state.usage?.pressure_state === 'EXHAUSTED') {
    return 'BLOCK_NEW'
  }
  if (account.budget_state.retry_after_seconds != null) {
    return 'BLOCK_NEW'
  }
  if (
    account.quota_state === 'LIMITED' ||
    account.drain_state === 'DRAINING' ||
    account.budget_state.usage?.pressure_state === 'LIMITED' ||
    activeSessions >= account.capacity_profile.max_active_sessions_hint
  ) {
    return 'QUEUE_PREFERRED'
  }
  return 'OPEN'
}

function deriveProjectedAdmissionAdvice(
  account: RuntimeAccount,
  projectedActiveSessions: number,
  busyReasonCodes: SchedulerReasonCode[],
): AdmissionAdvice {
  if (account.quota_state === 'EXHAUSTED' || account.budget_state.usage?.pressure_state === 'EXHAUSTED') {
    return 'BLOCK_NEW'
  }
  if (account.budget_state.retry_after_seconds != null) {
    return 'BLOCK_NEW'
  }
  if (
    account.quota_state === 'LIMITED' ||
    account.drain_state === 'DRAINING' ||
    account.drain_state === 'DRAINED' ||
    account.budget_state.usage?.pressure_state === 'LIMITED' ||
    busyReasonCodes.includes('capacity_hint_reached') ||
    projectedActiveSessions > account.capacity_profile.max_active_sessions_hint
  ) {
    return 'QUEUE_PREFERRED'
  }
  return 'OPEN'
}

function deriveAdmissionReasonCodes(
  advice: AdmissionAdvice,
  busyReasonCodes: SchedulerReasonCode[],
  liveBudgetReasonCodes: SchedulerReasonCode[],
  usageReasonCodes: SchedulerReasonCode[],
): SchedulerReasonCode[] {
  if (advice === 'OPEN') {
    return []
  }

  const ordered = [...busyReasonCodes, ...liveBudgetReasonCodes, ...usageReasonCodes]
  return Array.from(new Set(ordered))
}

function normalizeUtilizationPercent(value?: number | null): number | undefined {
  const parsed = parseMaybeNumber(value)
  if (parsed == null) return undefined
  if (parsed < 0) return 0
  if (parsed <= 1) return parsed
  return Math.min(parsed / 100, 1)
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length > 0) return value[0]
  return undefined
}

function parseMaybeNumber(value?: string | number | null): number | undefined {
  if (value == null || value === '') return undefined
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

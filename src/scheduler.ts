import { createHash, randomUUID } from 'crypto'
import type { IncomingHttpHeaders } from 'http'
import type { Config } from './config.js'
import { log } from './logger.js'

export type BusyState = 'IDLE' | 'BUSY'
export type DrainState = 'ACCEPTING' | 'DRAINING' | 'DRAINED'
export type AdmissionMode = 'observe-only'

export type CapacityProfile = {
  id: string
  admission_mode: AdmissionMode
  max_active_sessions_hint: number
}

export type RuntimeAccount = {
  id: string
  email: string
  device_id: string
  fingerprint_profile_id: string
  proxy_url?: string
  busy_state: BusyState
  drain_state: DrainState
  capacity_profile: CapacityProfile
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
  complete: (status: number) => void
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
      complete: (status) => this.finishLease(leaseId, status),
      fail: (status, error) => this.finishLease(leaseId, status, error),
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
      proxy_bound: Boolean(this.account.proxy_url),
    }
  }

  private finishLease(leaseId: string, status: number, error?: Error) {
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
    capacity_profile: {
      id: capacityProfileId,
      admission_mode: 'observe-only',
      max_active_sessions_hint: 1,
    },
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

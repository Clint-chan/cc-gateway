import { strict as assert } from 'assert'
import type { Config } from '../../src/config.js'
import { createScheduler } from '../../src/scheduler.js'

const config: Config = {
  server: { port: 8443, tls: { cert: '', key: '' } },
  upstream: { url: 'https://api.anthropic.com' },
  network: { proxy_url: 'http://192.168.40.184:10808' },
  fingerprint_profile: 'example-darwin-arm64',
  capacity_profile: {
    id: 'starter-max5x',
    admission_mode: 'observe-only',
    max_active_sessions_hint: 2,
    rolling_window_budget_hint: 0.85,
    weekly_budget_hint: 0.8,
    peak_hour_multiplier: 1.25,
    drain_threshold: 0.9,
  },
  auth: { tokens: [{ name: 'test', token: 'test-token' }] },
  oauth: { refresh_token: 'test-refresh' },
  identity: {
    device_id: 'canonical_device_id_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    email: 'canonical@example.com',
  },
  env: {
    platform: 'darwin',
    version: '2.1.91',
  },
  prompt_env: {
    platform: 'darwin',
    shell: 'zsh',
    os_version: 'Darwin 24.4.0',
    working_dir: '/Users/jack/projects',
  },
  process: {
    constrained_memory: 34359738368,
    rss_range: [300000000, 500000000],
    heap_total_range: [40000000, 80000000],
    heap_used_range: [100000000, 200000000],
  },
  logging: { level: 'error', audit: false },
}

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}`)
    console.log(`    ${err}`)
  }
}

console.log('\nScheduler substrate')

test('builds a stable account-centric routing decision', () => {
  const scheduler = createScheduler(config)
  const lease = scheduler.beginRequest({
    client_name: 'tester',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })),
  })

  assert.match(lease.decision.account_id, /^acct-[0-9a-f]{12}$/)
  assert.equal(lease.decision.fingerprint_profile_id, 'example-darwin-arm64')
  assert.equal(lease.decision.capacity_profile_id, 'starter-max5x')
  assert.equal(lease.decision.proxy_url, 'http://192.168.40.184:10808')
  assert.equal(scheduler.snapshot().admission_advice, 'OPEN')

  lease.complete(200)
})

test('extracts session affinity from metadata.user_id.session_id', () => {
  const scheduler = createScheduler(config)
  const lease = scheduler.beginRequest({
    client_name: 'tester',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: Buffer.from(JSON.stringify({
      metadata: {
        user_id: JSON.stringify({
          device_id: 'original-device',
          session_id: 'sess-123',
        }),
      },
      messages: [{ role: 'user', content: 'hello' }],
    })),
  })

  assert.equal(lease.decision.affinity_key, 'sess-123')
  assert.equal(lease.decision.affinity_source, 'request-body')
  assert.equal(scheduler.snapshot().sticky_affinities, 1)

  lease.complete(200)
})

test('tracks busy and idle state across request lifecycle', () => {
  const scheduler = createScheduler(config)
  assert.equal(scheduler.snapshot().busy_state, 'IDLE')

  const lease = scheduler.beginRequest({
    client_name: 'tester',
    method: 'POST',
    path: '/v1/messages',
    headers: {
      'x-session-affinity-key': 'header-affinity',
    },
    body: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })),
  })

  assert.equal(lease.decision.affinity_key, 'header-affinity')
  assert.equal(lease.decision.affinity_source, 'request-header')
  assert.equal(scheduler.snapshot().busy_state, 'BUSY')
  assert.equal(scheduler.snapshot().active_sessions, 1)
  assert.deepEqual(scheduler.snapshot().busy_reason_codes, ['active_leases_present'])

  lease.fail(502, new Error('upstream failed'))
  assert.equal(scheduler.snapshot().busy_state, 'IDLE')
  assert.equal(scheduler.snapshot().active_sessions, 0)
})

test('observes upstream budget headers and updates quota state', () => {
  const scheduler = createScheduler(config)
  const lease = scheduler.beginRequest({
    client_name: 'tester',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })),
  })

  lease.complete(200, {
    'anthropic-ratelimit-unified-chat-utilization': '0.92',
    'anthropic-ratelimit-unified-chat-reset': '2026-04-04T12:00:00Z',
  })

  const snapshot = scheduler.snapshot()
  assert.equal(snapshot.quota_state, 'LIMITED')
  assert.equal(snapshot.drain_state, 'DRAINING')
  assert.equal(snapshot.admission_advice, 'QUEUE_PREFERRED')
  assert.equal(snapshot.rolling_window_utilization, 0.92)
  assert.equal(snapshot.rolling_window_resets_at, '2026-04-04T12:00:00Z')
  assert.equal(snapshot.raw_budget_header_count, 2)
  assert.equal(snapshot.drain_threshold, 0.9)
  assert.deepEqual(snapshot.drain_reason_codes, ['live_utilization_above_drain_threshold'])
  assert.deepEqual(snapshot.admission_reason_codes, ['live_utilization_above_drain_threshold'])
})

test('marks account drained when upstream signals quota exhaustion', () => {
  const scheduler = createScheduler(config)
  const lease = scheduler.beginRequest({
    client_name: 'tester',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })),
  })

  lease.complete(429, {
    'anthropic-ratelimit-unified-chat-utilization': '1',
    'anthropic-ratelimit-unified-chat-surpassed-threshold': 'true',
    'retry-after': '60',
  })

  const snapshot = scheduler.snapshot()
  assert.equal(snapshot.quota_state, 'EXHAUSTED')
  assert.equal(snapshot.drain_state, 'DRAINED')
  assert.equal(snapshot.admission_advice, 'BLOCK_NEW')
  assert.equal(snapshot.retry_after_seconds, 60)
  assert.equal(snapshot.threshold_surpassed, true)
  assert.deepEqual(snapshot.drain_reason_codes, [
    'live_threshold_surpassed',
    'live_retry_after',
    'live_utilization_above_drain_threshold',
  ])
})

test('observes structured usage snapshots from /api/oauth/usage', () => {
  const scheduler = createScheduler(config)
  const lease = scheduler.beginRequest({
    client_name: 'tester',
    method: 'GET',
    path: '/api/oauth/usage',
    headers: {},
    body: Buffer.alloc(0),
  })

  lease.complete(200, {}, Buffer.from(JSON.stringify({
    five_hour: {
      utilization: 91,
      resets_at: '2026-04-04T12:00:00Z',
    },
    seven_day: {
      utilization: 40,
      resets_at: '2026-04-08T00:00:00Z',
    },
    seven_day_sonnet: {
      utilization: 82,
      resets_at: '2026-04-08T00:00:00Z',
    },
    extra_usage: {
      is_enabled: true,
      monthly_limit: 50,
      used_credits: 12.5,
      utilization: 25,
    },
  })))

  const snapshot = scheduler.snapshot()
  assert.equal(snapshot.usage_pressure_state, 'LIMITED')
  assert.equal(snapshot.admission_advice, 'QUEUE_PREFERRED')
  assert.equal(snapshot.usage_snapshot?.five_hour?.utilization, 0.91)
  assert.equal(snapshot.usage_snapshot?.seven_day?.utilization, 0.4)
  assert.equal(snapshot.usage_snapshot?.seven_day_sonnet?.utilization, 0.82)
  assert.equal(snapshot.usage_snapshot?.extra_usage?.is_enabled, true)
  assert.equal(snapshot.usage_snapshot?.extra_usage?.utilization, 0.25)
  assert.deepEqual(snapshot.admission_reason_codes, [
    'usage_five_hour_above_hint',
    'usage_weekly_above_hint',
  ])
})

test('marks usage pressure exhausted when usage payload reaches 100 percent', () => {
  const scheduler = createScheduler(config)
  const lease = scheduler.beginRequest({
    client_name: 'tester',
    method: 'GET',
    path: '/api/oauth/usage',
    headers: {},
    body: Buffer.alloc(0),
  })

  lease.complete(200, {}, Buffer.from(JSON.stringify({
    seven_day: {
      utilization: 100,
      resets_at: '2026-04-08T00:00:00Z',
    },
  })))

  assert.equal(scheduler.snapshot().usage_pressure_state, 'EXHAUSTED')
  assert.equal(scheduler.snapshot().admission_advice, 'BLOCK_NEW')
  assert.deepEqual(scheduler.snapshot().admission_reason_codes, [
    'usage_window_exhausted',
    'usage_weekly_above_hint',
  ])
})

test('prefers queueing when active sessions reach the account capacity hint', () => {
  const scheduler = createScheduler(config)
  const leaseA = scheduler.beginRequest({
    client_name: 'tester',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'hello-a' }] })),
  })
  const leaseB = scheduler.beginRequest({
    client_name: 'tester',
    method: 'POST',
    path: '/v1/messages',
    headers: {},
    body: Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: 'hello-b' }] })),
  })

  const snapshot = scheduler.snapshot()
  assert.equal(snapshot.active_sessions, 2)
  assert.equal(snapshot.admission_advice, 'QUEUE_PREFERRED')
  assert.deepEqual(snapshot.busy_reason_codes, ['active_leases_present', 'capacity_hint_reached'])
  assert.deepEqual(snapshot.admission_reason_codes, ['active_leases_present', 'capacity_hint_reached'])

  leaseA.complete(200)
  leaseB.complete(200)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

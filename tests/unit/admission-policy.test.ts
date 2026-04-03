import { strict as assert } from 'assert'
import type { Config } from '../../src/config.js'
import { evaluateAdmissionPolicy } from '../../src/admission-policy.js'
import type { AdmissionPreview } from '../../src/scheduler.js'

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

const baseConfig: Config = {
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
  admission_control: {
    enforcement_mode: 'observe-only',
    reject_status_code: 429,
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

function withMode(
  enforcementMode: NonNullable<Config['admission_control']>['enforcement_mode'],
  preview: AdmissionPreview,
) {
  return evaluateAdmissionPolicy(
    {
      ...baseConfig,
      admission_control: {
        enforcement_mode: enforcementMode,
        reject_status_code: 429,
      },
    },
    preview,
  )
}

console.log('\nAdmission policy')

test('observe-only never rejects', () => {
  const evaluation = withMode('observe-only', {
    advice: 'BLOCK_NEW',
    reason_codes: ['live_retry_after'],
    projected_active_sessions: 3,
    busy_state: 'BUSY',
    drain_state: 'DRAINING',
    quota_state: 'LIMITED',
    usage_pressure_state: 'LIMITED',
    retry_after_seconds: 120,
  })

  assert.equal(evaluation.should_reject, false)
  assert.equal(evaluation.status_code, 429)
  assert.equal(evaluation.headers['Retry-After'], '120')
})

test('reject-block-new only rejects BLOCK_NEW advice', () => {
  const queuePreferred = withMode('reject-block-new', {
    advice: 'QUEUE_PREFERRED',
    reason_codes: ['capacity_hint_reached'],
    projected_active_sessions: 3,
    busy_state: 'BUSY',
    drain_state: 'ACCEPTING',
    quota_state: 'UNKNOWN',
  })
  const blockNew = withMode('reject-block-new', {
    advice: 'BLOCK_NEW',
    reason_codes: ['live_retry_after'],
    projected_active_sessions: 2,
    busy_state: 'BUSY',
    drain_state: 'DRAINING',
    quota_state: 'LIMITED',
    retry_after_seconds: 60,
  })

  assert.equal(queuePreferred.should_reject, false)
  assert.equal(blockNew.should_reject, true)
  assert.equal(blockNew.body.admission_advice, 'BLOCK_NEW')
  assert.deepEqual(blockNew.body.reason_codes, ['live_retry_after'])
})

test('reject-queue-preferred rejects any non-open advice', () => {
  const open = withMode('reject-queue-preferred', {
    advice: 'OPEN',
    reason_codes: [],
    projected_active_sessions: 1,
    busy_state: 'BUSY',
    drain_state: 'ACCEPTING',
    quota_state: 'UNKNOWN',
  })
  const queue = withMode('reject-queue-preferred', {
    advice: 'QUEUE_PREFERRED',
    reason_codes: ['capacity_hint_reached'],
    projected_active_sessions: 3,
    busy_state: 'BUSY',
    drain_state: 'ACCEPTING',
    quota_state: 'UNKNOWN',
  })

  assert.equal(open.should_reject, false)
  assert.equal(queue.should_reject, true)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

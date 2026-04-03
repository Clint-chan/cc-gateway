import { strict as assert } from 'assert'
import type { Config } from '../../src/config.js'
import { createScheduler } from '../../src/scheduler.js'

const config: Config = {
  server: { port: 8443, tls: { cert: '', key: '' } },
  upstream: { url: 'https://api.anthropic.com' },
  network: { proxy_url: 'http://192.168.40.184:10808' },
  fingerprint_profile: 'example-darwin-arm64',
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
  assert.equal(lease.decision.capacity_profile_id, 'cap-example-darwin-arm64')
  assert.equal(lease.decision.proxy_url, 'http://192.168.40.184:10808')

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

  lease.fail(502, new Error('upstream failed'))
  assert.equal(scheduler.snapshot().busy_state, 'IDLE')
  assert.equal(scheduler.snapshot().active_sessions, 0)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

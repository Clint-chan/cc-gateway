import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { strict as assert } from 'assert'
import { loadConfig } from '../../src/config.js'

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

const baseConfig = `
server:
  port: \${TEST_GATEWAY_PORT}
  tls:
    cert: "./certs/cert.pem"
    key: "./certs/key.pem"
upstream:
  url: "\${TEST_UPSTREAM_URL:-https://api.anthropic.com}"
network:
  proxy_url: \${TEST_PROXY_URL:-null}
capacity_profile:
  id: \${TEST_CAPACITY_ID:-starter-max5x}
  admission_mode: observe-only
  max_active_sessions_hint: 2
  rolling_window_budget_hint: 0.85
  weekly_budget_hint: 0.8
  peak_hour_multiplier: 1.2
  drain_threshold: 0.9
admission_control:
  enforcement_mode: \${TEST_ENFORCEMENT_MODE:-observe-only}
  reject_status_code: \${TEST_REJECT_STATUS_CODE:-429}
auth:
  tokens:
    - name: "\${TEST_CLIENT_NAME}"
      token: "\${TEST_CLIENT_TOKEN}"
oauth:
  access_token: \${TEST_ACCESS_TOKEN:-null}
  refresh_token: "\${TEST_REFRESH_TOKEN}"
  expires_at: \${TEST_EXPIRES_AT:-null}
identity:
  device_id: "\${TEST_DEVICE_ID}"
  email: "\${TEST_EMAIL}"
env:
  platform: darwin
prompt_env:
  platform: darwin
  shell: zsh
  os_version: Darwin 24.4.0
  working_dir: /Users/test/projects
process:
  constrained_memory: 1
  rss_range: [1, 2]
  heap_total_range: [1, 2]
  heap_used_range: [1, 2]
logging:
  level: info
  audit: true
  file: "./runtime/logs/gateway.log"
  audit_file: "./runtime/logs/audit.log"
`

const profileBackedConfig = `
server:
  port: \${TEST_GATEWAY_PORT}
  tls:
    cert: "./certs/cert.pem"
    key: "./certs/key.pem"
upstream:
  url: "\${TEST_UPSTREAM_URL:-https://api.anthropic.com}"
fingerprint_profile: "test-profile"
auth:
  tokens:
    - name: "\${TEST_CLIENT_NAME}"
      token: "\${TEST_CLIENT_TOKEN}"
oauth:
  refresh_token: "\${TEST_REFRESH_TOKEN}"
identity:
  device_id: "\${TEST_DEVICE_ID}"
  email: "\${TEST_EMAIL}"
logging:
  level: info
  audit: true
`

function withTempConfig(envBody: string, run: (configPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-config-'))
  const configPath = join(dir, 'config.yaml')
  const envPath = join(dir, '.env')

  writeFileSync(configPath, baseConfig)
  writeFileSync(envPath, envBody)

  const snapshot = new Map<string, string | undefined>()
  for (const key of [
    'TEST_GATEWAY_PORT',
    'TEST_UPSTREAM_URL',
    'TEST_PROXY_URL',
    'TEST_CLIENT_NAME',
    'TEST_CLIENT_TOKEN',
    'TEST_ENFORCEMENT_MODE',
    'TEST_REJECT_STATUS_CODE',
    'TEST_ACCESS_TOKEN',
    'TEST_REFRESH_TOKEN',
    'TEST_EXPIRES_AT',
    'TEST_DEVICE_ID',
    'TEST_EMAIL',
  ]) {
    snapshot.set(key, process.env[key])
    delete process.env[key]
  }

  try {
    run(configPath)
  } finally {
    for (const [key, value] of snapshot) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\nConfig loader')

test('loads .env beside config and expands placeholders', () => {
  withTempConfig(`
TEST_GATEWAY_PORT=9443
TEST_PROXY_URL=http://192.168.40.184:10808
TEST_CLIENT_NAME=local-dev
TEST_CLIENT_TOKEN=test-client-token
TEST_ACCESS_TOKEN=test-access-token
TEST_REFRESH_TOKEN=test-refresh-token
TEST_EXPIRES_AT=1775237690974
TEST_DEVICE_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TEST_EMAIL=tester@example.com
`, (configPath) => {
    const config = loadConfig(configPath)
    assert.equal(config.server.port, 9443)
    assert.equal(config.network?.proxy_url, 'http://192.168.40.184:10808')
    assert.equal(config.oauth.access_token, 'test-access-token')
    assert.equal(config.oauth.expires_at, 1775237690974)
    assert.equal(config.auth.tokens[0]?.name, 'local-dev')
    assert.equal(config.auth.tokens[0]?.token, 'test-client-token')
    assert.equal(config.identity.email, 'tester@example.com')
    assert.equal(config.capacity_profile?.id, 'starter-max5x')
    assert.equal(config.capacity_profile?.max_active_sessions_hint, 2)
    assert.equal(config.capacity_profile?.drain_threshold, 0.9)
    assert.equal(config.admission_control?.enforcement_mode, 'observe-only')
    assert.equal(config.admission_control?.reject_status_code, 429)
  })
})

test('does not let .env override existing process env values', () => {
  withTempConfig(`
TEST_GATEWAY_PORT=8443
TEST_CLIENT_NAME=env-file-client
TEST_CLIENT_TOKEN=test-client-token
TEST_REFRESH_TOKEN=test-refresh-token
TEST_DEVICE_ID=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
TEST_EMAIL=tester@example.com
`, (configPath) => {
    process.env.TEST_GATEWAY_PORT = '9555'
    const config = loadConfig(configPath)
    assert.equal(config.server.port, 9555)
  })
})

test('throws a clear error when a required env var is missing', () => {
  withTempConfig(`
TEST_GATEWAY_PORT=8443
TEST_CLIENT_NAME=missing-refresh
TEST_CLIENT_TOKEN=test-client-token
TEST_DEVICE_ID=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
TEST_EMAIL=tester@example.com
`, (configPath) => {
    assert.throws(
      () => loadConfig(configPath),
      /config: missing env var TEST_REFRESH_TOKEN/,
    )
  })
})

test('throws a clear error when capacity_profile is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-invalid-capacity-'))
  const configPath = join(dir, 'config.yaml')
  const envPath = join(dir, '.env')

  writeFileSync(
    configPath,
    baseConfig.replace('max_active_sessions_hint: 2', 'max_active_sessions_hint: 0'),
  )
  writeFileSync(
    envPath,
    `
TEST_GATEWAY_PORT=8443
TEST_CLIENT_NAME=invalid-capacity
TEST_CLIENT_TOKEN=test-client-token
TEST_REFRESH_TOKEN=test-refresh-token
TEST_DEVICE_ID=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
TEST_EMAIL=tester@example.com
`,
  )

  const snapshot = new Map<string, string | undefined>()
  for (const key of [
    'TEST_GATEWAY_PORT',
    'TEST_CLIENT_NAME',
    'TEST_CLIENT_TOKEN',
    'TEST_ENFORCEMENT_MODE',
    'TEST_REJECT_STATUS_CODE',
    'TEST_REFRESH_TOKEN',
    'TEST_DEVICE_ID',
    'TEST_EMAIL',
  ]) {
    snapshot.set(key, process.env[key])
    delete process.env[key]
  }

  try {
    assert.throws(
      () => loadConfig(configPath),
      /config: capacity_profile.max_active_sessions_hint must be greater than zero/,
    )
  } finally {
    for (const [key, value] of snapshot) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('throws a clear error when admission_control.reject_status_code is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-invalid-admission-'))
  const configPath = join(dir, 'config.yaml')
  const envPath = join(dir, '.env')

  writeFileSync(configPath, baseConfig)
  writeFileSync(
    envPath,
    `
TEST_GATEWAY_PORT=8443
TEST_CLIENT_NAME=invalid-admission
TEST_CLIENT_TOKEN=test-client-token
TEST_REFRESH_TOKEN=test-refresh-token
TEST_DEVICE_ID=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
TEST_EMAIL=tester@example.com
TEST_REJECT_STATUS_CODE=399
`,
  )

  const snapshot = new Map<string, string | undefined>()
  for (const key of [
    'TEST_GATEWAY_PORT',
    'TEST_CLIENT_NAME',
    'TEST_CLIENT_TOKEN',
    'TEST_ENFORCEMENT_MODE',
    'TEST_REJECT_STATUS_CODE',
    'TEST_REFRESH_TOKEN',
    'TEST_DEVICE_ID',
    'TEST_EMAIL',
  ]) {
    snapshot.set(key, process.env[key])
    delete process.env[key]
  }

  try {
    assert.throws(
      () => loadConfig(configPath),
      /config: admission_control.reject_status_code must be within \[400, 599\]/,
    )
  } finally {
    for (const [key, value] of snapshot) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loads client/env/prompt_env/process from fingerprint_profile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-gateway-profile-'))
  const configPath = join(dir, 'config.yaml')
  const envPath = join(dir, '.env')
  const profileDir = join(dir, 'profiles', 'fingerprints')
  const profilePath = join(profileDir, 'test-profile.yaml')

  mkdirSync(profileDir, { recursive: true })
  writeFileSync(configPath, profileBackedConfig)
  writeFileSync(
    profilePath,
    `
client:
  user_agent: "claude-cli/2.1.91 (external, sdk-cli)"
  entrypoint: sdk-cli
env:
  platform: darwin
  terminal: "Terminal.app"
prompt_env:
  platform: darwin
  shell: zsh
  os_version: Darwin 24.4.0
  working_dir: /Users/test/projects
process:
  constrained_memory: 34359738368
  rss_range: [300000000, 500000000]
  heap_total_range: [40000000, 80000000]
  heap_used_range: [100000000, 200000000]
`,
  )
  writeFileSync(
    envPath,
    `
TEST_GATEWAY_PORT=8443
TEST_CLIENT_NAME=profile-client
TEST_CLIENT_TOKEN=profile-token
TEST_REFRESH_TOKEN=test-refresh-token
TEST_DEVICE_ID=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
TEST_EMAIL=profile@example.com
`,
  )

  const snapshot = new Map<string, string | undefined>()
  for (const key of [
    'TEST_GATEWAY_PORT',
    'TEST_CLIENT_NAME',
    'TEST_CLIENT_TOKEN',
    'TEST_REFRESH_TOKEN',
    'TEST_DEVICE_ID',
    'TEST_EMAIL',
  ]) {
    snapshot.set(key, process.env[key])
    delete process.env[key]
  }

  try {
    const config = loadConfig(configPath)
    assert.equal(config.identity.email, 'profile@example.com')
    assert.equal(config.client?.user_agent, 'claude-cli/2.1.91 (external, sdk-cli)')
    assert.equal(config.env.terminal, 'Terminal.app')
    assert.equal(config.prompt_env.shell, 'zsh')
    assert.equal(config.process.constrained_memory, 34359738368)
  } finally {
    for (const [key, value] of snapshot) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

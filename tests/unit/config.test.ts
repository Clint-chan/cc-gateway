import { mkdtempSync, rmSync, writeFileSync } from 'fs'
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

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

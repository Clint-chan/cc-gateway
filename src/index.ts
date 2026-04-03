import { loadConfig } from './config.js'
import { setLogLevel, log } from './logger.js'
import { initOAuth } from './oauth.js'
import { startProxy } from './proxy.js'
import { setProxyUrl } from './net.js'

const configPath = process.argv[2]

try {
  const config = loadConfig(configPath)
  setLogLevel(config.logging.level)
  setProxyUrl(config.network?.proxy_url)

  log('info', 'CC Gateway starting...')

  // Initialize OAuth first - gateway manages the token lifecycle
  await initOAuth(config.oauth)

  startProxy(config)
} catch (err) {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}

import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Agent } from 'http'

let configuredProxyUrl: string | null = null

export function setProxyUrl(proxyUrl?: string): void {
  configuredProxyUrl = proxyUrl?.trim() || null
}

function readProxyUrl(): string | null {
  if (configuredProxyUrl) return configuredProxyUrl

  const value =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy

  if (!value) return null

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function getProxyAgent(): Agent | undefined {
  const proxyUrl = readProxyUrl()
  if (!proxyUrl) return undefined
  return new HttpsProxyAgent(proxyUrl)
}

import { createAkshareHttpMarketProvider } from './akshare-http.js'
import { createMockMarketProvider } from './mock.js'
import { createUnavailableMarketProvider } from './unavailable.js'
import type { MarketProvider } from './types.js'

export interface MarketProviderConfig {
  provider: string
  akshareBaseUrl?: string
  akshareTimeoutMs: number
  allowMockFallback: boolean
}

export function createMarketProvider(config: MarketProviderConfig): MarketProvider {
  if (config.provider === 'mock') {
    return createMockMarketProvider()
  }

  if (config.provider === 'akshare-http') {
    if (!config.akshareBaseUrl && config.allowMockFallback) {
      return createMockMarketProvider()
    }
    return createAkshareHttpMarketProvider({
      baseUrl: config.akshareBaseUrl || '',
      timeoutMs: config.akshareTimeoutMs,
      allowFallback: config.allowMockFallback,
    })
  }

  return createUnavailableMarketProvider(
    config.provider,
    `Unknown market provider: ${config.provider}`
  )
}

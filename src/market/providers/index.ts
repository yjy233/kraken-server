import { createAkshareHttpMarketProvider } from './akshare-http.js'
import { createMockMarketProvider } from './mock.js'
import type { MarketProvider } from './types.js'

export interface MarketProviderConfig {
  provider: string
  akshareBaseUrl?: string
  akshareTimeoutMs: number
}

export function createMarketProvider(config: MarketProviderConfig): MarketProvider {
  if (config.provider === 'akshare-http') {
    if (!config.akshareBaseUrl) {
      return createMockMarketProvider()
    }
    return createAkshareHttpMarketProvider({
      baseUrl: config.akshareBaseUrl,
      timeoutMs: config.akshareTimeoutMs,
    })
  }

  return createMockMarketProvider()
}

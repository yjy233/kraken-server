import type {
  InfluencerPost,
  MarketBar,
  MarketNarrative,
  MarketStatus,
  MarketSymbol,
  QuoteSnapshot,
  SectorHeat,
} from '../types.js'
import type { MarketProvider, MarketProviderStatus } from './types.js'

export function createUnavailableMarketProvider(provider: string, reason: string): MarketProvider {
  async function getStatus(): Promise<MarketProviderStatus> {
    return {
      provider,
      providerLabel: `Unavailable provider: ${provider}`,
      quoteDelayMs: 0,
      dataMode: 'live' satisfies MarketStatus['dataMode'],
      capabilities: {
        quotes: false,
        bars: false,
        sectors: false,
        narratives: false,
        influencers: false,
      },
    }
  }

  async function fail(): Promise<never> {
    throw new Error(reason)
  }

  return {
    getStatus,
    getSymbols: fail as () => Promise<MarketSymbol[]>,
    getQuotes: fail as (symbols: string[]) => Promise<QuoteSnapshot[]>,
    getBars: fail as (symbol: string, timeframe: MarketBar['timeframe'], limit: number) => Promise<MarketBar[]>,
    getHotSectors: fail as () => Promise<SectorHeat[]>,
    getNarratives: fail as () => Promise<MarketNarrative[]>,
    getInfluencerPosts: fail as () => Promise<InfluencerPost[]>,
  }
}

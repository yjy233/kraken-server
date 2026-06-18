import type {
  InfluencerPost,
  MarketBar,
  MarketNarrative,
  MarketStatus,
  MarketSymbol,
  QuoteSnapshot,
  SectorHeat,
} from '../types.js'

export interface MarketProviderStatus {
  provider: string
  providerLabel: string
  quoteDelayMs: number
  dataMode: MarketStatus['dataMode']
  capabilities: {
    quotes: boolean
    bars: boolean
    sectors: boolean
    narratives: boolean
    influencers: boolean
  }
}

export interface MarketProvider {
  getStatus(): Promise<MarketProviderStatus>
  getSymbols(): Promise<MarketSymbol[]>
  getQuotes(symbols: string[]): Promise<QuoteSnapshot[]>
  getBars(symbol: string, timeframe: MarketBar['timeframe'], limit: number): Promise<MarketBar[]>
  getHotSectors(): Promise<SectorHeat[]>
  getNarratives(): Promise<MarketNarrative[]>
  getInfluencerPosts(): Promise<InfluencerPost[]>
}

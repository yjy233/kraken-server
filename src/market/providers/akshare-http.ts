import type {
  InfluencerPost,
  MarketBar,
  MarketNarrative,
  MarketSourceRef,
  MarketSymbol,
  QuoteSnapshot,
  SectorHeat,
} from '../types.js'
import { normalizeSymbol, normalizeSymbols } from '../store.js'
import type { MarketProvider, MarketProviderStatus } from './types.js'
import { createMockMarketProvider } from './mock.js'

interface AkshareHttpProviderOptions {
  baseUrl: string
  timeoutMs: number
}

export function createAkshareHttpMarketProvider(options: AkshareHttpProviderOptions): MarketProvider {
  const fallback = createMockMarketProvider()
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const timeoutMs = Math.max(1000, options.timeoutMs)

  async function getStatus(): Promise<MarketProviderStatus> {
    return {
      provider: 'akshare-http',
      providerLabel: 'AKShare HTTP provider',
      quoteDelayMs: 60_000,
      dataMode: 'live',
      capabilities: {
        quotes: true,
        bars: true,
        sectors: false,
        narratives: false,
        influencers: false,
      },
    }
  }

  async function getSymbols(): Promise<MarketSymbol[]> {
    return fallback.getSymbols()
  }

  async function getQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
    const normalized = normalizeSymbols(symbols)
    if (normalized.length === 0) {
      return []
    }
    try {
      const payload = await requestJson('/api/market/quotes', { symbols: normalized.join(',') })
      const rows = Array.isArray((payload as any).quotes)
        ? (payload as any).quotes
        : Array.isArray(payload)
          ? payload
          : []
      const quotes = rows.map((row: unknown) => normalizeQuote(row)).filter(Boolean) as QuoteSnapshot[]
      return quotes.length > 0 ? quotes : fallback.getQuotes(normalized)
    } catch {
      return fallback.getQuotes(normalized)
    }
  }

  async function getBars(symbol: string, timeframe: MarketBar['timeframe'], limit: number): Promise<MarketBar[]> {
    if (timeframe !== '1d') {
      throw new Error('only 1d bars are available in akshare-http provider')
    }
    const normalized = normalizeSymbol(symbol)
    try {
      const payload = await requestJson('/api/market/bars', {
        symbol: normalized,
        timeframe,
        limit: String(limit),
      })
      const rows = Array.isArray((payload as any).bars)
        ? (payload as any).bars
        : Array.isArray(payload)
          ? payload
          : []
      const bars = rows.map((row: unknown) => normalizeBar(row, normalized, timeframe)).filter(Boolean) as MarketBar[]
      return bars.length >= 26 ? bars : fallback.getBars(normalized, timeframe, limit)
    } catch {
      return fallback.getBars(normalized, timeframe, limit)
    }
  }

  async function getHotSectors(): Promise<SectorHeat[]> {
    return fallback.getHotSectors()
  }

  async function getNarratives(): Promise<MarketNarrative[]> {
    return fallback.getNarratives()
  }

  async function getInfluencerPosts(): Promise<InfluencerPost[]> {
    return fallback.getInfluencerPosts()
  }

  async function requestJson(pathname: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(`${baseUrl}${pathname}`)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
        },
      })
      if (!response.ok) {
        throw new Error(`AKShare HTTP request failed: ${response.status}`)
      }
      return await response.json()
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    getStatus,
    getSymbols,
    getQuotes,
    getBars,
    getHotSectors,
    getNarratives,
    getInfluencerPosts,
  }
}

function normalizeQuote(value: unknown): QuoteSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code)
  const price = toNumber(row.price ?? row.close ?? row.latest)
  const previousClose = toNumber(row.previousClose ?? row.pre_close ?? row.prev_close ?? row.yesterdayClose) || price
  if (!symbol || !price) {
    return null
  }
  const ts = normalizeTimestamp(row.ts ?? row.time ?? row.datetime ?? row.trade_time)
  const change = toNumber(row.change ?? row.pct_chg_amount) || price - previousClose
  const changePct = toNumber(row.changePct ?? row.pct_chg ?? row.percent ?? row.change_percent) || (previousClose ? (price - previousClose) / previousClose * 100 : 0)
  return {
    symbol,
    ts,
    price: round(price, 2),
    change: round(change, 2),
    changePct: round(changePct, 2),
    open: round(toNumber(row.open) || price, 2),
    high: round(toNumber(row.high) || price, 2),
    low: round(toNumber(row.low) || price, 2),
    previousClose: round(previousClose, 2),
    volume: Math.round(toNumber(row.volume ?? row.vol) || 0),
    amount: Math.round(toNumber(row.amount ?? row.成交额) || 0),
    turnoverRate: round(toNumber(row.turnoverRate ?? row.turnover_rate) || 0, 2),
    volumeRatio: round(toNumber(row.volumeRatio ?? row.volume_ratio) || 1, 2),
    source: buildSource(ts),
  }
}

function normalizeBar(value: unknown, fallbackSymbol: string, timeframe: MarketBar['timeframe']): MarketBar | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as Record<string, unknown>
  const symbol = normalizeSymbol(row.symbol ?? row.code ?? row.ts_code ?? fallbackSymbol)
  const close = toNumber(row.close ?? row.收盘)
  if (!symbol || !close) {
    return null
  }
  const ts = normalizeTimestamp(row.ts ?? row.date ?? row.trade_date ?? row.datetime ?? row.日期)
  return {
    symbol,
    ts,
    timeframe,
    open: round(toNumber(row.open ?? row.开盘) || close, 2),
    high: round(toNumber(row.high ?? row.最高) || close, 2),
    low: round(toNumber(row.low ?? row.最低) || close, 2),
    close: round(close, 2),
    volume: Math.round(toNumber(row.volume ?? row.vol ?? row.成交量) || 0),
    amount: Math.round(toNumber(row.amount ?? row.成交额) || 0),
    source: buildSource(ts),
  }
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }
  const raw = String(value || '').trim()
  if (!raw) {
    return new Date().toISOString()
  }
  if (/^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T04:00:00.000Z`).toISOString()
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function buildSource(fetchedAt: string): MarketSourceRef {
  return {
    sourceName: 'AKShare HTTP',
    provider: 'akshare-http',
    licenseType: 'public',
    fetchedAt,
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').replace(/%$/, '').trim()
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

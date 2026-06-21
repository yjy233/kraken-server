import { promises as fs } from 'node:fs'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { MarketWatchlist, WatchlistState } from './types.js'

const DEFAULT_WATCHLIST_SYMBOLS = [
  '600519.SH',
  '300750.SZ',
  '002594.SZ',
  '601318.SH',
  '000001.SZ',
  '603986.SH',
]

export function createMarketStore(rootDir: string) {
  mkdirSync(rootDir, { recursive: true })
  const watchlistPath = path.join(rootDir, 'watchlists.json')

  async function getWatchlist(): Promise<MarketWatchlist> {
    const state = await readWatchlistState()
    return state.watchlist
  }

  async function addSymbols(symbols: string[]): Promise<MarketWatchlist> {
    const state = await readWatchlistState()
    const nextSymbols = normalizeSymbols([
      ...state.watchlist.symbols,
      ...symbols,
    ])
    const watchlist: MarketWatchlist = {
      ...state.watchlist,
      symbols: nextSymbols,
      updatedAt: new Date().toISOString(),
    }
    await writeWatchlistState({ watchlist })
    return watchlist
  }

  async function removeSymbol(symbol: string): Promise<MarketWatchlist> {
    const normalized = normalizeSymbol(symbol)
    const state = await readWatchlistState()
    const watchlist: MarketWatchlist = {
      ...state.watchlist,
      symbols: state.watchlist.symbols.filter((item) => item !== normalized),
      updatedAt: new Date().toISOString(),
    }
    await writeWatchlistState({ watchlist })
    return watchlist
  }

  async function replaceSymbols(symbols: string[]): Promise<MarketWatchlist> {
    const state = await readWatchlistState()
    const watchlist: MarketWatchlist = {
      ...state.watchlist,
      symbols: normalizeSymbols(symbols),
      updatedAt: new Date().toISOString(),
    }
    await writeWatchlistState({ watchlist })
    return watchlist
  }

  async function readWatchlistState(): Promise<WatchlistState> {
    if (!existsSync(watchlistPath)) {
      const initial = createDefaultWatchlistState()
      await writeWatchlistState(initial)
      return initial
    }
    try {
      const raw = await fs.readFile(watchlistPath, 'utf8')
      const parsed = JSON.parse(raw) as WatchlistState
      return normalizeWatchlistState(parsed)
    } catch {
      const initial = createDefaultWatchlistState()
      await writeWatchlistState(initial)
      return initial
    }
  }

  async function writeWatchlistState(state: WatchlistState): Promise<void> {
    const tmpPath = `${watchlistPath}.${process.pid}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8')
    await fs.rename(tmpPath, watchlistPath)
  }

  return {
    rootDir,
    watchlistPath,
    getWatchlist,
    addSymbols,
    removeSymbol,
    replaceSymbols,
  }
}

function createDefaultWatchlistState(): WatchlistState {
  const timestamp = new Date().toISOString()
  return {
    watchlist: {
      id: 'default',
      name: 'Default Watchlist',
      symbols: DEFAULT_WATCHLIST_SYMBOLS,
      updatedAt: timestamp,
    },
  }
}

function normalizeWatchlistState(value: WatchlistState): WatchlistState {
  const fallback = createDefaultWatchlistState()
  const watchlist = value?.watchlist && typeof value.watchlist === 'object'
    ? value.watchlist
    : fallback.watchlist
  return {
    watchlist: {
      id: typeof watchlist.id === 'string' && watchlist.id.trim()
        ? watchlist.id.trim()
        : fallback.watchlist.id,
      name: typeof watchlist.name === 'string' && watchlist.name.trim()
        ? watchlist.name.trim()
        : fallback.watchlist.name,
      symbols: Array.isArray(watchlist.symbols)
        ? normalizeSymbols(watchlist.symbols)
        : fallback.watchlist.symbols,
      updatedAt: typeof watchlist.updatedAt === 'string' && watchlist.updatedAt.trim()
        ? watchlist.updatedAt
        : fallback.watchlist.updatedAt,
    },
  }
}

export function normalizeSymbols(symbols: unknown[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of symbols) {
    const symbol = normalizeSymbol(item)
    if (!symbol || seen.has(symbol)) {
      continue
    }
    seen.add(symbol)
    normalized.push(symbol)
  }
  return normalized
}

export function normalizeSymbol(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) {
    return ''
  }
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(raw)) {
    return raw.replace('.SH', '.SH').replace('.SZ', '.SZ').replace('.BJ', '.BJ')
  }
  if (/^SH\d{6}$/.test(raw)) {
    return `${raw.slice(2)}.SH`
  }
  if (/^SZ\d{6}$/.test(raw)) {
    return `${raw.slice(2)}.SZ`
  }
  if (/^BJ\d{6}$/.test(raw)) {
    return `${raw.slice(2)}.BJ`
  }
  if (/^\d{6}$/.test(raw)) {
    if (raw.startsWith('6')) {
      return `${raw}.SH`
    }
    if (raw.startsWith('8') || raw.startsWith('4') || raw.startsWith('9')) {
      return `${raw}.BJ`
    }
    return `${raw}.SZ`
  }
  return raw
}

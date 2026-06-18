import express from 'express'
import type { createMarketService } from './service.js'
import type { MarketBar } from './types.js'

type MarketService = ReturnType<typeof createMarketService>

export function createMarketRouter(service: MarketService): express.Router {
  const router = express.Router()

  router.get('/status', async (_req, res, next) => {
    try {
      res.json({ ok: true, status: await service.getStatus() })
    } catch (error) {
      next(error)
    }
  })

  router.get('/overview', async (_req, res, next) => {
    try {
      res.json({ ok: true, overview: await service.getOverview() })
    } catch (error) {
      next(error)
    }
  })

  router.get('/watchlists', async (_req, res, next) => {
    try {
      res.json({ ok: true, watchlist: await service.getWatchlist() })
    } catch (error) {
      next(error)
    }
  })

  router.post('/watchlists', async (req, res, next) => {
    try {
      const symbols = parseSymbols(req.body?.symbols ?? req.body?.symbol)
      const watchlist = await service.addWatchlistSymbols(symbols)
      res.status(201).json({ ok: true, watchlist })
    } catch (error) {
      next(error)
    }
  })

  router.put('/watchlists', async (req, res, next) => {
    try {
      const symbols = parseSymbols(req.body?.symbols ?? req.body?.symbol)
      const watchlist = await service.replaceWatchlistSymbols(symbols)
      res.json({ ok: true, watchlist })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/watchlists/:symbol', async (req, res, next) => {
    try {
      const watchlist = await service.removeWatchlistSymbol(req.params.symbol)
      res.json({ ok: true, watchlist })
    } catch (error) {
      next(error)
    }
  })

  router.get('/quotes', async (req, res, next) => {
    try {
      const symbols = parseSymbols(req.query.symbols)
      res.json({ ok: true, quotes: await service.getQuotes(symbols) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/sectors/hot', async (_req, res, next) => {
    try {
      res.json({ ok: true, sectors: await service.getHotSectors() })
    } catch (error) {
      next(error)
    }
  })

  router.get('/narratives', async (_req, res, next) => {
    try {
      res.json({ ok: true, narratives: await service.getNarratives() })
    } catch (error) {
      next(error)
    }
  })

  router.post('/narratives/analyze', async (req, res, next) => {
    try {
      const content = typeof req.body?.content === 'string' ? req.body.content : ''
      res.json({ ok: true, narrative: await service.analyzeNarrative(content) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/influencers', async (_req, res, next) => {
    try {
      res.json({ ok: true, posts: await service.getInfluencerPosts() })
    } catch (error) {
      next(error)
    }
  })

  router.get('/technicals/:symbol', async (req, res, next) => {
    try {
      res.json({ ok: true, technical: await service.getTechnicals(req.params.symbol) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/bars/:symbol', async (req, res, next) => {
    try {
      const timeframe = parseTimeframe(req.query.timeframe)
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 90
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 90
      res.json({ ok: true, bars: await service.getBars(req.params.symbol, timeframe, limit) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/alerts', async (_req, res, next) => {
    try {
      res.json({ ok: true, alerts: await service.getAlerts() })
    } catch (error) {
      next(error)
    }
  })

  router.post('/reports/run', async (req, res, next) => {
    try {
      res.json({ ok: true, report: await service.runReport(parseReportKind(req.body?.kind)) })
    } catch (error) {
      next(error)
    }
  })

  return router
}

function parseReportKind(value: unknown): 'intraday' | 'close' | 'watchlist' {
  return value === 'close' || value === 'watchlist' ? value : 'intraday'
}

function parseTimeframe(value: unknown): MarketBar['timeframe'] {
  const timeframe = typeof value === 'string' ? value : '1d'
  if (
    timeframe === '1d' ||
    timeframe === '1m' ||
    timeframe === '5m' ||
    timeframe === '15m' ||
    timeframe === '30m' ||
    timeframe === '60m'
  ) {
    return timeframe
  }
  return '1d'
}

function parseSymbols(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

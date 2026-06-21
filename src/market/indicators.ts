import type { MarketBar, TechnicalSignal } from './types.js'

export function buildTechnicalSignalFromBars(symbol: string, bars: MarketBar[]): TechnicalSignal {
  if (bars.length < 6) {
    throw new Error('at least 6 bars are required')
  }

  const sortedBars = [...bars].sort((left, right) => left.ts.localeCompare(right.ts))
  const closes = sortedBars.map((bar) => bar.close)
  const highs = sortedBars.map((bar) => bar.high)
  const lows = sortedBars.map((bar) => bar.low)
  const volumes = sortedBars.map((bar) => bar.volume)
  const lastBar = sortedBars[sortedBars.length - 1]
  if (!lastBar) {
    throw new Error('bars are required')
  }

  const ma5 = round(sma(closes, Math.min(5, closes.length)), 2)
  const ma10 = round(sma(closes, Math.min(10, closes.length)), 2)
  const ma20 = round(sma(closes, Math.min(20, closes.length)), 2)
  const atr14 = round(atr(sortedBars, Math.min(14, Math.max(2, sortedBars.length - 1))), 2)
  const rsi6 = Math.round(rsi(closes, Math.min(6, Math.max(2, closes.length - 1))))
  const macdValue = macd(closes)
  const recentBars = sortedBars.slice(-Math.min(20, sortedBars.length))
  const support = round(Math.min(...recentBars.map((bar) => bar.low)), 2)
  const resistance = round(Math.max(...recentBars.map((bar) => bar.high)), 2)
  const recentVolume = average(volumes.slice(-Math.min(3, volumes.length)))
  const baselineStart = Math.max(0, volumes.length - Math.min(20, volumes.length))
  const baselineEnd = Math.max(baselineStart, volumes.length - Math.min(3, volumes.length))
  const baselineVolume = average(volumes.slice(baselineStart, baselineEnd))
  const volumeRatio = baselineVolume > 0 ? recentVolume / baselineVolume : 1
  const volumeSignal = volumeRatio > 1.25
    ? 'expanding'
    : volumeRatio < 0.78
      ? 'shrinking'
      : 'normal'
  const trend = lastBar.close > ma5 && ma5 > ma10 && ma10 > ma20
    ? 'uptrend'
    : lastBar.close < ma5 && ma5 < ma10 && ma10 < ma20
      ? 'downtrend'
      : 'sideways'
  const summary = summarizeTechnical({
    close: lastBar.close,
    timeframe: lastBar.timeframe,
    trend,
    ma5,
    ma20,
    rsi6,
    volumeSignal,
    support,
    resistance,
  })

  return {
    symbol,
    ts: lastBar.ts,
    timeframe: lastBar.timeframe,
    trend,
    ma5,
    ma10,
    ma20,
    atr14,
    rsi6,
    macd: {
      dif: round(macdValue.dif, 3),
      dea: round(macdValue.dea, 3),
      hist: round(macdValue.hist, 3),
    },
    support,
    resistance,
    volumeSignal,
    bars: sortedBars.slice(-getTechnicalDisplayBarCount(lastBar.timeframe)),
    summary,
    riskNotes: buildRiskNotes(lastBar.close, support, resistance, atr14),
  }
}

function sma(values: number[], period: number): number {
  const slice = values.slice(-period)
  return average(slice)
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) {
    return []
  }
  const multiplier = 2 / (period + 1)
  const result: number[] = []
  let previous = values[0] ?? 0
  for (const value of values) {
    previous = result.length === 0
      ? value
      : (value - previous) * multiplier + previous
    result.push(previous)
  }
  return result
}

function macd(closes: number[]): { dif: number; dea: number; hist: number } {
  const ema12 = emaSeries(closes, Math.min(12, Math.max(2, closes.length)))
  const ema26 = emaSeries(closes, Math.min(26, Math.max(3, closes.length)))
  const difSeries = closes.map((_, index) => (ema12[index] ?? 0) - (ema26[index] ?? 0))
  const deaSeries = emaSeries(difSeries, 9)
  const dif = difSeries[difSeries.length - 1] ?? 0
  const dea = deaSeries[deaSeries.length - 1] ?? 0
  return {
    dif,
    dea,
    hist: (dif - dea) * 2,
  }
}

function rsi(closes: number[], period: number): number {
  const start = Math.max(1, closes.length - period)
  let gains = 0
  let losses = 0
  for (let index = start; index < closes.length; index += 1) {
    const current = closes[index] ?? 0
    const previous = closes[index - 1] ?? current
    const delta = current - previous
    if (delta >= 0) {
      gains += delta
    } else {
      losses += Math.abs(delta)
    }
  }
  if (losses === 0) {
    return gains === 0 ? 50 : 100
  }
  const rs = gains / losses
  return 100 - (100 / (1 + rs))
}

function atr(bars: MarketBar[], period: number): number {
  const trueRanges: number[] = []
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index]
    const previous = bars[index - 1]
    if (!current || !previous) {
      continue
    }
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ))
  }
  return average(trueRanges.slice(-period))
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function summarizeTechnical(input: {
  close: number
  timeframe: MarketBar['timeframe']
  trend: TechnicalSignal['trend']
  ma5: number
  ma20: number
  rsi6: number
  volumeSignal: TechnicalSignal['volumeSignal']
  support: number
  resistance: number
}): string {
  const unit = input.timeframe === '1y'
    ? '年'
    : input.timeframe === '1mo'
      ? '月'
      : isMinuteTimeframe(input.timeframe)
        ? '分'
        : '日'
  const position = input.close >= input.ma20
    ? `价格位于 20 ${unit}均线上方`
    : `价格位于 20 ${unit}均线下方`
  const momentum = input.rsi6 >= 70
    ? '短线动量偏热'
    : input.rsi6 <= 35
      ? '短线动量偏弱'
      : '短线动量中性'
  const volume = input.volumeSignal === 'expanding'
    ? '量能正在放大'
    : input.volumeSignal === 'shrinking'
      ? '量能收缩'
      : '量能正常'
  if (input.trend === 'uptrend') {
    return `${position}，均线多头排列，${momentum}，${volume}。关注 ${input.resistance} 附近压力。`
  }
  if (input.trend === 'downtrend') {
    return `${position}，均线空头排列，${momentum}，${volume}。优先观察 ${input.support} 支撑是否有效。`
  }
  return `${position}，结构偏震荡，${momentum}，${volume}。等待突破 ${input.resistance} 或跌破 ${input.support} 后再评估。`
}

function buildRiskNotes(close: number, support: number, resistance: number, atr14: number): string[] {
  return [
    `若收盘价跌破 ${support}，当前结构失效概率上升。`,
    `距离压力位 ${resistance} 过近时，不宜忽略冲高回落风险。`,
    `ATR14 为 ${atr14}，用于估计波动，不代表止损或收益承诺。`,
  ]
}

function isMinuteTimeframe(timeframe: MarketBar['timeframe']): boolean {
  return timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '30m' || timeframe === '60m'
}

function getTechnicalDisplayBarCount(timeframe: MarketBar['timeframe']): number {
  if (timeframe === '1m') {
    return 240
  }
  if (timeframe === '5m') {
    return 120
  }
  if (timeframe === '15m') {
    return 80
  }
  if (timeframe === '30m') {
    return 60
  }
  if (timeframe === '60m') {
    return 48
  }
  return 30
}

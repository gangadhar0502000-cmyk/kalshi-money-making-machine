import type { MidSample } from '../../types/crypto15m'
import { LAB } from './ruleConfig'

const store = new Map<string, MidSample[]>()

export function recordMid(ticker: string, mid: number, t = Date.now()): MidSample[] {
  const prev = store.get(ticker) ?? []
  const next = [...prev, { t, mid }]
  while (next.length > LAB.midHistoryMaxSamples) next.shift()
  store.set(ticker, next)
  return next
}

export function getMidHistory(ticker: string): MidSample[] {
  return store.get(ticker) ?? []
}

/**
 * Δ mid in probability points over lookbackMs (positive = mid rose).
 * When samples are sparse (e.g. 1-minute candles), lookback is expanded to
 * cover at least ~2 intervals so the rule can see a real move at data resolution.
 */
export function midMovePpFromHistory(
  hist: MidSample[],
  lookbackMs: number,
  now: number,
): number | null {
  if (!hist || hist.length < 2) return null

  let eff = lookbackMs
  if (hist.length >= 2) {
    const gaps: number[] = []
    for (let i = 1; i < hist.length; i++) {
      gaps.push(hist[i]!.t - hist[i - 1]!.t)
    }
    gaps.sort((a, b) => a - b)
    const med = gaps[Math.floor(gaps.length / 2)] ?? 60_000
    // Need ≥2 intervals so a 90s rule still sees a 1m-candle move
    eff = Math.max(lookbackMs, Math.floor(med * 2.05))
  }

  const cutoff = now - eff
  let oldest: MidSample | null = null
  for (const s of hist) {
    if (s.t >= cutoff) {
      oldest = s
      break
    }
  }
  if (!oldest) oldest = hist[0]!
  const newest = hist[hist.length - 1]!
  if (newest.t === oldest.t) return null
  return (newest.mid - oldest.mid) * 100
}

/** Δ mid in probability points over the last lookbackMs (positive = mid rose). */
export function midMovePp(ticker: string, lookbackMs: number, now = Date.now()): number | null {
  return midMovePpFromHistory(store.get(ticker) ?? [], lookbackMs, now)
}

export function clearMidHistory(): void {
  store.clear()
}

/** Replace in-memory trail for a ticker (used by backtester / demos). */
export function setMidHistory(ticker: string, samples: MidSample[]): void {
  store.set(ticker, samples.slice(-LAB.midHistoryMaxSamples))
}

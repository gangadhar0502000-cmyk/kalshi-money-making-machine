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

/** Δ mid in probability points over the last lookbackMs (positive = mid rose). */
export function midMovePp(ticker: string, lookbackMs: number, now = Date.now()): number | null {
  const hist = store.get(ticker)
  if (!hist || hist.length < 2) return null
  const cutoff = now - lookbackMs
  let oldest: MidSample | null = null
  for (const s of hist) {
    if (s.t >= cutoff) {
      oldest = s
      break
    }
  }
  // If nothing in window, use earliest sample still on record
  if (!oldest) oldest = hist[0]!
  const newest = hist[hist.length - 1]!
  if (newest.t === oldest.t) return null
  return (newest.mid - oldest.mid) * 100
}

export function clearMidHistory(): void {
  store.clear()
}

/**
 * DEMO synthetic paths — clearly labeled, for offline UI demos when Kalshi
 * history cannot be fetched. NOT real settlements. Do not treat as evidence.
 */
import type { BacktestSnapshot, HistoricalMarketWindow } from './types'

function path(
  openMs: number,
  mids: number[],
  spreadCents = 2,
  sizes = { bid: 200, ask: 200 },
): BacktestSnapshot[] {
  const windowMinutes = 15
  const closeMs = openMs + windowMinutes * 60_000
  return mids.map((mid, i) => {
    const t = openMs + (i + 1) * 60_000
    const half = spreadCents / 200
    const yesBid = Math.max(0.01, Math.min(0.98, mid - half))
    const yesAsk = Math.max(yesBid + 0.01, Math.min(0.99, mid + half))
    return {
      t,
      yesBid,
      yesAsk,
      midYes: (yesBid + yesAsk) / 2,
      spreadCents,
      last: mid,
      volume: 10_000,
      yesBidSize: sizes.bid,
      yesAskSize: sizes.ask,
      minutesElapsed: (t - openMs) / 60_000,
      minutesRemaining: (closeMs - t) / 60_000,
      windowMinutes,
    }
  })
}

/** Generate a fixed demo corpus that exercises vetoes + both signal rules. */
export function buildDemoWindows(seed = 42): HistoricalMarketWindow[] {
  const base = Date.UTC(2026, 8, 1, 12, 0, 0) + seed
  const out: HistoricalMarketWindow[] = []

  // Late sharp rises (≥12pp over ~2m) in last 4 minutes → late_fade PAPER_NO
  for (let i = 0; i < 8; i++) {
    const open = base + i * 20 * 60_000
    // quiet early, then +14pp / +16pp into late window
    const rise = [
      0.48, 0.49, 0.5, 0.5, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56,
      0.58, 0.72, 0.78, 0.8, 0.81,
    ]
    const settleNo = i % 2 === 0 // fade-to-NO wins on even
    out.push({
      ticker: `DEMO-LATE-RISE-${i}`,
      eventTicker: `DEMO-LATE-RISE-${i}`,
      seriesTicker: 'KXBTC15M',
      title: '[DEMO] BTC late-rise path',
      result: settleNo ? 'no' : 'yes',
      openTime: new Date(open).toISOString(),
      closeTime: new Date(open + 15 * 60_000).toISOString(),
      snapshots: path(open, rise, 2),
      dataKind: 'demo_synthetic',
    })
  }

  // Early sharp drops (≥8pp in first 3m) → early_momentum PAPER_NO
  for (let i = 0; i < 8; i++) {
    const open = base + (20 + i) * 20 * 60_000
    const drop = [
      0.58, 0.48, 0.4, 0.39, 0.4, 0.42, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.5, 0.5,
    ]
    out.push({
      ticker: `DEMO-EARLY-DROP-${i}`,
      eventTicker: `DEMO-EARLY-DROP-${i}`,
      seriesTicker: 'KXETH15M',
      title: '[DEMO] ETH early-drop path',
      result: i % 3 === 0 ? 'no' : 'yes', // PAPER_NO wins when settle no
      openTime: new Date(open).toISOString(),
      closeTime: new Date(open + 15 * 60_000).toISOString(),
      snapshots: path(open, drop, 2),
      dataKind: 'demo_synthetic',
    })
  }

  // Flat / quiet → mostly NO TRADE
  for (let i = 0; i < 8; i++) {
    const open = base + (40 + i) * 20 * 60_000
    const flat = Array.from({ length: 15 }, (_, j) => 0.5 + Math.sin(j + i) * 0.008)
    out.push({
      ticker: `DEMO-FLAT-${i}`,
      eventTicker: `DEMO-FLAT-${i}`,
      seriesTicker: 'KXSOL15M',
      title: '[DEMO] SOL quiet path',
      result: i % 2 === 0 ? 'yes' : 'no',
      openTime: new Date(open).toISOString(),
      closeTime: new Date(open + 15 * 60_000).toISOString(),
      snapshots: path(open, flat, 2),
      dataKind: 'demo_synthetic',
    })
  }

  // Wide spread / extreme late → vetoes
  for (let i = 0; i < 6; i++) {
    const open = base + (60 + i) * 20 * 60_000
    const extreme = [
      0.5, 0.55, 0.6, 0.7, 0.8, 0.88, 0.92, 0.94, 0.95, 0.96, 0.97, 0.97, 0.98, 0.98, 0.98,
    ]
    out.push({
      ticker: `DEMO-EXTREME-${i}`,
      eventTicker: `DEMO-EXTREME-${i}`,
      seriesTicker: 'KXDOGE15M',
      title: '[DEMO] extreme late / wide path',
      result: 'yes',
      openTime: new Date(open).toISOString(),
      closeTime: new Date(open + 15 * 60_000).toISOString(),
      snapshots: path(open, extreme, i < 3 ? 8 : 2, i >= 3 ? { bid: 20, ask: 15 } : { bid: 200, ask: 200 }),
      dataKind: 'demo_synthetic',
    })
  }

  return out
}

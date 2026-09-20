import liveFixture from '../../../fixtures/liveSettledCrypto15m.json'
import { buildDemoWindows } from './demoDataset'
import { windowsFromBundledFixture, type BundledSettledFixture } from './bundledSnapshot'
import { runBacktestEngine } from './engine'
import { fetchLiveHistoricalWindows } from './fetchHistory'
import type { BacktestResult, HistoricalMarketWindow, ProgressFn } from './types'

export type BacktestMode = 'auto' | 'live' | 'bundled' | 'demo'

function loadBundled(): {
  windows: HistoricalMarketWindow[]
  fixture: BundledSettledFixture
} {
  const fixture = liveFixture as BundledSettledFixture
  return { windows: windowsFromBundledFixture(fixture), fixture }
}

/**
 * REAL-first backtest runner.
 *
 * Priority: committed Kalshi settled+candles snapshot → live API → DEMO (labeled).
 * Auto never blocks on rate limits when REAL snapshot exists.
 */
export async function runCrypto15mBacktest(opts: {
  mode?: BacktestMode
  maxLiveMarkets?: number
  signal?: AbortSignal
  onProgress?: ProgressFn
}): Promise<BacktestResult> {
  const mode = opts.mode ?? 'bundled'
  const notes: string[] = []
  const { windows: bundled, fixture } = loadBundled()

  if (mode === 'demo') {
    opts.onProgress?.({ phase: 'Building DEMO synthetic paths', current: 1, total: 1 })
    return runBacktestEngine(buildDemoWindows(), {
      dataSourceLabel: 'DEMO synthetic paths (NOT real Kalshi history)',
      dataMode: 'demo_synthetic',
      notes: [
        'DEMO only — reconstructed toy mid paths with assigned settlements.',
        'Do not promote rules from DEMO. Past ≠ future. Kill losers.',
      ],
    })
  }

  if (mode === 'bundled' || mode === 'auto') {
    opts.onProgress?.({
      phase: 'Loading REAL Kalshi settled snapshot',
      current: 1,
      total: 1,
      detail: `${bundled.length} windows`,
    })
    if (bundled.length > 0) {
      notes.push(
        mode === 'auto'
          ? 'Auto selected REAL bundled snapshot (avoids live 429 stalls). Use “Live” to refresh.'
          : 'Bundled REAL Kalshi settled markets + 1-minute candlesticks.',
      )
      return runBacktestEngine(bundled, {
        dataSourceLabel: `REAL Kalshi snapshot (${fixture.fetchedAt}) — ${bundled.length} settled windows + 1m candles`,
        dataMode: 'bundled_live_snapshot',
        notes: [
          ...notes,
          fixture.note,
          `Series: ${(fixture.series ?? []).join(', ')}`,
          'Past ≠ future. Kill losers.',
        ],
      })
    }
    if (mode === 'bundled') {
      notes.push('Bundled REAL fixture empty — falling back to DEMO.')
      return runBacktestEngine(buildDemoWindows(), {
        dataSourceLabel: 'DEMO synthetic (bundled REAL empty)',
        dataMode: 'demo_synthetic',
        notes: [...notes, 'Past ≠ future. Kill losers.'],
      })
    }
    // auto with empty bundled → try live below
    notes.push('Bundled REAL empty — auto trying live API.')
  }

  // live (or auto with no bundled)
  opts.onProgress?.({
    phase: 'Fetching live settled markets',
    current: 0,
    total: opts.maxLiveMarkets ?? 12,
  })
  const { windows: liveWindows, errors } = await fetchLiveHistoricalWindows({
    maxMarkets: opts.maxLiveMarkets ?? 12,
    signal: opts.signal,
    onProgress: opts.onProgress,
  })
  if (errors.length) notes.push(`Live fetch: ${errors.slice(0, 5).join(' | ')}`)

  if (liveWindows.length > 0) {
    return runBacktestEngine(liveWindows, {
      dataSourceLabel: `LIVE Kalshi settled + 1m candlesticks (${liveWindows.length} windows)`,
      dataMode: 'live_history',
      notes: [...notes, 'Past ≠ future. Kill losers.'],
    })
  }

  if (bundled.length > 0) {
    notes.push('Live API empty/rate-limited — using bundled REAL snapshot.')
    return runBacktestEngine(bundled, {
      dataSourceLabel: `REAL Kalshi snapshot fallback (${bundled.length} windows)`,
      dataMode: 'bundled_live_snapshot',
      notes: [...notes, 'Past ≠ future. Kill losers.'],
    })
  }

  notes.push('No REAL Kalshi history — DEMO synthetic fallback only.')
  return runBacktestEngine(buildDemoWindows(), {
    dataSourceLabel: 'DEMO synthetic (no REAL Kalshi history)',
    dataMode: 'demo_synthetic',
    notes: [...notes, 'Past ≠ future. Kill losers.'],
  })
}

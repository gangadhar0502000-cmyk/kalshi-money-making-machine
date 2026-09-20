import type { HistoricalMarketWindow } from './types'
import { candlesToSnapshots, type RawCandle } from './candles'

/** Shape of src/fixtures/liveSettledCrypto15m.json */
export interface BundledSettledFixture {
  fetchedAt: string
  source: string
  note: string
  series: string[]
  markets: {
    ticker: string
    event_ticker: string
    series_ticker: string
    title: string
    result: 'yes' | 'no'
    open_time: string
    close_time: string
    candles: RawCandle[]
  }[]
}

export function windowsFromBundledFixture(
  fixture: BundledSettledFixture,
): HistoricalMarketWindow[] {
  const out: HistoricalMarketWindow[] = []
  for (const m of fixture.markets) {
    if (m.result !== 'yes' && m.result !== 'no') continue
    const snapshots = candlesToSnapshots(m.candles, m.open_time, m.close_time)
    if (snapshots.length < 3) continue
    out.push({
      ticker: m.ticker,
      eventTicker: m.event_ticker,
      seriesTicker: m.series_ticker,
      title: m.title,
      result: m.result,
      openTime: m.open_time,
      closeTime: m.close_time,
      snapshots,
      dataKind: 'bundled_live_snapshot',
    })
  }
  return out
}

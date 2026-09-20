import type { KalshiMarketRaw, KalshiMarketsResponse } from '../../../types/kalshi'
import { CRYPTO_15M_SERIES } from '../detect'
import { candlesToSnapshots, type RawCandle } from './candles'
import type { HistoricalMarketWindow, ProgressFn } from './types'

const LIVE_BASES = ['/api/kalshi', '/api/kalshi-ext'] as const

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  retries = 3,
): Promise<T | null> {
  for (let i = 0; i < retries; i++) {
    if (signal?.aborted) return null
    try {
      const res = await fetch(url, {
        signal,
        headers: { Accept: 'application/json' },
      })
      if (res.status === 429) {
        await sleep(Math.min(12_000, 3_000 * (i + 1)))
        continue
      }
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      await sleep(1_500 * (i + 1))
    }
  }
  return null
}

async function listSettled(
  series: string,
  limit: number,
  signal?: AbortSignal,
): Promise<KalshiMarketRaw[]> {
  const out: KalshiMarketRaw[] = []
  for (const base of LIVE_BASES) {
    let cursor: string | undefined
    let pages = 0
    while (out.length < limit && pages < 2) {
      pages++
      const q = new URLSearchParams({
        series_ticker: series,
        status: 'settled',
        limit: String(Math.min(50, limit - out.length)),
        mve_filter: 'exclude',
      })
      if (cursor) q.set('cursor', cursor)
      const data = await fetchJson<KalshiMarketsResponse>(
        `${base}/markets?${q}`,
        signal,
      )
      if (!data?.markets?.length) {
        if (pages === 1) break // try next base
        break
      }
      for (const m of data.markets) {
        if (m.result === 'yes' || m.result === 'no') out.push(m)
      }
      cursor = data.cursor
      if (!cursor) break
      await sleep(1_200)
    }
    if (out.length) return out
  }
  return out
}

async function fetchCandles(
  ticker: string,
  openIso: string,
  closeIso: string,
  signal?: AbortSignal,
): Promise<RawCandle[]> {
  const openTs = Math.floor(new Date(openIso).getTime() / 1000) - 30
  const closeTs = Math.floor(new Date(closeIso).getTime() / 1000) + 30
  for (const base of LIVE_BASES) {
    const q = new URLSearchParams({
      market_tickers: ticker,
      start_ts: String(openTs),
      end_ts: String(closeTs),
      period_interval: '1',
    })
    const data = await fetchJson<{
      markets?: { ticker?: string; candlesticks?: RawCandle[] }[]
    }>(`${base}/markets/candlesticks?${q}`, signal)
    const sticks = data?.markets?.[0]?.candlesticks
    if (sticks?.length) return sticks
    await sleep(1_500)
  }
  return []
}

/**
 * Pull settled crypto 15m markets + 1m candlesticks from Kalshi public API.
 * Rate-limited; returns whatever it can get before abort / caps.
 */
export async function fetchLiveHistoricalWindows(opts: {
  maxMarkets?: number
  seriesList?: readonly string[]
  signal?: AbortSignal
  onProgress?: ProgressFn
}): Promise<{ windows: HistoricalMarketWindow[]; errors: string[] }> {
  const maxMarkets = opts.maxMarkets ?? 40
  const seriesList = opts.seriesList ?? CRYPTO_15M_SERIES.slice(0, 5)
  const errors: string[] = []
  const windows: HistoricalMarketWindow[] = []

  opts.onProgress?.({
    phase: 'Listing settled markets',
    current: 0,
    total: maxMarkets,
  })

  const raws: KalshiMarketRaw[] = []
  for (const series of seriesList) {
    if (opts.signal?.aborted || raws.length >= maxMarkets) break
    try {
      const batch = await listSettled(series, maxMarkets - raws.length, opts.signal)
      raws.push(...batch)
      opts.onProgress?.({
        phase: `Listed ${series}`,
        current: raws.length,
        total: maxMarkets,
        detail: `${batch.length} settled`,
      })
    } catch (e) {
      errors.push(`${series}: ${e instanceof Error ? e.message : String(e)}`)
    }
    await sleep(800)
  }

  let i = 0
  for (const m of raws) {
    if (opts.signal?.aborted || windows.length >= maxMarkets) break
    i++
    opts.onProgress?.({
      phase: 'Fetching candlesticks',
      current: i,
      total: Math.min(raws.length, maxMarkets),
      detail: m.ticker,
    })
    try {
      const candles = await fetchCandles(m.ticker, m.open_time!, m.close_time, opts.signal)
      const snapshots = candlesToSnapshots(candles, m.open_time!, m.close_time)
      if (snapshots.length < 3) {
        errors.push(`${m.ticker}: thin candles (${snapshots.length})`)
        await sleep(800)
        continue
      }
      const seriesTicker = (m.event_ticker || m.ticker).split('-')[0]!.toUpperCase()
      windows.push({
        ticker: m.ticker,
        eventTicker: m.event_ticker,
        seriesTicker,
        title: m.title || m.ticker,
        result: m.result === 'no' ? 'no' : 'yes',
        openTime: m.open_time!,
        closeTime: m.close_time,
        snapshots,
        dataKind: 'live_api',
      })
    } catch (e) {
      errors.push(`${m.ticker}: ${e instanceof Error ? e.message : String(e)}`)
    }
    await sleep(1_200)
  }

  return { windows, errors }
}

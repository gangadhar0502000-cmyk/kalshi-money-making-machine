import type { BacktestSnapshot } from './types'

export interface RawCandle {
  end_period_ts: number
  volume_fp?: string
  open_interest_fp?: string
  price?: {
    open_dollars?: string
    close_dollars?: string
    high_dollars?: string
    low_dollars?: string
    mean_dollars?: string
    previous_dollars?: string
  }
  yes_bid?: {
    open_dollars?: string
    close_dollars?: string
    high_dollars?: string
    low_dollars?: string
  }
  yes_ask?: {
    open_dollars?: string
    close_dollars?: string
    high_dollars?: string
    low_dollars?: string
  }
}

function d(s: string | undefined | null): number {
  if (s == null || s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Convert Kalshi 1-minute candlesticks into rule-ready snapshots.
 * Mid = (yes_bid.close + yes_ask.close) / 2 when both present; else last/price close.
 */
export function candlesToSnapshots(
  candles: RawCandle[],
  openTimeIso: string,
  closeTimeIso: string,
): BacktestSnapshot[] {
  const openMs = new Date(openTimeIso).getTime()
  const closeMs = new Date(closeTimeIso).getTime()
  const windowMinutes = Math.max(1, Math.round((closeMs - openMs) / 60_000))

  const out: BacktestSnapshot[] = []
  for (const c of candles) {
    const t = c.end_period_ts * 1000
    // Skip empty post-settle shells
    const bid = d(c.yes_bid?.close_dollars)
    const ask = d(c.yes_ask?.close_dollars)
    const last = d(c.price?.close_dollars) || d(c.price?.previous_dollars)
    // Locked 0/1 with no last → skip
    if (bid <= 0 && ask >= 1 && last <= 0) continue
    if (bid <= 0 && ask <= 0 && last <= 0) continue

    let midYes = 0.5
    if (bid > 0 && ask > 0 && ask >= bid) midYes = (bid + ask) / 2
    else if (last > 0) midYes = last
    else if (bid > 0) midYes = bid
    else if (ask > 0 && ask < 1) midYes = ask

    const spreadCents =
      bid > 0 && ask > 0 && ask >= bid ? Math.max(0, (ask - bid) * 100) : 99

    const minutesElapsed = Math.max(0, (t - openMs) / 60_000)
    const minutesRemaining = Math.max(0, (closeMs - t) / 60_000)

    // Ignore candles well outside the window
    if (t < openMs - 90_000 || t > closeMs + 90_000) continue

    out.push({
      t,
      yesBid: bid,
      yesAsk: ask > 0 ? ask : Math.min(1, midYes + spreadCents / 200),
      midYes,
      spreadCents,
      last: last || midYes,
      volume: d(c.volume_fp),
      // Candles lack size; assume thick book for LIVE history unless spread vetoes.
      // Thin-book veto therefore mainly catches locked extremes + wide spreads on history.
      yesBidSize: 200,
      yesAskSize: 200,
      minutesElapsed,
      minutesRemaining,
      windowMinutes,
    })
  }

  out.sort((a, b) => a.t - b.t)
  return out
}

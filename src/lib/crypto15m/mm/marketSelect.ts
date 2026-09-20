/**
 * Pick / roll crypto 15m markets for paper MM. Pure helpers — no live orders.
 */

import type { Crypto15mMarket } from '../../../types/crypto15m'

/** True when the market is still tradeable (not closed/settled/past close_time). */
export function isMarketOpen(market: Crypto15mMarket, nowMs = Date.now()): boolean {
  const st = (market.status ?? '').toLowerCase()
  if (st === 'settled' || st === 'finalized' || st === 'determined' || st === 'closed') {
    return false
  }
  if (market.minutesRemaining <= 0) return false
  const closeMs = Date.parse(market.closeTime)
  if (Number.isFinite(closeMs) && nowMs >= closeMs) return false
  return true
}

function closeMs(m: Crypto15mMarket): number {
  const t = Date.parse(m.closeTime)
  return Number.isFinite(t) ? t : 0
}

/**
 * Prefer same underlying (asset), then the open market with the latest close_time
 * (newest 15m window). Returns null when no open market exists.
 */
export function pickBestOpenMarket(
  markets: Crypto15mMarket[],
  preferAsset?: string | null,
  nowMs = Date.now(),
): Crypto15mMarket | null {
  const open = markets.filter((m) => isMarketOpen(m, nowMs))
  if (open.length === 0) return null
  const asset = preferAsset?.toUpperCase()
  const pool = asset ? open.filter((m) => m.asset.toUpperCase() === asset) : open
  const list = pool.length > 0 ? pool : open
  return list.reduce((best, m) => (closeMs(m) >= closeMs(best) ? m : best))
}

/**
 * Decide whether to auto-roll away from `current`.
 * Rolls when current is closed/settled/expired OR a newer open same-asset
 * market (later close_time) appears in the feed.
 */
export function pickRollTarget(
  markets: Crypto15mMarket[],
  current: Crypto15mMarket | null,
  nowMs = Date.now(),
): Crypto15mMarket | null {
  if (!current) {
    return pickBestOpenMarket(markets, null, nowMs)
  }

  const fresh = markets.find((m) => m.ticker === current.ticker) ?? current
  const bestSame = pickBestOpenMarket(markets, fresh.asset, nowMs)
  const bestAny = pickBestOpenMarket(markets, null, nowMs)

  if (!isMarketOpen(fresh, nowMs)) {
    return bestSame ?? bestAny
  }

  // Newer window for same underlying already open
  if (
    bestSame &&
    bestSame.ticker !== fresh.ticker &&
    closeMs(bestSame) > closeMs(fresh)
  ) {
    return bestSame
  }

  return null
}

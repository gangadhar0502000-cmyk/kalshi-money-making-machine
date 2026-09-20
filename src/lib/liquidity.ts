import type { KalshiMarketRaw } from '../types/kalshi'
import { inferCategory, parseCount, parseDollars } from './format'

export interface LiquidityAssessment {
  midYes: number
  spreadCents: number
  volume: number
  volume24h: number
  openInterest: number
  yesBid: number
  yesAsk: number
  noBid: number
  noAsk: number
  last: number
  hasBook: boolean
  liquidityScore: number
  passed: boolean
  failReasons: string[]
  category: string
  isSports: boolean
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Baseline gate for non-sports markets */
export const LIQUIDITY_DEFAULTS = {
  minVolume: 5_000,
  minOpenInterest: 1_000,
  maxSpreadCents: 6,
  lockedLow: 0.03,
  lockedHigh: 0.97,
  preferredMidLow: 0.15,
  preferredMidHigh: 0.85,
} as const

/**
 * Sports need higher bars — thin sports totals at 7–13¢ with vol <500
 * are the classic false-"edge" trap from the old MVP.
 */
export const SPORTS_LIQUIDITY = {
  minVolume: 5_000,
  /** Alternate path: strong OI + tight book + mid band */
  altMinOpenInterest: 2_000,
  altMaxSpreadCents: 4,
  altMidLow: 0.2,
  altMidHigh: 0.8,
  maxSpreadCents: 5,
  lockedLow: 0.05,
  lockedHigh: 0.95,
} as const

function scoreLiquidity(volume: number, openInterest: number, volume24h: number): number {
  const v = Math.log10(Math.max(volume, 1))
  const oi = Math.log10(Math.max(openInterest, 1))
  const v24 = Math.log10(Math.max(volume24h, 1))
  const raw = (v / 5) * 45 + (oi / 5) * 35 + (v24 / 4) * 20
  return clamp(raw, 0, 100)
}

function scoreSpread(spreadCents: number, hasBook: boolean): number {
  if (!hasBook) return 0
  if (spreadCents <= 1) return 100
  if (spreadCents <= 2) return 90
  if (spreadCents <= 3) return 75
  if (spreadCents <= 5) return 55
  if (spreadCents <= 8) return 35
  return clamp(20 - (spreadCents - 8) * 2, 0, 20)
}

export function isSportsCategory(category: string, raw: KalshiMarketRaw): boolean {
  if (category === 'Sports') return true
  const blob = `${raw.ticker} ${raw.event_ticker} ${raw.title ?? ''} ${raw.category ?? ''}`.toUpperCase()
  return /NFL|NBA|MLB|NHL|NCAAF|NCAAB|SOCCER|UFC|SPORT|SUPER.?BOWL|AFC|NFC|MARCH.?MADNESS|KX[A-Z]*(GAME|MLB|NFL|NBA|NHL|NCAAF)/.test(
    blob,
  )
}

/**
 * Assess tradeability. Hard-excludes illiquid / locked / no-book markets.
 * Sports use higher volume / tighter-spread bars.
 */
export function assessLiquidity(raw: KalshiMarketRaw): LiquidityAssessment {
  const yesBid = parseDollars(raw.yes_bid_dollars ?? raw.yes_bid)
  const yesAsk = parseDollars(raw.yes_ask_dollars ?? raw.yes_ask)
  const noBid = parseDollars(raw.no_bid_dollars)
  const noAsk = parseDollars(raw.no_ask_dollars)
  const last = parseDollars(raw.last_price_dollars ?? raw.last_price)

  const hasBook = yesBid > 0 && yesAsk > 0 && yesAsk >= yesBid
  const midYes = hasBook ? (yesBid + yesAsk) / 2 : last > 0 ? last : 0.5
  const spreadCents = hasBook ? Math.max(0, (yesAsk - yesBid) * 100) : 99

  const volume = parseCount(raw.volume_fp ?? raw.volume)
  const volume24h = parseCount(raw.volume_24h_fp)
  const openInterest = parseCount(raw.open_interest_fp)

  const category = inferCategory(raw)
  const sports = isSportsCategory(category, raw)

  const liqRaw = scoreLiquidity(volume, openInterest, volume24h)
  const spreadScore = scoreSpread(spreadCents, hasBook)
  const liquidityScore = Math.round(liqRaw * 0.65 + spreadScore * 0.35)

  const failReasons: string[] = []
  const D = LIQUIDITY_DEFAULTS

  if (!hasBook) failReasons.push('No usable bid/ask book')

  if (sports) {
    const S = SPORTS_LIQUIDITY
    const volumeOk = volume >= S.minVolume
    const altOk =
      openInterest >= S.altMinOpenInterest &&
      spreadCents <= S.altMaxSpreadCents &&
      midYes >= S.altMidLow &&
      midYes <= S.altMidHigh &&
      hasBook

    if (!volumeOk && !altOk) {
      failReasons.push(
        `Sports liquidity: need volume ≥ ${S.minVolume.toLocaleString()} OR (OI ≥ ${S.altMinOpenInterest.toLocaleString()} + spread ≤ ${S.altMaxSpreadCents}¢ + mid 20–80¢); got vol ${Math.round(volume)}, OI ${Math.round(openInterest)}, spread ${spreadCents.toFixed(1)}¢`,
      )
    }
    if (spreadCents > S.maxSpreadCents) {
      failReasons.push(`Sports spread ${spreadCents.toFixed(1)}¢ > ${S.maxSpreadCents}¢`)
    }
    const lockedExtreme = midYes <= S.lockedLow || midYes >= S.lockedHigh
    if (lockedExtreme) {
      failReasons.push(
        `Sports near-locked mid ${Math.round(midYes * 100)}¢ — thin totals / settled junk`,
      )
    }
  } else {
    if (volume < D.minVolume) failReasons.push(`Volume ${Math.round(volume)} < ${D.minVolume}`)
    if (openInterest < D.minOpenInterest)
      failReasons.push(`Open interest ${Math.round(openInterest)} < ${D.minOpenInterest}`)
    if (spreadCents > D.maxSpreadCents)
      failReasons.push(`Spread ${spreadCents.toFixed(1)}¢ > ${D.maxSpreadCents}¢`)

    const lockedExtreme = midYes <= D.lockedLow || midYes >= D.lockedHigh
    if (lockedExtreme && (volume < D.minVolume * 5 || !hasBook || spreadCents > 3)) {
      failReasons.push(
        `Near-locked mid ${Math.round(midYes * 100)}¢ with thin depth (junk / settled book)`,
      )
    }

    if (
      (midYes < D.preferredMidLow || midYes > D.preferredMidHigh) &&
      liquidityScore < 55
    ) {
      failReasons.push(
        `Mid ${Math.round(midYes * 100)}¢ outside preferred 15–85¢ band with weak liquidity`,
      )
    }
  }

  return {
    midYes,
    spreadCents,
    volume,
    volume24h,
    openInterest,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    last,
    hasBook,
    liquidityScore,
    passed: failReasons.length === 0,
    failReasons,
    category,
    isSports: sports,
  }
}

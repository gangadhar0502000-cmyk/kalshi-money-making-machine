import type { KalshiMarketRaw } from '../types/kalshi'
import { parseCount, parseDollars } from './format'

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
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Hard defaults for "can you actually trade this?" */
export const LIQUIDITY_DEFAULTS = {
  minVolume: 2_000,
  minOpenInterest: 500,
  maxSpreadCents: 8,
  /** Locked / near-settled junk */
  lockedLow: 0.03,
  lockedHigh: 0.97,
  /** Prefer mid-priced research band */
  preferredMidLow: 0.15,
  preferredMidHigh: 0.85,
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

/**
 * Assess tradeability. Hard-excludes illiquid / locked / no-book markets.
 * Prefer mid-priced markets with real volume and tight spreads.
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

  const liqRaw = scoreLiquidity(volume, openInterest, volume24h)
  const spreadScore = scoreSpread(spreadCents, hasBook)
  const liquidityScore = Math.round(liqRaw * 0.65 + spreadScore * 0.35)

  const failReasons: string[] = []
  const D = LIQUIDITY_DEFAULTS

  if (!hasBook) failReasons.push('No usable bid/ask book')
  if (volume < D.minVolume) failReasons.push(`Volume ${Math.round(volume)} < ${D.minVolume}`)
  if (openInterest < D.minOpenInterest)
    failReasons.push(`Open interest ${Math.round(openInterest)} < ${D.minOpenInterest}`)
  if (spreadCents > D.maxSpreadCents)
    failReasons.push(`Spread ${spreadCents.toFixed(1)}¢ > ${D.maxSpreadCents}¢`)

  const lockedExtreme =
    midYes <= D.lockedLow || midYes >= D.lockedHigh
  if (lockedExtreme && (volume < D.minVolume * 5 || !hasBook || spreadCents > 3)) {
    failReasons.push(
      `Near-locked mid ${Math.round(midYes * 100)}¢ with thin depth (junk / settled book)`,
    )
  }

  // Soft preference: extreme mids outside 15–85 with mediocre liquidity still fail
  if (
    (midYes < D.preferredMidLow || midYes > D.preferredMidHigh) &&
    liquidityScore < 55
  ) {
    failReasons.push(
      `Mid ${Math.round(midYes * 100)}¢ outside preferred 15–85¢ band with weak liquidity`,
    )
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
  }
}

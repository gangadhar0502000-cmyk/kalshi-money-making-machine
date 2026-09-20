import type { KalshiMarketRaw } from '../../types/kalshi'
import type { Crypto15mMarket } from '../../types/crypto15m'
import { kalshiMarketUrl, parseCount, parseDollars } from '../format'
import { asDollarPrice } from './mm/prices'
import { feePerContract } from './fees'
import { extractAsset, seriesTickerFromEvent } from './detect'
import { LAB, THIN_BOOK_BLOCK } from './ruleConfig'

function minutesBetween(aIso: string | null | undefined, bIso: string): number {
  if (!aIso) return 15
  const a = new Date(aIso).getTime()
  const b = new Date(bIso).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 15
  return Math.max(0, (b - a) / 60_000)
}

export function normalizeCrypto15m(raw: KalshiMarketRaw, now = Date.now()): Crypto15mMarket {
  const yesBid = asDollarPrice(parseDollars(raw.yes_bid_dollars ?? raw.yes_bid), 'norm.yesBid')
  const yesAsk = asDollarPrice(parseDollars(raw.yes_ask_dollars ?? raw.yes_ask), 'norm.yesAsk')
  const noBid = asDollarPrice(parseDollars(raw.no_bid_dollars), 'norm.noBid')
  const noAsk = asDollarPrice(parseDollars(raw.no_ask_dollars), 'norm.noAsk')
  const last = asDollarPrice(parseDollars(raw.last_price_dollars ?? raw.last_price), 'norm.last')

  let midYes = 0
  if (yesBid > 0 && yesAsk > 0) midYes = (yesBid + yesAsk) / 2
  else if (yesBid > 0) midYes = yesBid
  else if (yesAsk > 0) midYes = yesAsk
  else if (last > 0) midYes = last
  else midYes = 0.5

  const spreadCents =
    yesBid > 0 && yesAsk > 0 ? Math.max(0, (yesAsk - yesBid) * 100) : 99

  const openTime = raw.open_time ?? null
  const closeTime = raw.close_time
  const windowMinutes = Math.max(1, Math.round(minutesBetween(openTime, closeTime)))
  const closeMs = new Date(closeTime).getTime()
  const openMs = openTime ? new Date(openTime).getTime() : closeMs - windowMinutes * 60_000
  const minutesRemaining = Math.max(0, (closeMs - now) / 60_000)
  const minutesElapsed = Math.max(0, (now - openMs) / 60_000)

  const yesBidSize = parseCount(raw.yes_bid_size_fp)
  const yesAskSize = parseCount(raw.yes_ask_size_fp)
  const volume = parseCount(raw.volume_fp ?? raw.volume)
  const volume24h = parseCount(raw.volume_24h_fp)
  const openInterest = parseCount(raw.open_interest_fp)

  const seriesTicker = seriesTickerFromEvent(raw.event_ticker || raw.ticker)
  const asset = extractAsset(seriesTicker, raw.title)

  const thinBook =
    spreadCents >= LAB.thinSpreadWarnCents ||
    (yesBidSize > 0 && yesBidSize < THIN_BOOK_BLOCK.minBidSize) ||
    (yesAskSize > 0 && yesAskSize < THIN_BOOK_BLOCK.minAskSize) ||
    midYes <= THIN_BOOK_BLOCK.lockedLow ||
    midYes >= THIN_BOOK_BLOCK.lockedHigh

  const floorStrikeRaw = raw.floor_strike
  const floorStrike =
    typeof floorStrikeRaw === 'number' && Number.isFinite(floorStrikeRaw)
      ? floorStrikeRaw
      : null

  return {
    ticker: raw.ticker,
    eventTicker: raw.event_ticker,
    seriesTicker,
    asset,
    title: raw.title || raw.ticker,
    status: raw.status,
    openTime,
    closeTime,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    midYes,
    spreadCents,
    last,
    volume,
    volume24h,
    openInterest,
    yesBidSize,
    yesAskSize,
    floorStrike,
    rulesPrimary: raw.rules_primary ?? '',
    kalshiUrl: kalshiMarketUrl(raw.ticker, raw.event_ticker),
    windowMinutes,
    minutesElapsed,
    minutesRemaining,
    feeEstimate1: feePerContract(midYes),
    thinBook,
    raw,
  }
}

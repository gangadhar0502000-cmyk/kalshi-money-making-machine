/**
 * Pure helpers for v1 feed status — kept separate for easy smoke tests.
 */
import {
  feedFreshnessTone,
  type ContinuousFeedSnapshot,
  type FeedFreshnessTone,
} from '../lib/crypto15m/mm/continuousFeed'
import type { Crypto15mMarket } from '../types/crypto15m'

export type V1LiveLabel = 'Live feed' | 'Degraded' | 'Offline'

export type V1FeedStatus = {
  marketCount: number
  proxyLabel: string
  /** Compact proxy chip: auth | public | connecting */
  proxyShort: string
  proxyOk: boolean
  /** Legacy longer label ("Feed ok 3s ago"). */
  feedAgeLabel: string
  /** Compact age for metric strip ("3s ago"). */
  feedAgeShort: string
  feedTone: FeedFreshnessTone
  liveLabel: V1LiveLabel
  stale: boolean
  refreshing: boolean
  lastError?: string
  everSucceeded: boolean
  /** Shortest minutesRemaining across open markets, or null. */
  nextCloseMins: number | null
}

const ASSET_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  BNB: 'BNB',
  XRP: 'XRP',
  BCH: 'Bitcoin Cash',
  TON: 'Toncoin',
  NEAR: 'NEAR',
  ZEC: 'Zcash',
  HYPE: 'Hyperliquid',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  LTC: 'Litecoin',
  DOT: 'Polkadot',
  MATIC: 'Polygon',
  PEPE: 'Pepe',
  SHIB: 'Shiba',
}

/** Seconds since lastSuccessAt (null if unknown). */
export function feedAgeSeconds(
  lastSuccessAt: string | undefined | null,
  nowMs: number = Date.now(),
): number | null {
  if (!lastSuccessAt) return null
  const t = Date.parse(lastSuccessAt)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((nowMs - t) / 1000))
}

/** "Feed ok 3s ago" / "Feed waiting…" / "Feed never". */
export function formatFeedOkLabel(
  lastSuccessAt: string | undefined | null,
  nowMs: number = Date.now(),
): string {
  const age = feedAgeSeconds(lastSuccessAt, nowMs)
  if (age == null) return 'Feed waiting…'
  return `Feed ok ${age}s ago`
}

/** Compact "3s ago" / "waiting…" for metric cards. */
export function formatFeedAgeShort(
  lastSuccessAt: string | undefined | null,
  nowMs: number = Date.now(),
): string {
  const age = feedAgeSeconds(lastSuccessAt, nowMs)
  if (age == null) return 'waiting…'
  return `${age}s ago`
}

export function liveLabelFromTone(tone: FeedFreshnessTone): V1LiveLabel {
  if (tone === 'ok') return 'Live feed'
  if (tone === 'amber') return 'Degraded'
  if (tone === 'red') return 'Offline'
  return 'Offline'
}

export function proxyHealthLabel(snap: ContinuousFeedSnapshot): {
  label: string
  short: string
  ok: boolean
} {
  if (!snap.everSucceeded) {
    return { label: 'Proxy: connecting…', short: 'connecting', ok: false }
  }
  if (snap.authenticated) {
    return { label: 'Proxy: ok (auth)', short: 'auth', ok: true }
  }
  return { label: 'Proxy: ok (public)', short: 'public', ok: true }
}

/** Shortest open-market minutes remaining, or null when empty. */
export function shortestMinutesLeft(markets: Crypto15mMarket[]): number | null {
  if (!markets.length) return null
  let min = Infinity
  for (const m of markets) {
    if (Number.isFinite(m.minutesRemaining) && m.minutesRemaining < min) {
      min = m.minutesRemaining
    }
  }
  return Number.isFinite(min) ? min : null
}

export function deriveV1FeedStatus(
  snap: ContinuousFeedSnapshot,
  nowMs: number = Date.now(),
): V1FeedStatus {
  const proxy = proxyHealthLabel(snap)
  const tone = feedFreshnessTone(snap.lastSuccessAt, nowMs)
  return {
    marketCount: snap.markets.length,
    proxyLabel: proxy.label,
    proxyShort: proxy.short,
    proxyOk: proxy.ok,
    feedAgeLabel: formatFeedOkLabel(snap.lastSuccessAt, nowMs),
    feedAgeShort: formatFeedAgeShort(snap.lastSuccessAt, nowMs),
    feedTone: tone,
    liveLabel: liveLabelFromTone(tone),
    stale: snap.stale,
    refreshing: snap.refreshing,
    lastError: snap.lastError,
    everSucceeded: snap.everSucceeded,
    nextCloseMins: shortestMinutesLeft(snap.markets),
  }
}

export function toneClass(tone: FeedFreshnessTone): string {
  if (tone === 'ok') return 'text-emerald-400'
  if (tone === 'amber') return 'text-amber-400'
  if (tone === 'red') return 'text-rose-400'
  return 'text-slate-500'
}

export function toneDotClass(tone: FeedFreshnessTone): string {
  if (tone === 'ok') return 'bg-emerald-400 shadow-emerald-400/50'
  if (tone === 'amber') return 'bg-amber-400 shadow-amber-400/50'
  if (tone === 'red') return 'bg-rose-400 shadow-rose-400/50'
  return 'bg-slate-500 shadow-slate-500/30'
}

export function fmtMinutesLeft(mins: number): string {
  if (mins <= 0) return 'closed'
  if (mins < 1) return `${Math.round(mins * 60)}s`
  const m = Math.floor(mins)
  const s = Math.round((mins - m) * 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/** Urgency text class when under 3 minutes left. */
export function timeUrgencyClass(mins: number): string {
  if (mins <= 0) return 'text-slate-500'
  if (mins < 1) return 'text-rose-300'
  if (mins < 3) return 'text-amber-300'
  return 'text-slate-200'
}

export function fmtPrice(dollars: number): string {
  if (!Number.isFinite(dollars)) return '—'
  return `${Math.round(dollars * 100)}¢`
}

/** Spread in cents from ask−bid (or market.spreadCents when finite). */
export function fmtSpreadCents(
  bid: number,
  ask: number,
  spreadCents?: number,
): string {
  if (Number.isFinite(spreadCents) && (spreadCents as number) >= 0) {
    return `${Math.round(spreadCents as number)}¢`
  }
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return '—'
  const cents = Math.round((ask - bid) * 100)
  if (!Number.isFinite(cents)) return '—'
  return `${cents}¢`
}

export function fmtSpot(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return '—'
  if (price >= 1000) {
    return price.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })
  }
  if (price >= 1) {
    return price.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
}

export function assetShortName(asset: string): string {
  const key = asset.trim().toUpperCase()
  return ASSET_NAMES[key] ?? asset
}

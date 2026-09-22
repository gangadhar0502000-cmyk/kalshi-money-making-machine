/**
 * Pure helpers for v1 feed status row — kept separate for easy smoke tests.
 */
import {
  feedFreshnessTone,
  type ContinuousFeedSnapshot,
  type FeedFreshnessTone,
} from '../lib/crypto15m/mm/continuousFeed'

export type V1FeedStatus = {
  marketCount: number
  proxyLabel: string
  proxyOk: boolean
  feedAgeLabel: string
  feedTone: FeedFreshnessTone
  stale: boolean
  refreshing: boolean
  lastError?: string
  everSucceeded: boolean
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

export function proxyHealthLabel(snap: ContinuousFeedSnapshot): {
  label: string
  ok: boolean
} {
  if (!snap.everSucceeded) {
    return { label: 'Proxy: connecting…', ok: false }
  }
  if (snap.authenticated) {
    return { label: 'Proxy: ok (auth)', ok: true }
  }
  return { label: 'Proxy: ok (public)', ok: true }
}

export function deriveV1FeedStatus(
  snap: ContinuousFeedSnapshot,
  nowMs: number = Date.now(),
): V1FeedStatus {
  const proxy = proxyHealthLabel(snap)
  return {
    marketCount: snap.markets.length,
    proxyLabel: proxy.label,
    proxyOk: proxy.ok,
    feedAgeLabel: formatFeedOkLabel(snap.lastSuccessAt, nowMs),
    feedTone: feedFreshnessTone(snap.lastSuccessAt, nowMs),
    stale: snap.stale,
    refreshing: snap.refreshing,
    lastError: snap.lastError,
    everSucceeded: snap.everSucceeded,
  }
}

export function toneClass(tone: FeedFreshnessTone): string {
  if (tone === 'ok') return 'text-emerald-400'
  if (tone === 'amber') return 'text-amber-400'
  if (tone === 'red') return 'text-rose-400'
  return 'text-slate-500'
}

export function fmtMinutesLeft(mins: number): string {
  if (mins <= 0) return 'closed'
  if (mins < 1) return `${Math.round(mins * 60)}s`
  const m = Math.floor(mins)
  const s = Math.round((mins - m) * 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export function fmtPrice(dollars: number): string {
  if (!Number.isFinite(dollars)) return '—'
  return `${Math.round(dollars * 100)}¢`
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

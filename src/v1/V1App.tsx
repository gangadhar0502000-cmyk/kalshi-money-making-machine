import { useEffect, useMemo, useState } from 'react'
import { useContinuousFeed } from './useContinuousFeed'
import { useSpotMap } from './useSpotMap'
import { normalizeSpotAsset } from '../lib/crypto15m/spot'
import {
  assetShortName,
  deriveV1FeedStatus,
  fmtMinutesLeft,
  fmtPrice,
  fmtSpot,
  fmtSpreadCents,
  timeUrgencyClass,
  toneClass,
  toneDotClass,
} from './feedStatus'

/**
 * Product-grade v1 feed-only UI. Paper / read-only.
 * No Lab tabs, Edge Finder, Paper MM, banners, or playbooks.
 */
export function V1App() {
  const snap = useContinuousFeed()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const status = useMemo(() => deriveV1FeedStatus(snap, nowMs), [snap, nowMs])
  const assets = useMemo(
    () => snap.markets.map((m) => m.asset),
    [snap.markets],
  )
  const spots = useSpotMap(assets)

  const nextCloseLabel =
    status.nextCloseMins == null ? '—' : fmtMinutesLeft(status.nextCloseMins)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-50 sm:text-2xl">
              Kalshi 15m
            </h1>
            <span className="rounded-full border border-slate-700/80 bg-slate-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              v1
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 sm:text-sm">
            Paper · read-only · never places trades
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span
            className={`live-pulse inline-block h-2 w-2 rounded-full shadow-[0_0_8px] ${toneDotClass(status.feedTone)}`}
            aria-hidden
          />
          <span
            className={`text-sm font-medium ${toneClass(status.feedTone)}`}
          >
            {status.liveLabel}
          </span>
          {status.stale && (
            <span className="rounded-md bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              stale
            </span>
          )}
          {status.refreshing && (
            <span className="rounded-md bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
              refreshing
            </span>
          )}
        </div>
      </header>

      {/* ── Metric strip ───────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:mb-6 sm:grid-cols-4">
        <MetricCard label="Open markets" value={String(status.marketCount)} />
        <MetricCard
          label="Feed age"
          value={status.feedAgeShort}
          valueClass={toneClass(status.feedTone)}
        />
        <MetricCard
          label="Proxy"
          value={status.proxyShort}
          valueClass={status.proxyOk ? 'text-emerald-300' : 'text-slate-400'}
        />
        <MetricCard
          label="Next close"
          value={nextCloseLabel}
          valueClass={
            status.nextCloseMins != null
              ? timeUrgencyClass(status.nextCloseMins)
              : 'text-slate-500'
          }
          mono
        />
      </div>

      {status.lastError && (
        <div
          className="mb-4 truncate rounded-xl border border-slate-800/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-500"
          title={status.lastError}
        >
          {status.lastError}
        </div>
      )}

      {/* ── Markets panel ──────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-slate-100">
              Open crypto 15m
            </h2>
            <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-300">
              {status.marketCount}
            </span>
          </div>
          <span className="hidden text-[11px] text-slate-600 sm:inline">
            YES book · spot optional
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-950/90 text-[10px] uppercase tracking-wider text-slate-500 backdrop-blur">
              <tr>
                <th className="px-4 py-2.5 font-medium sm:px-5">Asset</th>
                <th className="px-3 py-2.5 font-medium">Ticker</th>
                <th className="px-3 py-2.5 font-medium">Time left</th>
                <th className="px-3 py-2.5 font-medium">Bid</th>
                <th className="px-3 py-2.5 font-medium">Ask</th>
                <th className="px-3 py-2.5 font-medium">Mid</th>
                <th className="px-3 py-2.5 font-medium">Spread</th>
                <th className="px-3 py-2.5 pr-4 font-medium sm:pr-5">Spot</th>
              </tr>
            </thead>
            <tbody>
              {snap.markets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 sm:px-5">
                    <EmptyState
                      loading={!status.everSucceeded}
                      connecting={!status.proxyOk && !status.everSucceeded}
                    />
                  </td>
                </tr>
              ) : (
                snap.markets.map((m, i) => {
                  const canon = normalizeSpotAsset(m.asset)
                  const spot = canon ? (spots[canon] ?? null) : null
                  const zebra = i % 2 === 1 ? 'bg-slate-950/25' : ''
                  return (
                    <tr
                      key={m.ticker}
                      className={`border-t border-slate-800/50 transition-colors hover:bg-slate-800/40 ${zebra}`}
                    >
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-300 ring-1 ring-amber-500/20">
                            {m.asset}
                          </span>
                          <span className="text-sm text-slate-200">
                            {assetShortName(m.asset)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-500">
                        {m.ticker}
                      </td>
                      <td
                        className={`px-3 py-3 font-mono text-[13px] tabular-nums ${timeUrgencyClass(m.minutesRemaining)}`}
                      >
                        {fmtMinutesLeft(m.minutesRemaining)}
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] tabular-nums text-slate-300">
                        {fmtPrice(m.yesBid)}
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] tabular-nums text-slate-300">
                        {fmtPrice(m.yesAsk)}
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] tabular-nums font-medium text-emerald-300">
                        {fmtPrice(m.midYes)}
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] tabular-nums text-slate-400">
                        {fmtSpreadCents(m.yesBid, m.yesAsk, m.spreadCents)}
                      </td>
                      <td className="px-3 py-3 pr-4 font-mono text-[13px] tabular-nums text-slate-400 sm:pr-5">
                        {fmtSpot(spot)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="mt-8 flex flex-col items-center gap-1.5 text-center text-[11px] text-slate-600 sm:mt-10">
        <p>continuous proxy cache · 1s UI poll</p>
        <a
          href="?legacy=1"
          className="text-[10px] text-slate-700 transition hover:text-slate-500"
        >
          legacy
        </a>
      </footer>
    </div>
  )
}

function MetricCard({
  label,
  value,
  valueClass = 'text-slate-100',
  mono = false,
}: {
  label: string
  value: string
  valueClass?: string
  mono?: boolean
}) {
  return (
    <div className="panel px-3.5 py-3 sm:px-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-lg font-semibold tracking-tight ${mono ? 'font-mono tabular-nums' : ''} ${valueClass}`}
      >
        {value}
      </div>
    </div>
  )
}

function EmptyState({
  loading,
  connecting,
}: {
  loading: boolean
  connecting: boolean
}) {
  if (loading || connecting) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400/80" />
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400/60"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400/40"
            style={{ animationDelay: '300ms' }}
          />
        </div>
        <p className="text-sm font-medium text-slate-300">
          Connecting to proxy feed
        </p>
        <p className="max-w-xs text-xs text-slate-500">
          Markets appear as soon as the continuous cache answers.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <p className="text-sm font-medium text-slate-300">
        No open crypto 15m markets
      </p>
      <p className="max-w-xs text-xs text-slate-500">
        The feed is healthy — Kalshi just has no open 15-minute crypto windows
        right now.
      </p>
    </div>
  )
}

export default V1App

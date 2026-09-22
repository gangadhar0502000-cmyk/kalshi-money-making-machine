import { useEffect, useMemo, useState } from 'react'
import { useContinuousFeed } from './useContinuousFeed'
import { useSpotMap } from './useSpotMap'
import { normalizeSpotAsset } from '../lib/crypto15m/spot'
import {
  deriveV1FeedStatus,
  fmtMinutesLeft,
  fmtPrice,
  fmtSpot,
  toneClass,
} from './feedStatus'

/**
 * Clean v1 feed-only UI. Paper / read-only.
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
          Kalshi 15m · v1
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Paper / read-only · continuous feed · no trading
        </p>
      </header>

      <div className="panel mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <span className={status.proxyOk ? 'text-emerald-400' : 'text-slate-400'}>
          {status.proxyLabel}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-300">
          {status.marketCount} market{status.marketCount === 1 ? '' : 's'}
        </span>
        <span className="text-slate-600">·</span>
        <span className={`font-medium ${toneClass(status.feedTone)}`}>
          {status.feedAgeLabel}
        </span>
        {status.stale && (
          <>
            <span className="text-slate-600">·</span>
            <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-xs font-semibold text-amber-300">
              stale
            </span>
          </>
        )}
        {status.refreshing && (
          <>
            <span className="text-slate-600">·</span>
            <span className="rounded bg-sky-950/50 px-1.5 py-0.5 text-xs font-semibold text-sky-300">
              refreshing
            </span>
          </>
        )}
        {status.lastError && (
          <>
            <span className="text-slate-600">·</span>
            <span
              className="max-w-md truncate text-xs text-slate-500"
              title={status.lastError}
            >
              {status.lastError}
            </span>
          </>
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Asset / ticker</th>
                <th className="px-3 py-2.5 font-medium">Left</th>
                <th className="px-3 py-2.5 font-medium">YES bid / ask</th>
                <th className="px-3 py-2.5 font-medium">Mid</th>
                <th className="px-3 py-2.5 font-medium">Spot</th>
              </tr>
            </thead>
            <tbody>
              {snap.markets.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    {status.everSucceeded
                      ? 'No open crypto 15m markets right now.'
                      : 'Waiting for proxy feed…'}
                  </td>
                </tr>
              ) : (
                snap.markets.map((m) => {
                  const canon = normalizeSpotAsset(m.asset)
                  const spot = canon ? (spots[canon] ?? null) : null
                  return (
                    <tr
                      key={m.ticker}
                      className="border-t border-slate-800/80"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-baseline gap-2">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                            {m.asset}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {m.ticker}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-200">
                        {fmtMinutesLeft(m.minutesRemaining)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-300">
                        {fmtPrice(m.yesBid)} / {fmtPrice(m.yesAsk)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-emerald-300">
                        {fmtPrice(m.midYes)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-400">
                        {fmtSpot(spot)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="mt-8 text-center text-[11px] text-slate-600">
        v1 feed only ·{' '}
        <a
          href="?legacy=1"
          className="text-slate-500 underline decoration-slate-700 underline-offset-2 hover:text-slate-400"
        >
          legacy Lab
        </a>
      </footer>
    </div>
  )
}

export default V1App

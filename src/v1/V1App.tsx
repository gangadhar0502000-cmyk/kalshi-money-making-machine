import { useEffect, useMemo, useState } from 'react'
import { useContinuousFeed } from './useContinuousFeed'
import { useSpotMap } from './useSpotMap'
import { normalizeSpotAsset } from '../lib/crypto15m/spot'
import { getMidHistory } from '../lib/crypto15m/midHistory'
import type { Crypto15mMarket } from '../types/crypto15m'
import {
  assetShortName,
  deriveV1FeedStatus,
  fmtCountdownMmSs,
  fmtDeltaCents,
  fmtMinutesLeft,
  fmtPrice,
  fmtSpot,
  fmtSpreadCents,
  midDeltaCents,
  sparklinePolylinePoints,
  timeUrgencyClass,
  toneClass,
  toneDotClass,
  windowProgress,
} from './feedStatus'

type RailSort = 'time' | 'mid' | 'asset'

/**
 * Terminal-grade v1 feed console — market rail + focus pane.
 * Paper / read-only. No Lab, Edge Finder, or Paper MM.
 */
export function V1App() {
  const snap = useContinuousFeed()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [sort, setSort] = useState<RailSort>('time')

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const status = useMemo(() => deriveV1FeedStatus(snap, nowMs), [snap, nowMs])

  const markets = useMemo(() => {
    const list = [...snap.markets]
    if (sort === 'mid') {
      list.sort((a, b) => b.midYes - a.midYes)
    } else if (sort === 'asset') {
      list.sort((a, b) => a.asset.localeCompare(b.asset) || a.minutesRemaining - b.minutesRemaining)
    } else {
      list.sort((a, b) => a.minutesRemaining - b.minutesRemaining)
    }
    return list
  }, [snap.markets, sort])

  // Auto-select first market; keep selection if ticker still present
  useEffect(() => {
    if (markets.length === 0) {
      if (selectedTicker != null) setSelectedTicker(null)
      return
    }
    if (selectedTicker && markets.some((m) => m.ticker === selectedTicker)) return
    setSelectedTicker(markets[0]!.ticker)
  }, [markets, selectedTicker])

  const selected = useMemo(
    () => markets.find((m) => m.ticker === selectedTicker) ?? null,
    [markets, selectedTicker],
  )

  const assets = useMemo(() => snap.markets.map((m) => m.asset), [snap.markets])
  const spots = useSpotMap(assets)

  const liveShort =
    status.liveLabel === 'Live feed'
      ? 'Live'
      : status.liveLabel === 'Degraded'
        ? 'Degraded'
        : 'Offline'

  return (
    <div className="v1-console mx-auto flex min-h-screen max-w-7xl flex-col px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800/70 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <GeometricMark />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-slate-50 sm:text-base">
                Kalshi 15m
              </h1>
              <span className="rounded border border-slate-700/90 bg-slate-900/80 px-1.5 py-px text-[9px] font-bold uppercase tracking-widest text-slate-400">
                v1
              </span>
            </div>
            <p className="text-[10px] text-slate-600">Paper · read-only · never places trades</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-950/50 px-2 py-0.5">
            <span
              className={`live-pulse inline-block h-1.5 w-1.5 rounded-full shadow-[0_0_6px] ${toneDotClass(status.feedTone)}`}
              aria-hidden
            />
            <span className={`text-[11px] font-semibold ${toneClass(status.feedTone)}`}>
              {liveShort}
            </span>
            {status.stale && (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-400/90">
                stale
              </span>
            )}
            {status.refreshing && (
              <span className="text-[9px] font-semibold uppercase tracking-wide text-sky-400/90">
                sync
              </span>
            )}
          </span>
          <Pill label="age" value={status.feedAgeShort} valueClass={toneClass(status.feedTone)} />
          <Pill label="mkts" value={String(status.marketCount)} />
          <Pill
            label="proxy"
            value={status.proxyShort}
            valueClass={status.proxyOk ? 'text-emerald-300' : 'text-slate-500'}
          />
        </div>
      </header>

      {status.lastError && (
        <div
          className="mb-2 truncate rounded-md border border-slate-800/50 bg-slate-950/40 px-2.5 py-1 text-[10px] text-slate-500"
          title={status.lastError}
        >
          {status.lastError}
        </div>
      )}

      {/* ── Body: rail + focus ──────────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,38%)_minmax(0,62%)]">
        {/* Left: market rail */}
        <section className="panel flex min-h-[280px] flex-col overflow-hidden lg:min-h-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Markets
            </span>
            <div className="flex items-center gap-0.5 rounded-md bg-slate-950/60 p-0.5">
              {([
                ['time', 'Time'],
                ['mid', 'Mid'],
                ['asset', 'Asset'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                    sort === key
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {markets.length === 0 ? (
              <div className="px-3 py-10">
                <EmptyHint
                  loading={!status.everSucceeded}
                  connecting={!status.proxyOk && !status.everSucceeded}
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/40 py-0.5">
                {markets.map((m) => {
                  const hist = getMidHistory(m.ticker)
                  const delta = midDeltaCents(hist)
                  const selectedRow = m.ticker === selectedTicker
                  return (
                    <li key={m.ticker}>
                      <button
                        type="button"
                        onClick={() => setSelectedTicker(m.ticker)}
                        className={`rail-row group relative flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition ${
                          selectedRow ? 'rail-row--selected' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <span className="inline-flex min-w-[2.35rem] shrink-0 items-center justify-center rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-bold tracking-wide text-amber-300 ring-1 ring-amber-500/25">
                          {m.asset}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[12px] font-medium text-slate-200">
                              {assetShortName(m.asset)}
                            </span>
                            <span className="shrink-0 font-mono text-[15px] font-semibold tabular-nums text-emerald-300">
                              {fmtPrice(m.midYes)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <span
                              className={`font-mono text-[10px] tabular-nums ${timeUrgencyClass(m.minutesRemaining)}`}
                            >
                              {fmtMinutesLeft(m.minutesRemaining)}
                            </span>
                            <span className="font-mono text-[10px] tabular-nums text-slate-500">
                              {fmtPrice(m.yesBid)}–{fmtPrice(m.yesAsk)}
                              {delta != null && (
                                <span
                                  className={`ml-1.5 ${
                                    delta > 0
                                      ? 'text-emerald-400/80'
                                      : delta < 0
                                        ? 'text-rose-400/80'
                                        : 'text-slate-600'
                                  }`}
                                >
                                  {fmtDeltaCents(delta)}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Right: focus pane */}
        <section className="panel flex min-h-[320px] flex-col overflow-hidden lg:min-h-0">
          {selected ? (
            <FocusPane
              market={selected}
              spot={
                (() => {
                  const canon = normalizeSpotAsset(selected.asset)
                  return canon ? (spots[canon] ?? null) : null
                })()
              }
              nowMs={nowMs}
            />
          ) : (
            <FocusEmpty
              loading={!status.everSucceeded}
              connecting={!status.proxyOk && !status.everSucceeded}
            />
          )}
        </section>
      </div>

      <footer className="mt-3 flex items-center justify-between gap-3 text-[10px] text-slate-600">
        <span>continuous proxy · 1s poll · mid history local</span>
        <a href="?legacy=1" className="text-slate-800 transition hover:text-slate-600">
          legacy
        </a>
      </footer>
    </div>
  )
}

function FocusPane({
  market,
  spot,
  nowMs,
}: {
  market: Crypto15mMarket
  spot: number | null
  nowMs: number
}) {
  // Re-read on nowMs / market tick so sparkline fills as continuousFeed records
  void nowMs
  const hist = getMidHistory(market.ticker)
  const mids = hist.map((s) => s.mid)
  const sparkW = 420
  const sparkH = 72
  const points = sparklinePolylinePoints(mids, sparkW, sparkH)
  const winMins = market.windowMinutes > 0 ? market.windowMinutes : 15
  const progress = windowProgress(market.minutesRemaining, winMins)
  const delta = midDeltaCents(hist)

  return (
    <div className="flex flex-1 flex-col px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center rounded-md bg-amber-500/12 px-2 py-1 text-[11px] font-bold tracking-wide text-amber-300 ring-1 ring-amber-500/30">
            {market.asset}
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-100">
              {assetShortName(market.asset)}
            </div>
            <div className="font-mono text-[10px] text-slate-500">{market.ticker}</div>
          </div>
        </div>
        <div className="text-right">
          <div
            className={`font-mono text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl ${timeUrgencyClass(market.minutesRemaining)}`}
          >
            {fmtCountdownMmSs(market.minutesRemaining)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-600">time left</div>
        </div>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800/80">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            market.minutesRemaining < 3 ? 'bg-rose-400/80' : 'bg-emerald-500/70'
          }`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-center gap-4 sm:gap-8">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Bid</div>
          <div className="mt-0.5 font-mono text-lg tabular-nums text-slate-300 sm:text-xl">
            {fmtPrice(market.yesBid)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Mid</div>
          <div className="mt-0.5 font-mono text-5xl font-semibold tabular-nums tracking-tight text-emerald-300 sm:text-6xl">
            {fmtPrice(market.midYes)}
          </div>
          {delta != null && (
            <div
              className={`mt-1 font-mono text-xs tabular-nums ${
                delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-500'
              }`}
            >
              {fmtDeltaCents(delta)} session
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Ask</div>
          <div className="mt-0.5 font-mono text-lg tabular-nums text-slate-300 sm:text-xl">
            {fmtPrice(market.yesAsk)}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1 text-[11px] text-slate-500">
        <span>
          Spread{' '}
          <span className="font-mono text-slate-300">
            {fmtSpreadCents(market.yesBid, market.yesAsk, market.spreadCents)}
          </span>
        </span>
        <span>
          Spot <span className="font-mono text-slate-300">{fmtSpot(spot)}</span>
        </span>
        <span>
          Window <span className="font-mono text-slate-300">~{Math.round(winMins)}m</span>
        </span>
      </div>

      <div className="mt-auto pt-5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Mid history
          </span>
          <span className="font-mono text-[10px] text-slate-600">
            {mids.length} pt{mids.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="sparkline-wrap rounded-lg border border-slate-800/70 bg-slate-950/40 px-2 py-2">
          {points ? (
            <svg
              className="sparkline h-16 w-full sm:h-[72px]"
              viewBox={`0 0 ${sparkW} ${sparkH}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={points}
                className="text-emerald-400/90"
              />
            </svg>
          ) : (
            <div className="flex h-16 items-center justify-center text-[11px] text-slate-600 sm:h-[72px]">
              building history…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FocusEmpty({
  loading,
  connecting,
}: {
  loading: boolean
  connecting: boolean
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <GeometricMark large muted />
      {loading || connecting ? (
        <>
          <p className="text-sm font-medium text-slate-300">Connecting to proxy feed</p>
          <p className="max-w-xs text-xs text-slate-500">
            Select a market once the continuous cache answers — focus pane shows mid, clock, and
            sparkline.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-300">No open crypto 15m markets</p>
          <p className="max-w-xs text-xs text-slate-500">
            Feed is up — Kalshi has no open 15-minute crypto windows right now.
          </p>
        </>
      )}
    </div>
  )
}

function EmptyHint({
  loading,
  connecting,
}: {
  loading: boolean
  connecting: boolean
}) {
  if (loading || connecting) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex gap-1">
          <span className="h-1 w-1 animate-pulse rounded-full bg-sky-400/80" />
          <span
            className="h-1 w-1 animate-pulse rounded-full bg-sky-400/55"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="h-1 w-1 animate-pulse rounded-full bg-sky-400/35"
            style={{ animationDelay: '300ms' }}
          />
        </div>
        <p className="text-xs text-slate-500">Waiting for markets…</p>
      </div>
    )
  }
  return <p className="text-center text-xs text-slate-500">No open markets</p>
}

function Pill({
  label,
  value,
  valueClass = 'text-slate-200',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/50 px-2 py-0.5">
      <span className="text-[9px] uppercase tracking-wider text-slate-600">{label}</span>
      <span className={`font-mono text-[11px] font-medium tabular-nums ${valueClass}`}>{value}</span>
    </span>
  )
}

function GeometricMark({ large = false, muted = false }: { large?: boolean; muted?: boolean }) {
  const size = large ? 36 : 22
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={muted ? 'text-slate-700' : 'text-emerald-400'}
      aria-hidden
    >
      <path
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.5"
        d="M12 2.5 L20.5 8.5 L20.5 15.5 L12 21.5 L3.5 15.5 L3.5 8.5 Z"
      />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" />
    </svg>
  )
}

export default V1App

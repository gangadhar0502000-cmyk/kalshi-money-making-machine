import { useEffect, useMemo, useState } from 'react'
import type { Crypto15mMarket } from '../../types/crypto15m'
import { formatCents, formatDollars, formatRelativeTime } from '../../lib/format'
import { isAbortOnlyError } from '../../lib/crypto15m/labRefresh'
import { type PaperMmConfig } from '../../lib/crypto15m/mm/config'
import { paperMmEngine } from '../../lib/crypto15m/mm/engine'
import { paperMmPortfolio } from '../../lib/crypto15m/mm/portfolio'
import { formatPnlDual, isValidQuoteMid } from '../../lib/crypto15m/mm/prices'
import { fetchLocalHealth } from '../../lib/crypto15m/mm/liveBook'
import { pickMmUniverse, type MmFeedStatus } from '../../lib/crypto15m/mm/mmMarketFeed'
import {
  subscribeContinuousFeed,
  feedFreshnessTone,
} from '../../lib/crypto15m/mm/continuousFeed'
import type { MmEngineState } from '../../lib/crypto15m/mm/types'
import type { PortfolioState } from '../../lib/crypto15m/mm/portfolio'
import { parkStatusLabel } from '../../lib/crypto15m/mm/parkStatus'
import {
  isHarshFillRateSoftWarn,
  isHarshFillsPerHourReady,
} from '../../lib/crypto15m/mm/fillCaps'

interface Props {
  markets: Crypto15mMarket[]
  selectedTicker: string | null
  onSelect: (ticker: string) => void
  source: 'live' | 'demo'
}

function useEngineState(): MmEngineState {
  const [state, setState] = useState(() => paperMmEngine.getState())
  useEffect(() => paperMmEngine.subscribe(() => setState(paperMmEngine.getState())), [])
  return state
}

function usePortfolioState(): PortfolioState {
  const [state, setState] = useState(() => paperMmPortfolio.getState())
  useEffect(
    () => paperMmPortfolio.subscribe(() => setState(paperMmPortfolio.getState())),
    [],
  )
  return state
}

/** Session P&L rising too fast for strict fill rates → soft-sim warning. */
function isUnrealisticallyFastPnl(
  totalPnl: number,
  sessionStartedAt: number | null,
  strictRealism: boolean,
  baseFillProb: number,
): boolean {
  if (totalPnl < 8) return false
  if (!strictRealism || baseFillProb > 0.015) return true
  if (sessionStartedAt == null) return totalPnl >= 15
  const ageSec = Math.max(1, (Date.now() - sessionStartedAt) / 1000)
  const perMin = (totalPnl / ageSec) * 60
  return (totalPnl >= 10 && ageSec < 180) || perMin >= 5 || totalPnl >= 25
}

/**
 * Soft fill-rate warning from rolling 15m harsh fills only.
 * Short-session extrapolated /hr must never drive this banner.
 */
function isUnrealisticFillRate(
  harshFillsLast15m: number,
  strictRealism: boolean,
  activeBooks: number,
  maxFillsPerMarketPer15m: number,
): boolean {
  return isHarshFillRateSoftWarn(harshFillsLast15m, {
    strictRealism,
    activeBooks,
    maxFillsPerMarketPer15m,
  })
}


export function PaperMmPanel({ markets, selectedTicker, onSelect }: Props) {
  const singleState = useEngineState()
  const portfolioState = usePortfolioState()
  const [draft, setDraft] = useState<PaperMmConfig>(() => ({
    ...paperMmPortfolio.getConfig(),
  }))
  const [proxyOk, setProxyOk] = useState(false)
  /** null until first completed (non-abort) MM poll — Lab prop is fallback only then. */
  const [mmOwnedMarkets, setMmOwnedMarkets] = useState<Crypto15mMarket[] | null>(null)
  const [mmFeed, setMmFeed] = useState<MmFeedStatus>({ everSucceeded: false })

  const multiBook = draft.multiBook
  const s = singleState.snapshot
  const fills = singleState.fills
  const cancels = singleState.cancels

  // U1: continuous proxy feed (~1s) — lastOkAt updates on every successful poll incl. cache hits.
  useEffect(() => {
    const unsub = subscribeContinuousFeed((snap) => {
      if (snap.everSucceeded) {
        setMmOwnedMarkets(snap.markets)
      }
      setMmFeed({
        everSucceeded: snap.everSucceeded,
        lastOkAt: snap.lastSuccessAt,
        lastError: snap.lastError,
        stale: snap.stale,
        cacheAgeMs: snap.cacheAgeMs,
      })
    })
    // Tick relative-time labels every second so "ok Xs ago" stays honest while RUNNING.
    const tick = window.setInterval(() => {
      setMmFeed((prev) => ({ ...prev }))
    }, 1000)
    return () => {
      unsub()
      window.clearInterval(tick)
    }
  }, [])

  const mmMarkets = useMemo(
    () => pickMmUniverse(mmOwnedMarkets, markets),
    [mmOwnedMarkets, markets],
  )

  useEffect(() => {
    let alive = true
    const ping = async () => {
      const h = await fetchLocalHealth()
      if (alive) setProxyOk(Boolean(h?.ok))
    }
    void ping()
    const id = window.setInterval(() => void ping(), 5000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  const selected = useMemo(
    () => mmMarkets.find((m) => m.ticker === selectedTicker) ?? null,
    [mmMarkets, selectedTicker],
  )

  // Single-mode market sync
  useEffect(() => {
    if (multiBook) return
    paperMmEngine.setMarket(selected)
  }, [selected, multiBook])

  useEffect(() => {
    if (multiBook) return
    if (mmMarkets.length === 0) return
    const ticker = paperMmEngine.syncMarketUniverse(mmMarkets)
    if (ticker && ticker !== selectedTicker) {
      onSelect(ticker)
    }
  }, [mmMarkets, selectedTicker, onSelect, multiBook])

  useEffect(() => {
    if (multiBook) return
    if (selected) paperMmEngine.onMarketTick(selected)
  }, [selected, selected?.midYes, selected?.yesBid, selected?.yesAsk, multiBook])

  // Multi-mode universe sync — MM-owned list; rolls must never stop
  useEffect(() => {
    if (!multiBook) return
    paperMmPortfolio.syncMarketUniverse(mmMarkets)
    paperMmPortfolio.tryAutoResumeAfterSync()
  }, [mmMarkets, multiBook])

  // On mount: if persistence restored wasRunning before markets arrived, resume once synced
  useEffect(() => {
    if (!multiBook) return
    if (mmMarkets.length === 0) return
    paperMmPortfolio.tryAutoResumeAfterSync()
  }, [multiBook, mmMarkets.length])

  // Keep draft in sync when engine/portfolio applies presets
  useEffect(() => {
    const cfg = multiBook ? portfolioState.config : s.config
    setDraft({ ...cfg })
  }, [
    multiBook,
    s.config.strictRealism,
    s.config.baseFillProb,
    s.config.midCrossFillProb,
    s.config.fvQuoting,
    s.config.multiBook,
    s.config.maxActiveMarkets,
    portfolioState.config.strictRealism,
    portfolioState.config.fvQuoting,
    portfolioState.config.multiBook,
    portfolioState.config.maxActiveMarkets,
  ])

  const applyConfig = () => {
    if (multiBook) paperMmPortfolio.setConfig(draft)
    else paperMmEngine.setConfig(draft)
  }

  const setMultiBook = (on: boolean) => {
    setDraft((d) => ({ ...d, multiBook: on }))
    if (on) {
      paperMmEngine.stop()
      paperMmPortfolio.setConfig({ ...draft, multiBook: true })
      paperMmPortfolio.syncMarketUniverse(mmMarkets)
    } else {
      paperMmPortfolio.stop()
      paperMmEngine.setConfig({ ...draft, multiBook: false })
      if (selected) paperMmEngine.setMarket(selected)
    }
  }

  const running = multiBook ? portfolioState.running : s.running
  const moneyPrinterBug = multiBook
    ? portfolioState.aggregate.moneyPrinterBug
    : s.moneyPrinterBug
  const totalPnl = multiBook
    ? portfolioState.aggregate.realizedSpreadPnl +
      portfolioState.aggregate.unrealizedInventoryPnl
    : s.realizedSpreadPnl + s.unrealizedInventoryPnl
  const sessionFees = multiBook ? portfolioState.aggregate.feesPaid : s.feesPaid
  const sessionRealized = multiBook
    ? portfolioState.aggregate.realizedSpreadPnl
    : s.realizedSpreadPnl
  const feesDominatePnl =
    sessionFees > 0.01 && Math.abs(totalPnl) > 0 && sessionFees >= Math.abs(totalPnl) * 0.5
  const sessionStartedAt = multiBook ? portfolioState.sessionStartedAt : s.sessionStartedAt
  const cfg = multiBook ? portfolioState.config : s.config
  // Harsh-policy metrics — primary = rolling 15m; /hr gated until ≥15m clock.
  const harshFillsPerHour = multiBook
    ? portfolioState.aggregate.harshFillsPerHour
    : s.harshFillsPerHour
  const harshFillsLast15m = multiBook
    ? portfolioState.aggregate.harshFillsLast15m
    : s.harshFillsLast15m
  const harshPolicyEpochMs = multiBook
    ? portfolioState.aggregate.harshPolicyEpochMs
    : s.harshPolicyEpochMs
  const harshHourReady = isHarshFillsPerHourReady(harshPolicyEpochMs)
  const portfolioCap15m = multiBook
    ? portfolioState.aggregate.portfolioFillCap15m
    : Math.max(1, cfg.maxFillsPerMarketPer15m)
  const realizedDelta15m = multiBook
    ? portfolioState.aggregate.realizedDeltaLast15m
    : s.realizedDeltaLast15m
  const avgCaptureCents15m = multiBook
    ? portfolioState.aggregate.avgCaptureCentsPerFillLast15m
    : s.avgCaptureCentsPerFillLast15m
  const churnyFills =
    harshFillsLast15m >= 8 &&
    Math.abs(avgCaptureCents15m) < 0.5 &&
    Math.abs(realizedDelta15m) < 0.5
  const activeBookCount = multiBook
    ? Math.max(1, portfolioState.aggregate.activeBooks)
    : 1
  const showSoftWarn = isUnrealisticallyFastPnl(
    totalPnl,
    sessionStartedAt,
    cfg.strictRealism,
    cfg.baseFillProb,
  )
  const showFillRateWarn =
    (multiBook ? false : s.fillRateUnrealistic) ||
    isUnrealisticFillRate(
      harshFillsLast15m,
      cfg.strictRealism,
      activeBookCount,
      cfg.maxFillsPerMarketPer15m,
    )
  const message = multiBook ? portfolioState.message : s.message
  const activeTickers = multiBook
    ? new Set(
        portfolioState.books
          .map((b) => b.snapshot.marketTicker)
          .filter((t): t is string => Boolean(t)),
      )
    : new Set(s.marketTicker ? [s.marketTicker] : [])

  const guardLive = s.guardMode
    ? `${s.guardMode.toUpperCase()} · until ${new Date(s.guardActiveUntil).toLocaleTimeString()}`
    : 'clear'

  return (
    <div className="space-y-4 text-left">
      <div className="rounded-xl border border-rose-800/50 bg-rose-950/30 px-4 py-3 text-xs text-rose-100/95">
        <strong>Read-only API · never places trades.</strong> Near-real paper MM polls Kalshi L2
        via a local proxy (secrets stay server-side). On 15m, bots cancel faster — this teaches
        whether <em>YOUR</em> params survive. Fills require book depth / mid-walk (not random
        spam). Maker fee $0 on resting 15m; taker fee if you cross.{' '}
        <strong>Paper MM green ≠ live edge.</strong> Paper research only; positive P&amp;L not
        guaranteed. Demo market fixtures removed — online live feeds only.
      </div>

      <div className="rounded-xl border border-sky-800/40 bg-sky-950/30 px-4 py-3 text-xs text-sky-100/90">
        <strong>Wrong-spot bug fixed.</strong> Unknown assets no longer default to BTC spot (~$86k).
        Scan shows the real series asset (ZEC / HYPE / NEAR / …) and that asset&apos;s spot — or{' '}
        <em>no spot</em> / — if unsupported. Fake BTC FV edges on altcoins are gone. Still:{' '}
        <strong>paper green ≠ live edge</strong>.
      </div>

      <div className="rounded-xl border border-violet-800/40 bg-violet-950/25 px-4 py-3 text-xs text-violet-100/90">
        <strong>Multi-asset ≠ guaranteed profit.</strong> Quoting several crypto 15m books is more{' '}
        <em>shots at the same edge game</em> (FV vs mid), not independent lottery wins. Spots and
        mids are correlated across BTC/ETH/SOL/… — inventory risk stacks. Keep quoteSize /
        maxInventory small per book.
      </div>

      {moneyPrinterBug && (
        <div className="rounded-xl border-2 border-rose-500 bg-rose-600 px-4 py-4 text-base font-bold text-white shadow-lg shadow-rose-900/50">
          🛑 MONEY PRINTER BUG — paused
          <p className="mt-1 text-sm font-medium text-rose-100">
            |Δ Total P&amp;L| exceeded $1 in under 2 seconds. Quoting frozen. Hit Reset, then
            restart. Read-only API · never places trades.
          </p>
        </div>
      )}

      {showSoftWarn && !moneyPrinterBug && (
        <div className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-4 py-3 text-sm font-medium text-amber-100">
          ⚠ Sim too friendly / check fill rate — not live edge. Session P&amp;L rose unrealistically
          fast for a harsh paper book (or loose mode is on).
        </div>
      )}

      {showFillRateWarn && !moneyPrinterBug && (
        <div className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-4 py-3 text-sm font-medium text-amber-100">
          ⚠ Fill rate still high for paper research ({harshFillsLast15m} fills / last 15m · hard
          portfolio cap ≤{portfolioCap15m}
          {harshHourReady ? ` · ${harshFillsPerHour.toFixed(1)}/hr` : ''}). Soft warn only — new
          fills hard-block at cap. Legacy fills excluded. Paper green ≠ live edge.
        </div>
      )}

      {churnyFills && !moneyPrinterBug && (
        <div className="rounded-xl border border-amber-500/60 bg-amber-950/40 px-4 py-3 text-sm font-medium text-amber-100">
          ⚠ Fills rising but flat P&amp;L — likely round-trip churn at ~avgEntry (last 15m realized
          delta {formatDollars(realizedDelta15m)}, avg {avgCaptureCents15m.toFixed(2)}¢/fill). Churn
          filter is idle while quoting is paused (U3.0).
        </div>
      )}


      <div className="panel border border-violet-800/40 bg-violet-950/20 p-3 text-[11px] text-slate-300">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">
          Rules · paper MM playbook
        </p>
        <p className="mt-1 text-slate-400">
          <span className="font-mono text-amber-200">U3.0: paper quoting paused</span> — S1–S5 scenario playbook removed; awaiting new quote logic. Feed / L2 / inventory still run.
        </p>
      </div>

      {mmMarkets.length === 0 &&
        mmFeed.everSucceeded &&
        mmFeed.lastError &&
        !isAbortOnlyError(mmFeed.lastError) && (
        <div className="rounded-xl border-2 border-rose-500/70 bg-rose-950/45 px-4 py-3 text-sm font-semibold text-rose-100">
          🛑 LIVE-ONLY FAILURE — no markets. Demo fixtures removed. Start paper MM only when live
          Kalshi (proxy or public) returns open crypto 15m contracts.
          <p className="mt-1 text-xs font-normal text-rose-200/80" title={mmFeed.lastError}>
            {mmFeed.lastError}
          </p>
        </div>
      )}
      {mmMarkets.length === 0 && isAbortOnlyError(mmFeed.lastError) && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/90">
          MM feed transient abort — retrying (not LIVE-ONLY). Lab empty/abort does not block this
          panel while `/local-api/crypto15m` is healthy.
          {mmFeed.lastError ? (
            <p className="mt-1 text-xs font-normal text-amber-200/70" title={mmFeed.lastError}>
              {mmFeed.lastError}
            </p>
          ) : null}
        </div>
      )}

      {!multiBook && s.unitsWarning && (
        <div className="rounded-xl border border-rose-500/60 bg-rose-950/50 px-4 py-3 text-sm font-medium text-rose-100">
          ⚠ Units guard: {s.unitsWarning}
        </div>
      )}

      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">
              15m MM (Paper)
            </p>
            <h2 className="text-sm font-semibold text-slate-100">
              {multiBook
                ? 'Multi-book · scan all crypto 15m by |FV−mid|'
                : 'Spread capture sim · spot guard · settlement risk'}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
              Read-only API · never places trades
            </span>
            {(s.liveBook || proxyOk || portfolioState.books.some((b) => b.snapshot.liveBook)) && (
              <span
                className="rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
                title="L2 order book via local proxy — not the market-universe source"
              >
                L2 LIVE (proxy book)
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                mmMarkets.length > 0
                  ? 'bg-emerald-950 text-emerald-300'
                  : mmFeed.everSucceeded &&
                      mmFeed.lastError &&
                      !isAbortOnlyError(mmFeed.lastError)
                    ? 'bg-rose-950 text-rose-200'
                    : 'bg-slate-800 text-slate-300'
              }`}
              title="MM-owned market universe (proxy → public; independent of Lab banner)"
            >
              {mmMarkets.length > 0
                ? mmFeed.everSucceeded
                  ? 'LIVE markets (MM feed)'
                  : 'LIVE markets (Lab fallback)'
                : mmFeed.everSucceeded &&
                    mmFeed.lastError &&
                    !isAbortOnlyError(mmFeed.lastError)
                  ? 'LIVE-ONLY FAILURE'
                  : 'MM feed…'}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                (() => {
                  const tone = feedFreshnessTone(mmFeed.lastOkAt)
                  if (tone === 'ok') return 'bg-emerald-950 text-emerald-300'
                  if (tone === 'amber') return 'bg-amber-950 text-amber-200'
                  if (tone === 'red') return 'bg-rose-950 text-rose-200'
                  if (isAbortOnlyError(mmFeed.lastError)) return 'bg-amber-950 text-amber-200'
                  return 'bg-slate-800 text-slate-400'
                })()
              }`}
              title={
                mmFeed.lastError ??
                (mmFeed.stale
                  ? `MM feed stale · cacheAgeMs=${mmFeed.cacheAgeMs ?? '—'}`
                  : 'MM continuous feed (proxy cache)')
              }
            >
              {mmFeed.lastOkAt
                ? `MM feed ok ${formatRelativeTime(mmFeed.lastOkAt)}`
                : mmFeed.lastError
                  ? isAbortOnlyError(mmFeed.lastError)
                    ? 'MM abort soft'
                    : 'MM error'
                  : 'MM polling'}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                multiBook ? 'bg-violet-950 text-violet-200' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {multiBook
                ? `MULTI · ${portfolioState.aggregate.activeBooks}/${cfg.maxActiveMarkets}`
                : 'SINGLE'}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                cfg.strictRealism ? 'bg-slate-900 text-sky-300' : 'bg-amber-950 text-amber-200'
              }`}
            >
              {cfg.strictRealism ? 'STRICT realism' : 'LOOSE debug'}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                moneyPrinterBug
                  ? 'bg-rose-600 text-white'
                  : running
                    ? 'bg-violet-950 text-violet-200'
                    : 'bg-slate-800 text-slate-400'
              }`}
            >
              {moneyPrinterBug ? 'MONEY PRINTER BUG' : running ? 'RUNNING' : 'STOPPED'}
            </span>
          </div>
        </div>

        <p className="mt-2 text-xs text-slate-400">{message}</p>
        {!multiBook && (
          <p className="mt-1 font-mono text-[11px] text-violet-300/90">
            Active:{' '}
            <strong className="text-violet-200">{s.marketTicker ?? selectedTicker ?? '—'}</strong>
            {s.marketCloseTime && (
              <>
                {' '}
                · closes {new Date(s.marketCloseTime).toLocaleString()}
              </>
            )}
            {selected && (
              <>
                {' '}
                · {selected.minutesRemaining.toFixed(1)}m left · mid{' '}
                {(selected.midYes * 100).toFixed(0)}¢
              </>
            )}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-600"
              checked={multiBook}
              disabled={running}
              onChange={(e) => setMultiBook(e.target.checked)}
            />
            <span>
              <strong>Multi-book</strong> (default ON) — scan all open crypto 15m, quote up to
              maxActiveMarkets in parallel
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-600"
              checked={draft.strictRealism}
              onChange={(e) => {
                const strict = e.target.checked
                setDraft((d) => ({ ...d, strictRealism: strict }))
                if (multiBook) paperMmPortfolio.setStrictRealism(strict)
                else paperMmEngine.setStrictRealism(strict)
              }}
            />
            <span>
              <strong>Strict realism</strong> (default ON) — scarce maker fills (depth+touch,
              mid_walk off, 20s cooldown, per-min/15m caps), fees, settlement
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-600"
              checked={draft.fvQuoting}
              onChange={(e) => {
                const fvQuoting = e.target.checked
                setDraft((d) => ({ ...d, fvQuoting }))
                if (multiBook) paperMmPortfolio.setConfig({ fvQuoting })
                else paperMmEngine.setConfig({ fvQuoting })
              }}
            />
            <span>
              <strong>FV quoting</strong> (default ON) — center on spot/strike fair value + edge
              gate (vs mid-centered)
            </span>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {!multiBook && (
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-slate-400">
              Market
              <select
                className="input"
                value={s.marketTicker ?? selectedTicker ?? ''}
                onChange={(e) => onSelect(e.target.value)}
                disabled={s.running}
              >
                {mmMarkets.length === 0 && <option value="">No markets</option>}
                {mmMarkets.map((m) => (
                  <option key={m.ticker} value={m.ticker}>
                    {m.asset} · {m.ticker} · mid {(m.midYes * 100).toFixed(0)}¢ ·{' '}
                    {m.minutesRemaining.toFixed(1)}m left
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-end gap-2">
            {!running ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (multiBook) {
                    paperMmPortfolio.setConfig(draft)
                    paperMmPortfolio.syncMarketUniverse(mmMarkets)
                    paperMmPortfolio.start()
                  } else {
                    paperMmEngine.start()
                  }
                }}
              >
                Start paper MM
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (multiBook) paperMmPortfolio.stop()
                  else paperMmEngine.stop()
                }}
              >
                Stop
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (confirm('Reset paper session (cash, inventory, logs)?')) {
                  if (multiBook) {
                    paperMmPortfolio.resetSession()
                    setDraft({ ...paperMmPortfolio.getConfig() })
                  } else {
                    paperMmEngine.resetSession()
                    setDraft({ ...paperMmEngine.getConfig() })
                  }
                }
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Multi-book aggregate + scan */}
      {multiBook && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Active books"
              value={`${portfolioState.aggregate.activeBooks} / ${cfg.maxActiveMarkets}`}
              sub="cap = maxActiveMarkets"
            />
            <Stat
              label="SESSION Σ Cash"
              value={formatDollars(portfolioState.aggregate.cash)}
              sub="active books only (cash resets on new book)"
            />
            <Stat
              label="SESSION Σ Inventory"
              value={`${portfolioState.aggregate.inventoryNet > 0 ? '+' : ''}${portfolioState.aggregate.inventoryNet}`}
              sub="sum of live books"
            />
            <Stat
              label="SESSION Σ Unrealized"
              value={formatDollars(portfolioState.aggregate.unrealizedInventoryPnl)}
              tone={portfolioState.aggregate.unrealizedInventoryPnl >= 0 ? 'good' : 'bad'}
              sub="live books only"
            />
            <Stat
              label="SESSION Σ Realized"
              value={formatDollars(portfolioState.aggregate.realizedSpreadPnl)}
              tone={portfolioState.aggregate.realizedSpreadPnl >= 0 ? 'good' : 'bad'}
              sub="ledger + live books (survives rolls)"
            />
            <Stat
              label="SESSION Σ Fees"
              value={formatDollars(portfolioState.aggregate.feesPaid)}
              tone={
                feesDominatePnl
                  ? 'bad'
                  : portfolioState.aggregate.feesPaid > 0
                    ? 'warn'
                    : 'neutral'
              }
              sub={
                feesDominatePnl
                  ? `⚠ fees dominate |P&L| (realized ${formatDollars(sessionRealized)})`
                  : `vs realized ${formatDollars(sessionRealized)} · ledger + live`
              }
            />
            <Stat
              label="SESSION Σ Total P&L"
              value={formatPnlDual(totalPnl).dollars}
              sub={`${formatPnlDual(totalPnl).centsLabel} · fees ${formatDollars(sessionFees)} already in realized`}
              tone={totalPnl >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="SESSION Σ Fills"
              value={String(portfolioState.aggregate.fillCount)}
              sub={`${portfolioState.aggregate.cancelCount} cancels · session ledger`}
            />
            <Stat
              label="Harsh fills / last 15m"
              value={String(harshFillsLast15m)}
              tone={showFillRateWarn ? 'warn' : 'neutral'}
              sub={
                showFillRateWarn
                  ? `⚠ soft warn · hard block at ≤${portfolioCap15m}/15m portfolio`
                  : harshHourReady
                    ? `${harshFillsPerHour.toFixed(1)}/hr · ≤${cfg.maxFillsPerMinute}/min · ≤${cfg.maxFillsPerMarketPer15m}/ticker/15m · hard portfolio ≤${portfolioCap15m}`
                    : `hard ≤${portfolioCap15m}/15m · ≤${cfg.maxFillsPerMinute}/min · ≤${cfg.maxFillsPerMarketPer15m}/ticker/15m · /hr after 15m clock`
              }
            />
            <Stat
              label="Realized Δ / last 15m"
              value={formatDollars(realizedDelta15m)}
              tone={
                churnyFills
                  ? 'warn'
                  : realizedDelta15m >= 0
                    ? 'good'
                    : 'bad'
              }
              sub={
                churnyFills
                  ? `⚠ flat vs fills — avg ${avgCaptureCents15m.toFixed(2)}¢/fill (churn?)`
                  : `avg ${avgCaptureCents15m.toFixed(2)}¢/fill · capture on closes`
              }
            />
          </div>

          {feesDominatePnl && (
            <div className="rounded-xl border border-amber-600/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              <strong>Fee bleed warning:</strong> SESSION fees{' '}
              {formatDollars(sessionFees)} are ≥ 50% of |Total P&L|{' '}
              {formatDollars(Math.abs(totalPnl))}. Realized after fees:{' '}
              {formatDollars(sessionRealized)}. Likely crossing quotes / taker fees —
              maker-only mode should keep fees near $0. Paper only; not live edge.
            </div>
          )}

          <div className="panel p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              Open crypto 15m scan · ranked by |FV − mid|
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Quoting Y only when this ticker holds an active multi-book slot and at least one side
              passes minEdge + toxic guards. Correlated risk across assets.
            </p>
            <div className="mt-3 max-h-72 overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-950 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Asset</th>
                    <th className="px-2 py-1.5">Ticker</th>
                    <th className="px-2 py-1.5">FV</th>
                    <th className="px-2 py-1.5">Mid</th>
                    <th className="px-2 py-1.5">Edge ¢</th>
                    <th className="px-2 py-1.5">Spot</th>
                    <th className="px-2 py-1.5">Quoting</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolioState.scan.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-slate-600">
                        {portfolioState.aggregate.activeBooks > 0
                          ? 'No open markets in ranked feed — holding active slots until refresh/rollover (not releasing).'
                          : 'No open markets in feed — wait for refresh or check demo/live/proxy source.'}
                      </td>
                    </tr>
                  )}
                  {portfolioState.scan.map((row) => {
                    const book = portfolioState.books.find(
                      (b) => b.snapshot.marketTicker === row.ticker,
                    )
                    const quoting =
                      Boolean(book?.snapshot.quote?.active) &&
                      (book?.snapshot.quote?.bidActive || book?.snapshot.quote?.askActive)
                    const inSlot = activeTickers.has(row.ticker)
                    return (
                      <tr
                        key={row.ticker}
                        className={`border-t border-slate-800/80 ${
                          inSlot ? 'bg-violet-950/20' : ''
                        }`}
                      >
                        <td className="px-2 py-1.5 font-semibold text-slate-200">{row.asset}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px] text-slate-400">
                          {row.ticker}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-300">
                          {row.fairValue != null ? (
                            formatCents(row.fairValue)
                          ) : (
                            <span
                              className="text-slate-500"
                              title={
                                row.fvMissingReason === 'no_spot'
                                  ? 'no spot'
                                  : row.fvMissingReason === 'no_strike'
                                    ? 'no strike'
                                    : row.fvMissingReason === 'estimate_failed'
                                      ? 'FV estimate failed'
                                      : 'FV unavailable'
                              }
                            >
                              {row.fvMissingReason === 'no_spot'
                                ? 'no spot'
                                : row.fvMissingReason === 'no_strike'
                                  ? 'no strike'
                                  : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-300">
                          {isValidQuoteMid(row.mid) ? (
                            formatCents(row.mid)
                          ) : (
                            <span className="text-slate-500" title="Empty/invalid mid — no edge quoting">
                              —
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-2 py-1.5 font-mono ${
                            row.edgeCents == null
                              ? 'text-slate-500'
                              : Math.abs(row.edgeCents) >= cfg.minEdgeCents
                                ? 'text-emerald-300'
                                : 'text-amber-300'
                          }`}
                        >
                          {row.edgeCents != null
                            ? `${row.edgeCents >= 0 ? '+' : ''}${row.edgeCents.toFixed(1)}`
                            : !isValidQuoteMid(row.mid)
                              ? 'bad mid'
                              : row.fvMissingReason === 'no_spot'
                                ? 'no spot'
                                : row.fvMissingReason === 'no_strike'
                                  ? 'no strike'
                                  : '—'}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-400">
                          {row.spot != null
                            ? `$${row.spot.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          {quoting ? (
                            <span
                              className="rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
                              title={`${book?.snapshot.quote?.bidReason ?? ''} / ${book?.snapshot.quote?.askReason ?? ''}`}
                            >
                              {book?.snapshot.quote?.bidActive || book?.snapshot.quote?.askActive
                                ? 'Y'
                                : 'paused'}
                            </span>
                          ) : inSlot ? (
                            <span
                              className="rounded-full bg-amber-950 px-2 py-0.5 text-[10px] font-semibold text-amber-200"
                              title={`${book?.snapshot.quote?.bidReason ?? ''} / ${book?.snapshot.quote?.askReason ?? ''}`}
                            >
                              {parkStatusLabel({
                                bidReason: book?.snapshot.quote?.bidReason,
                                askReason: book?.snapshot.quote?.askReason,
                                centerMode: book?.snapshot.quote?.centerMode,
                                edgeCents:
                                  book?.snapshot.edgeVsMidCents ?? row.edgeCents,
                                fairValue: book?.snapshot.fairValue ?? row.fairValue,
                                maxSaneEdgeCents: cfg.maxSaneEdgeCents,
                              })}
                            </span>
                          ) : (
                            <span className="text-slate-600" title="Not in active multi-book slot">
                              N
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {portfolioState.books.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {portfolioState.books.map((b) => {
                const snap = b.snapshot
                const bookPnl = snap.realizedSpreadPnl + snap.unrealizedInventoryPnl
                return (
                  <div key={b.slotId} className="panel p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs font-semibold text-violet-200">
                        {snap.asset ?? '?'} · {snap.marketTicker ?? '—'}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          snap.quote?.active
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {snap.quote?.active ? 'QUOTING' : snap.settled ? 'SETTLED' : 'IDLE'}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <p className="text-slate-500">Inv</p>
                        <p className="font-mono text-slate-200">
                          {snap.inventory > 0 ? '+' : ''}
                          {snap.inventory}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Edge</p>
                        <p className="font-mono text-slate-200">
                          {snap.edgeVsMidCents != null
                            ? `${snap.edgeVsMidCents >= 0 ? '+' : ''}${snap.edgeVsMidCents.toFixed(1)}¢`
                            : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">LIVE book P&amp;L</p>
                        <p
                          className={`font-mono ${bookPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}
                        >
                          {formatDollars(bookPnl)}
                        </p>
                        <p className="text-[9px] text-slate-600">≠ SESSION Σ</p>
                      </div>
                    </div>
                    {snap.quote && (
                      <p className="mt-2 font-mono text-[11px] text-slate-400">
                        bid {formatCents(snap.quote.yesBid)}
                        {snap.quote.bidActive ? '' : ' OFF'} / ask{' '}
                        {formatCents(snap.quote.yesAsk)}
                        {snap.quote.askActive ? '' : ' OFF'} · {snap.quote.centerMode}
                        <br />
                        <span className="text-amber-200/90">
                          Quote status: paused (U3.0) — S1–S5 removed
                        </span>
                        <br />
                        <span className="text-violet-200/80">
                          {snap.quote.bidReason} · {snap.quote.askReason}
                        </span>
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Single-mode dashboard */}
      {!multiBook && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Cash" value={formatDollars(s.cash)} />
            <Stat
              label="Inventory (YES)"
              value={`${s.inventory > 0 ? '+' : ''}${s.inventory}`}
              sub={s.avgEntry != null ? `avg ${formatCents(s.avgEntry)}` : 'flat'}
            />
            <Stat
              label="Unrealized (inv)"
              value={formatDollars(s.unrealizedInventoryPnl)}
              tone={s.unrealizedInventoryPnl >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Realized (after fees)"
              value={formatDollars(s.realizedSpreadPnl)}
              tone={s.realizedSpreadPnl >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Fees paid"
              value={formatDollars(s.feesPaid)}
              tone={feesDominatePnl ? 'bad' : s.feesPaid > 0 ? 'warn' : 'neutral'}
              sub={
                feesDominatePnl
                  ? '⚠ fees dominate |P&L|'
                  : `vs realized ${formatDollars(s.realizedSpreadPnl)}`
              }
            />
            <Stat
              label="Total P&L"
              value={formatPnlDual(totalPnl).dollars}
              sub={`${formatPnlDual(totalPnl).centsLabel} · fees ${formatDollars(s.feesPaid)}`}
              tone={totalPnl >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Spot"
              value={
                s.spotPrice != null
                  ? `$${s.spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : '—'
              }
              sub={s.spotSource ?? 'polling…'}
            />
            <Stat label="Market mid" value={formatCents(s.midYes)} sub={`$${s.midYes.toFixed(4)}`} />
            <Stat
              label="Fair value"
              value={s.fairValue != null ? formatCents(s.fairValue) : '—'}
              sub={
                s.fvCenterActive
                  ? 'FV center ON'
                  : s.config.fvQuoting
                    ? 'FV required · both OFF'
                    : 'mid center (FV off)'
              }
            />
            <Stat
              label="Edge vs mid"
              value={
                s.edgeVsMidCents != null
                  ? `${s.edgeVsMidCents >= 0 ? '+' : ''}${s.edgeVsMidCents.toFixed(1)}¢`
                  : '—'
              }
              tone={
                s.edgeVsMidCents == null
                  ? 'neutral'
                  : Math.abs(s.edgeVsMidCents) >= s.config.minEdgeCents
                    ? 'good'
                    : 'warn'
              }
              sub={
                s.floorStrike != null
                  ? `strike ${s.floorStrike.toLocaleString()}`
                  : 'no floorStrike'
              }
            />
            <Stat
              label="Book BBO"
              value={
                s.bookBestBid != null && s.bookBestAsk != null
                  ? `${formatCents(s.bookBestBid)} / ${formatCents(s.bookBestAsk)}`
                  : '—'
              }
              sub={s.liveBook ? 'L2 live' : proxyOk ? 'proxy up · waiting' : 'proxy off'}
            />
            <Stat label="Spot guard" value={guardLive} tone={s.guardMode ? 'warn' : 'neutral'} />
            <Stat
              label="Mid-cross voids"
              value={String(s.midCrossRejectCount)}
              sub={`fill p=${s.config.midCrossFillProb}`}
            />
            <Stat
              label="Base fill p"
              value={s.config.baseFillProb.toFixed(4)}
              sub={s.config.applyFees ? 'fees ON' : 'fees OFF'}
            />
            <Stat
              label="Fills"
              value={String(s.fillCount)}
              sub={`${s.fillsLastMinute}/min · ${s.fillsLast15m}/15m rolling`}
            />
            <Stat
              label="Harsh fills / last 15m"
              value={String(s.harshFillsLast15m)}
              tone={showFillRateWarn ? 'warn' : 'neutral'}
              sub={
                showFillRateWarn
                  ? `⚠ still soft · cap ≤${cfg.maxFillsPerMarketPer15m}/15m`
                  : harshHourReady
                    ? `${s.harshFillsPerHour.toFixed(1)}/hr · ≤${cfg.maxFillsPerMinute}/min · ≤${cfg.maxFillsPerMarketPer15m}/15m`
                    : `≤${cfg.maxFillsPerMinute}/min · ≤${cfg.maxFillsPerMarketPer15m}/15m · /hr after 15m clock`
              }
            />
          </div>

          <div className="panel p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              Simulated quotes
            </p>
            {s.quote ? (
              <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-sm">
                <span className="text-emerald-300">
                  YES bid {formatCents(s.quote.yesBid)} × {s.quote.size}
                </span>
                <span className="text-slate-500">mid {formatCents(s.midYes)}</span>
                <span className="text-rose-300">
                  YES ask {formatCents(s.quote.yesAsk)} × {s.quote.size}
                </span>
                <span className="text-xs text-slate-500">
                  half {s.quote.halfSpreadCents.toFixed(1)}¢ · skew {s.quote.skewCents.toFixed(2)}¢ ·{' '}
                  {s.quote.centerMode === 'fv' ? 'FV center' : 'mid center'} ·{' '}
                  {s.quote.active ? 'ACTIVE' : 'CANCELLED'}
                </span>
                <span className="w-full text-[11px] text-violet-200/90">
                  {s.quote.bidReason} · {s.quote.askReason}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No quote — start the paper MM.</p>
            )}
          </div>
        </>
      )}

      {/* Config knobs */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Config knobs
          </p>
          <button type="button" className="btn btn-ghost !py-1 text-xs" onClick={applyConfig}>
            Apply
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Knob
            label="Max active markets (multi)"
            value={draft.maxActiveMarkets}
            step={1}
            min={1}
            max={12}
            onChange={(v) => setDraft((d) => ({ ...d, maxActiveMarkets: v }))}
          />
          <Knob
            label="Half-spread (¢)"
            value={draft.halfSpreadCents}
            step={0.5}
            min={0.5}
            max={20}
            onChange={(v) => setDraft((d) => ({ ...d, halfSpreadCents: v }))}
          />
          <Knob
            label="Size (contracts)"
            value={draft.quoteSize}
            step={1}
            min={1}
            max={100}
            onChange={(v) => setDraft((d) => ({ ...d, quoteSize: v }))}
          />
          <Knob
            label="Max inventory"
            value={draft.maxInventory}
            step={1}
            min={1}
            max={500}
            onChange={(v) => setDraft((d) => ({ ...d, maxInventory: v }))}
          />
          <Knob
            label="Spot move threshold (%)"
            value={draft.spotMovePct}
            step={0.01}
            min={0.01}
            max={5}
            onChange={(v) => setDraft((d) => ({ ...d, spotMovePct: v }))}
          />
          <Knob
            label="Spot move threshold ($)"
            value={draft.spotMoveDollars}
            step={1}
            min={1}
            max={5000}
            onChange={(v) => setDraft((d) => ({ ...d, spotMoveDollars: v }))}
          />
          <Knob
            label="Spot window (sec)"
            value={draft.spotWindowSec}
            step={1}
            min={1}
            max={120}
            onChange={(v) => setDraft((d) => ({ ...d, spotWindowSec: v }))}
          />
          <Knob
            label="Quote refresh (ms)"
            value={draft.quoteRefreshMs}
            step={100}
            min={200}
            max={30_000}
            onChange={(v) => setDraft((d) => ({ ...d, quoteRefreshMs: v }))}
          />
          <Knob
            label="Inv skew ¢ / unit"
            value={draft.inventorySkewCentsPerUnit}
            step={0.05}
            min={0}
            max={2}
            onChange={(v) => setDraft((d) => ({ ...d, inventorySkewCentsPerUnit: v }))}
          />
          <Knob
            label="Min open edge vs mid (¢)"
            value={draft.minEdgeCents}
            step={0.5}
            min={0}
            max={20}
            onChange={(v) => setDraft((d) => ({ ...d, minEdgeCents: v, openMinEdgeCents: v }))}
          />
          <Knob
            label="Open min edge (¢, unused while paused)"
            value={draft.openMinEdgeCents}
            step={0.5}
            min={0}
            max={20}
            onChange={(v) => setDraft((d) => ({ ...d, openMinEdgeCents: v }))}
          />
          <Knob
            label="Close profit min (¢, unused while paused)"
            value={draft.minCloseProfitCents}
            step={0.25}
            min={0}
            max={10}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                minCloseProfitCents: v,
                minChurnCaptureCents: v,
              }))
            }
          />
          <Knob
            label="Hard flat minutes"
            value={draft.hardFlatMinutes}
            step={0.5}
            min={0}
            max={10}
            onChange={(v) => setDraft((d) => ({ ...d, hardFlatMinutes: v }))}
          />
          <Knob
            label="Edge persist ticks"
            value={draft.edgePersistTicks}
            step={1}
            min={1}
            max={10}
            onChange={(v) => setDraft((d) => ({ ...d, edgePersistTicks: v }))}
          />
          <Knob
            label="Min maker capture (¢)"
            value={draft.minCaptureCents}
            step={0.5}
            min={0}
            max={10}
            onChange={(v) => setDraft((d) => ({ ...d, minCaptureCents: v }))}
          />
          <Knob
            label="Annual vol (FV)"
            value={draft.annualVol}
            step={0.05}
            min={0.05}
            max={3}
            onChange={(v) => setDraft((d) => ({ ...d, annualVol: v }))}
          />
          <Knob
            label="Toxicity bias"
            value={draft.toxicityBias}
            step={0.02}
            min={0}
            max={0.8}
            onChange={(v) => setDraft((d) => ({ ...d, toxicityBias: v }))}
          />
          <Knob
            label="Base fill prob / tick"
            value={draft.baseFillProb}
            step={0.001}
            min={0}
            max={0.5}
            onChange={(v) => setDraft((d) => ({ ...d, baseFillProb: v }))}
          />
          <Knob
            label="Mid-cross fill prob"
            value={draft.midCrossFillProb}
            step={0.05}
            min={0}
            max={1}
            onChange={(v) => setDraft((d) => ({ ...d, midCrossFillProb: v }))}
          />
          <Knob
            label="Fill cooldown (ms)"
            value={draft.fillCooldownMs}
            step={1000}
            min={0}
            max={120_000}
            onChange={(v) => setDraft((d) => ({ ...d, fillCooldownMs: v }))}
          />
          <Knob
            label="Min depth consumed"
            value={draft.minBookDepthConsumed}
            step={1}
            min={1}
            max={100}
            onChange={(v) => setDraft((d) => ({ ...d, minBookDepthConsumed: v }))}
          />
          <Knob
            label="Min touch polls"
            value={draft.minTouchPolls}
            step={1}
            min={1}
            max={30}
            onChange={(v) => setDraft((d) => ({ ...d, minTouchPolls: v }))}
          />
          <Knob
            label="Max fills / min"
            value={draft.maxFillsPerMinute}
            step={1}
            min={1}
            max={60}
            onChange={(v) => setDraft((d) => ({ ...d, maxFillsPerMinute: v }))}
          />
          <Knob
            label="Max fills / 15m"
            value={draft.maxFillsPerMarketPer15m}
            step={1}
            min={1}
            max={100}
            onChange={(v) => setDraft((d) => ({ ...d, maxFillsPerMarketPer15m: v }))}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.applyFees}
              onChange={(e) => setDraft((d) => ({ ...d, applyFees: e.target.checked }))}
            />
            Kalshi-style fees on fills
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.settleOnClose}
              onChange={(e) => setDraft((d) => ({ ...d, settleOnClose: e.target.checked }))}
            />
            Settlement risk (mark inv to 0/1 on close)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.allowMidWalk}
              onChange={(e) => setDraft((d) => ({ ...d, allowMidWalk: e.target.checked }))}
            />
            Allow mid_walk fills (OFF under strict — depth-only)
          </label>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Run <code className="text-slate-400">npm run dev:real</code> for LIVE BOOK (read-only
          proxy). Multi-book ranks every open crypto 15m by |FV−mid| and quotes up to{' '}
          <code className="text-slate-400">maxActiveMarkets</code> (default 5) with small size /
          inventory per book. Same-asset auto-roll; dead books free the slot. Maker fee $0 on
          resting 15m. Prices are dollars 0–1.
        </p>
      </div>

      {!multiBook && (
        <div className="grid gap-4 lg:grid-cols-2">
          <LogPanel
            title="Fills log"
            empty="No fills yet."
            rows={fills.map((f) => ({
              id: f.id,
              tone: f.reason === 'settlement' ? 'warn' : f.toxic ? 'bad' : 'neutral',
              primary: `${f.side === 'buy_yes' ? 'BUY YES' : 'SELL YES'} ${f.size} @ ${
                f.price === 0 || f.price === 1
                  ? f.price === 1
                    ? '1.00'
                    : '0.00'
                  : formatCents(f.price)
              }`,
              secondary: `${f.reason}${f.taker ? ' · TAKER' : ' · maker'}${f.toxic ? ' · TOXIC' : ''} · fee ${formatDollars(f.feeDollars)} · mid ${formatCents(f.midAtFill)} ($${f.midAtFill.toFixed(4)}) · ${new Date(f.t).toLocaleTimeString()}`,
            }))}
          />
          <LogPanel
            title="Spot-guard cancels"
            empty="No guard events yet."
            rows={cancels.map((c) => ({
              id: c.id,
              tone: c.action === 'cancel' ? 'bad' : 'warn',
              primary: `${c.action.toUpperCase()} · spot $${c.spotPrice.toFixed(2)}`,
              secondary: `${c.reason} · ${new Date(c.t).toLocaleTimeString()}`,
            }))}
          />
        </div>
      )}

      {multiBook &&
        (portfolioState.books.some((b) => b.fills.length > 0) ||
          portfolioState.sessionFills.length > 0) && (
        <LogPanel
          title="SESSION fills log (ledger + live books)"
          empty="No fills yet."
          rows={[
            ...portfolioState.sessionFills.slice(0, 12).map((f) => ({
              id: `session-${f.id}`,
              tone:
                f.reason === 'settlement' ? ('warn' as const) : f.toxic ? ('bad' as const) : ('neutral' as const),
              primary: `SESSION · ${f.side === 'buy_yes' ? 'BUY' : 'SELL'} ${f.size} @ ${formatCents(f.price)}`,
              secondary: `${f.reason} · ${new Date(f.t).toLocaleTimeString()}`,
            })),
            ...portfolioState.books.flatMap((b) =>
              b.fills.slice(0, 8).map((f) => ({
                id: `${b.slotId}-${f.id}`,
                tone:
                  f.reason === 'settlement'
                    ? ('warn' as const)
                    : f.toxic
                      ? ('bad' as const)
                      : ('neutral' as const),
                primary: `${b.snapshot.asset ?? '?'} · ${f.side === 'buy_yes' ? 'BUY' : 'SELL'} ${f.size} @ ${formatCents(f.price)}`,
                secondary: `${b.snapshot.marketTicker} · ${f.reason} · ${new Date(f.t).toLocaleTimeString()}`,
              })),
            ),
          ]}
        />
      )}

      {!multiBook && s.lastTickAt && (
        <p className="text-[11px] text-slate-600">
          Last engine tick {formatRelativeTime(new Date(s.lastTickAt).toISOString())}
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad' | 'warn' | 'neutral'
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'bad'
        ? 'text-rose-300'
        : tone === 'warn'
          ? 'text-amber-300'
          : 'text-slate-100'
  return (
    <div className="panel px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-mono text-sm font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  )
}

function Knob({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="label !mb-0.5">{label}</span>
      <input
        type="number"
        className="input"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      />
    </label>
  )
}

function LogPanel({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: { id: string; primary: string; secondary: string; tone: 'bad' | 'warn' | 'neutral' }[]
}) {
  return (
    <div className="panel p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-xs">
        {rows.length === 0 && <p className="text-slate-600">{empty}</p>}
        {rows.map((r) => (
          <div
            key={r.id}
            className={`rounded-lg border px-2 py-1.5 ${
              r.tone === 'bad'
                ? 'border-rose-900/50 bg-rose-950/20'
                : r.tone === 'warn'
                  ? 'border-amber-900/40 bg-amber-950/15'
                  : 'border-slate-800 bg-slate-950/40'
            }`}
          >
            <p className="font-medium text-slate-200">{r.primary}</p>
            <p className="text-[10px] text-slate-500">{r.secondary}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

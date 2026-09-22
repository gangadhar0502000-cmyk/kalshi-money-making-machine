import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Crypto15mMarket,
  ExperimentSuggestion,
  PaperJournalEntry,
} from '../../types/crypto15m'
import { fetchCrypto15mMarkets, fetchMarketByTicker, isAbortReason } from '../../lib/crypto15m/api'
import {
  clearJournal,
  computeRuleStats,
  loadJournal,
  markOutcome,
  takePaperSuggestion,
} from '../../lib/crypto15m/journal'
import { LAB } from '../../lib/crypto15m/ruleConfig'
import { formatRelativeTime } from '../../lib/format'
import { CryptoMarketFeed } from './CryptoMarketFeed'
import { LiveContextPanel } from './LiveContextPanel'
import { PaperJournalPanel } from './PaperJournalPanel'
import { RuleExperimentsPanel } from './RuleExperimentsPanel'
import { BacktestPanel } from './BacktestPanel'
import { PaperMmPanel } from './PaperMmPanel'
import { pickBestOpenMarket, pickRollTarget } from '../../lib/crypto15m/mm/marketSelect'
import { isAbortOnlyError, shouldApplyLabRefresh } from '../../lib/crypto15m/labRefresh'

type LabTab = 'lab' | 'backtest' | 'mm'

export function Crypto15mLab() {
  const [tab, setTab] = useState<LabTab>('lab')
  const [loading, setLoading] = useState(true)
  const [markets, setMarkets] = useState<Crypto15mMarket[]>([])
  const [source, setSource] = useState<'live' | 'demo' | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [fetchedAt, setFetchedAt] = useState<string | undefined>()
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [entries, setEntries] = useState<PaperJournalEntry[]>(() => loadJournal())
  const [nowTick, setNowTick] = useState(0)
  const [lastAttemptAt, setLastAttemptAt] = useState<string | undefined>()
  const lastMarketsRef = useRef<Crypto15mMarket[]>([])
  const sourceRef = useRef<'live' | 'demo' | null>(null)
  /** Single-flight: overlapping polls must not abort a healthy in-flight live fetch. */
  const inFlightRef = useRef(false)
  const inFlightStartedAtRef = useRef(0)
  const pollGenRef = useRef(0)
  /** AbortController for the active fetch — force refresh aborts this. */
  const fetchAbortRef = useRef<AbortController | null>(null)

  const IN_FLIGHT_WATCHDOG_MS = 45_000

  const countOpenMarkets = (list: Crypto15mMarket[], nowMs = Date.now()) =>
    list.filter((m) => {
      // Prefer live countdown from closeTime so stale minutesRemaining cannot lie.
      const closeMs = Date.parse(m.closeTime)
      if (Number.isFinite(closeMs)) return closeMs - nowMs > 0
      return m.minutesRemaining > 0
    }).length

  const refresh = useCallback(async (opts?: { signal?: AbortSignal; force?: boolean }) => {
    const force = opts?.force === true
    const externalSignal = opts?.signal

    // Invalidate + abort an in-flight generation so its finally cannot clear our mutex.
    const abortInFlight = () => {
      pollGenRef.current += 1 // stale finally: gen !== pollGen → skip mutex clear
      fetchAbortRef.current?.abort()
      fetchAbortRef.current = null
      inFlightRef.current = false
      inFlightStartedAtRef.current = 0
    }

    // Watchdog: wedged mutex from hung fetch / Strict Mode race → clear and continue.
    if (
      inFlightRef.current &&
      inFlightStartedAtRef.current > 0 &&
      Date.now() - inFlightStartedAtRef.current > IN_FLIGHT_WATCHDOG_MS
    ) {
      abortInFlight()
    }

    // Force path (Refresh now): abort any in-flight fetch, clear mutex, start fresh.
    if (force && inFlightRef.current) {
      abortInFlight()
    }

    // Mutex / coalesce: if a fetch is already in flight, skip this poll tick.
    // Never abort a healthy in-flight live fetch just because pollIntervalMs fired.
    if (inFlightRef.current) return
    inFlightRef.current = true
    inFlightStartedAtRef.current = Date.now()
    const gen = ++pollGenRef.current

    const ac = new AbortController()
    fetchAbortRef.current = ac
    const onExternalAbort = () => ac.abort()
    if (externalSignal) {
      if (externalSignal.aborted) ac.abort()
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
    const signal = ac.signal

    setLoading(true)
    setLastAttemptAt(new Date().toISOString())
    try {
      const result = await fetchCrypto15mMarkets(signal)
      // Strict Mode / effect cleanup abort — never LIVE-ONLY, never wipe live universe.
      if (signal.aborted) return
      // Stale completion after a newer refresh started (force/watchdog bumped gen).
      if (gen !== pollGenRef.current) return

      const nowMs = Date.now()
      const lastOpenCount = countOpenMarkets(lastMarketsRef.current, nowMs)

      // Never wipe a good LIVE universe with a transient empty refresh (rollover gap).
      // LIVE-ONLY: demo fixtures are never applied. Settled-only → apply empty.
      const decision = shouldApplyLabRefresh({
        prevSource: sourceRef.current,
        next: result,
        lastMarketsLen: lastMarketsRef.current.length,
        lastOpenCount,
      })
      let marketsForPick = lastMarketsRef.current
      if (decision === 'ignore') {
        // Abort-only cold start / quiet empty — leave universe untouched.
        if (result.error && !isAbortOnlyError(result.error)) {
          setError(result.error)
        }
        return
      }
      if (decision === 'keep-last') {
        marketsForPick = lastMarketsRef.current
        // Still bump attempt time so UI shows polling even on keep-last.
        setLastAttemptAt(new Date().toISOString())
        // Never paint LIVE-ONLY FAILURE for abort-only empties while keeping last.
        if (isAbortOnlyError(result.error)) {
          setError('Empty feed — keeping last markets; retrying…')
        } else {
          setError(
            (result.error ? result.error + ' · ' : '') +
              'Empty feed — keeping last markets; retrying…',
          )
        }
      } else {
        lastMarketsRef.current = result.markets
        setMarkets(result.markets)
        setSource(result.source)
        sourceRef.current = result.source
        setError(result.error)
        setFetchedAt(result.fetchedAt)
        marketsForPick = result.markets
      }

      setSelectedTicker((prev) => {
        const current = prev ? marketsForPick.find((m) => m.ticker === prev) ?? null : null
        const roll = pickRollTarget(marketsForPick, current)
        if (roll) return roll.ticker
        if (prev && !current) {
          return pickBestOpenMarket(marketsForPick)?.ticker ?? prev
        }
        if (prev && current) return prev
        return pickBestOpenMarket(marketsForPick)?.ticker ?? marketsForPick[0]?.ticker ?? null
      })
    } catch (e) {
      if (signal.aborted || isAbortReason(e, signal)) return
      setError(
        `Refresh failed: ${e instanceof Error ? e.message : String(e)} — retrying…`,
      )
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      if (fetchAbortRef.current === ac) fetchAbortRef.current = null
      // Always clear mutex for the active generation (force bumps gen so stale finally stays quiet).
      if (gen === pollGenRef.current) {
        inFlightRef.current = false
        inFlightStartedAtRef.current = 0
      }
      if (!signal.aborted || force) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void refresh({ signal: ac.signal })
    return () => {
      ac.abort()
      fetchAbortRef.current?.abort()
    }
  }, [refresh])

  // Poll for mid history + countdown freshness — never aborts an in-flight fetch
  // (unless watchdog cleared a wedged mutex).
  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh() // single-flight skip if busy
      setNowTick((n) => n + 1)
    }, LAB.pollIntervalMs)
    return () => window.clearInterval(id)
  }, [refresh])

  // Try to auto-resolve pending journal entries when markets settle
  useEffect(() => {
    const pending = entries.filter((e) => e.outcome === 'pending')
    if (pending.length === 0) return
    const ac = new AbortController()
    ;(async () => {
      let changed = false
      for (const e of pending) {
        if (ac.signal.aborted) return
        const closeMs = new Date(e.closeTime).getTime()
        if (Date.now() < closeMs + 30_000) continue
        const raw = await fetchMarketByTicker(e.marketTicker, ac.signal)
        if (!raw) continue
        const result = raw.result
        if (result === 'yes' || result === 'no') {
          markOutcome(e.id, result)
          changed = true
        }
      }
      if (changed) setEntries(loadJournal())
    })()
    return () => ac.abort()
  }, [entries, nowTick])

  const selected = useMemo(
    () => markets.find((m) => m.ticker === selectedTicker) ?? null,
    [markets, selectedTicker],
  )

  const stats = useMemo(() => computeRuleStats(entries), [entries])

  const handleTake = (suggestion: ExperimentSuggestion, market: Crypto15mMarket) => {
    const ok = confirm(
      `Log PAPER ${suggestion.side} on ${market.ticker}?\n\n` +
        `Rule: ${suggestion.ruleId}\n` +
        `Entry ~${(suggestion.entry * 100).toFixed(0)}¢ · ${suggestion.minutesRemaining.toFixed(1)}m left\n\n` +
        `This is an EXPERIMENT hypothesis — not advice, not a live order.`,
    )
    if (!ok) return
    takePaperSuggestion(suggestion, market)
    setEntries(loadJournal())
  }

  const tabBtn = (id: LabTab, label: string, activeClass: string) => (
    <button
      type="button"
      className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
        tab === id
          ? activeClass
          : 'border border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
      }`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <header className="text-left">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-400/90">
          Crypto 15‑Minute Research Lab · fully free — no API keys
        </p>
        <h1 className="bg-gradient-to-r from-amber-300 via-slate-100 to-emerald-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
          Discover / test / kill rules
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Niche: Kalshi crypto 15m up/down (BTC, ETH, SOL, …). You have{' '}
          <strong className="text-slate-300">no proven rules yet</strong>. This lab ships
          experiment candidates, a paper journal, and a{' '}
          <strong className="text-slate-300">paper market maker</strong> —{' '}
          <strong className="text-slate-300">not</strong> money-printing signals.{' '}
          <em className="text-slate-300">No edge until a rule survives paper.</em>
        </p>
      </header>

      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-left text-xs text-amber-100/90">
        <strong>Brutal honesty:</strong> These are hypotheses. Default is NO TRADE. Do not promote a
        rule until sample size is large and net-after-fees is still positive out of sample. Printing
        money is not on the menu. Paper MM will get adversely selected — that is the lesson.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabBtn('lab', 'Crypto Lab', 'bg-amber-500 text-slate-950')}
        {tabBtn('backtest', 'Backtest', 'bg-rose-500 text-slate-950')}
        {tabBtn('mm', '15m MM (Paper)', 'bg-violet-500 text-slate-950')}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            source === 'live' && markets.length > 0
              ? 'bg-emerald-950 text-emerald-300'
              : source === 'live' && markets.length === 0
                ? 'bg-rose-950 text-rose-200'
                : 'bg-slate-800 text-slate-400'
          }`}
        >
          {source === 'live' && markets.length > 0
            ? 'LIVE Kalshi (proxy → public)'
            : source === 'live' && markets.length === 0
              ? 'LIVE-ONLY FAILURE'
              : 'Fetching markets…'}
        </span>
        {fetchedAt && <span>Updated {formatRelativeTime(fetchedAt)}</span>}
        {!fetchedAt && lastAttemptAt && (
          <span>Polled {formatRelativeTime(lastAttemptAt)}</span>
        )}
        {fetchedAt && lastAttemptAt && lastAttemptAt !== fetchedAt && (
          <span className="text-slate-500">· polled {formatRelativeTime(lastAttemptAt)}</span>
        )}
        {loading && <span className="text-slate-500">Refreshing…</span>}
        <button
          type="button"
          className="btn btn-ghost !py-1 text-xs"
          onClick={() => void refresh({ force: true })}
        >
          Refresh now
        </button>
        {error && (
          <span className="max-w-2xl truncate text-rose-300/90" title={error}>
            {error}
          </span>
        )}
      </div>

      {source === 'live' && markets.length === 0 && error && (
        <div className="rounded-xl border-2 border-rose-500/70 bg-rose-950/50 px-4 py-3 text-sm font-semibold text-rose-100 shadow-lg shadow-rose-950/40">
          🛑 LIVE-ONLY FAILURE — no market universe. Proxy and public Kalshi both failed (demo
          fixtures removed). Paper research requires online markets; nothing offline is loaded.
          Retry when the network / proxy is up. Positive P&amp;L is not guaranteed.
          {error ? (
            <p className="mt-1 text-xs font-normal text-rose-200/80" title={error}>
              {error}
            </p>
          ) : null}
        </div>
      )}

      {/* Keep all lab tabs mounted — CSS-hide inactive so Paper MM portfolio
          survives tab switches (unmount must never stop / wipe session). */}
      <div className={tab === 'lab' ? '' : 'hidden'} aria-hidden={tab !== 'lab'}>
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <CryptoMarketFeed
              markets={markets}
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
            />
            <RuleExperimentsPanel market={selected} onTakePaper={handleTake} />
            <PaperJournalPanel
              entries={entries}
              stats={stats}
              onMark={(id, outcome) => setEntries(markOutcome(id, outcome))}
              onClear={() => {
                if (confirm('Clear entire paper journal?')) {
                  clearJournal()
                  setEntries([])
                }
              }}
            />
          </div>
          <LiveContextPanel market={selected} />
        </div>
      </div>

      <div className={tab === 'backtest' ? '' : 'hidden'} aria-hidden={tab !== 'backtest'}>
        <BacktestPanel />
      </div>

      <div className={tab === 'mm' ? '' : 'hidden'} aria-hidden={tab !== 'mm'}>
        <PaperMmPanel
          markets={markets}
          selectedTicker={selectedTicker}
          onSelect={setSelectedTicker}
          source={source === 'demo' ? 'live' : (source ?? 'live')}
        />
      </div>
    </div>
  )
}

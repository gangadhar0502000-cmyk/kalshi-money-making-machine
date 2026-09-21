import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Crypto15mMarket,
  ExperimentSuggestion,
  PaperJournalEntry,
} from '../../types/crypto15m'
import { fetchCrypto15mMarkets, fetchMarketByTicker } from '../../lib/crypto15m/api'
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
import { shouldApplyLabRefresh } from '../../lib/crypto15m/labRefresh'

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
  const lastMarketsRef = useRef<Crypto15mMarket[]>([])
  const sourceRef = useRef<'live' | 'demo' | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const result = await fetchCrypto15mMarkets(signal)
      if (signal?.aborted) return

      // Never wipe a good universe with a transient empty/failed refresh (rollover gap).
      // Explicit: DEMO → LIVE with markets always replaces the demo universe.
      const decision = shouldApplyLabRefresh({
        prevSource: sourceRef.current,
        next: result,
        lastMarketsLen: lastMarketsRef.current.length,
      })
      let marketsForPick = result.markets
      if (decision === 'keep-last') {
        marketsForPick = lastMarketsRef.current
        setError(
          (result.error ? result.error + ' · ' : '') +
            'Empty feed — keeping last markets; retrying…',
        )
      } else {
        lastMarketsRef.current = result.markets
        setMarkets(result.markets)
        setSource(result.source)
        sourceRef.current = result.source
        setError(result.error)
        setFetchedAt(result.fetchedAt)
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
      if (signal?.aborted) return
      setError(
        `Refresh failed: ${e instanceof Error ? e.message : String(e)} — retrying…`,
      )
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void refresh(ac.signal)
    return () => ac.abort()
  }, [refresh])

  // Poll for mid history + countdown freshness
  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh()
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
            source === 'live'
              ? 'bg-emerald-950 text-emerald-300'
              : source === 'demo'
                ? 'bg-amber-950 text-amber-200'
                : 'bg-slate-800 text-slate-400'
          }`}
        >
          {source === 'live'
            ? 'LIVE Kalshi (proxy → public)'
            : source === 'demo'
              ? 'DEMO fixtures (offline fallback)'
              : 'Fetching markets…'}
        </span>
        {fetchedAt && <span>Updated {formatRelativeTime(fetchedAt)}</span>}
        {loading && <span className="text-slate-500">Refreshing…</span>}
        <button type="button" className="btn btn-ghost !py-1 text-xs" onClick={() => void refresh()}>
          Refresh now
        </button>
        {error && (
          <span
            className={`max-w-2xl truncate ${source === 'demo' ? 'text-amber-400/90' : 'text-slate-500'}`}
            title={error}
          >
            {source === 'demo' ? `lastError: ${error}` : error}
          </span>
        )}
      </div>

      {source === 'demo' && (
        <div className="rounded-xl border-2 border-amber-500/70 bg-amber-950/50 px-4 py-3 text-sm font-semibold text-amber-100 shadow-lg shadow-amber-950/40">
          ⚠ DEMO MARKET UNIVERSE — live proxy (/local-api/crypto15m) and public Kalshi API both
          failed. Paper MM is using offline fixtures with synthetic floor_strike. Will auto-switch
          back to LIVE on the next successful refresh — do not treat demo P&amp;L as live edge.
          {error ? (
            <p className="mt-1 text-xs font-normal text-amber-200/80" title={error}>
              {error}
            </p>
          ) : null}
        </div>
      )}

      {tab === 'lab' && (
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
      )}

      {tab === 'backtest' && <BacktestPanel />}

      {tab === 'mm' && (
        <PaperMmPanel
          markets={markets}
          selectedTicker={selectedTicker}
          onSelect={setSelectedTicker}
          source={source ?? 'demo'}
        />
      )}
    </div>
  )
}

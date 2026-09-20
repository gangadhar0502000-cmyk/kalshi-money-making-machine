import { useCallback, useEffect, useMemo, useState } from 'react'
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

export function Crypto15mLab() {
  const [loading, setLoading] = useState(true)
  const [markets, setMarkets] = useState<Crypto15mMarket[]>([])
  const [source, setSource] = useState<'live' | 'demo'>('demo')
  const [error, setError] = useState<string | undefined>()
  const [fetchedAt, setFetchedAt] = useState<string | undefined>()
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [entries, setEntries] = useState<PaperJournalEntry[]>(() => loadJournal())
  const [nowTick, setNowTick] = useState(0)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const result = await fetchCrypto15mMarkets(signal)
      if (signal?.aborted) return
      setMarkets(result.markets)
      setSource(result.source)
      setError(result.error)
      setFetchedAt(result.fetchedAt)
      setSelectedTicker((prev) => {
        if (prev && result.markets.some((m) => m.ticker === prev)) return prev
        return result.markets[0]?.ticker ?? null
      })
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
          experiment candidates and a paper journal —{' '}
          <strong className="text-slate-300">not</strong> money-printing signals.{' '}
          <em className="text-slate-300">No edge until a rule survives paper.</em>
        </p>
      </header>

      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-left text-xs text-amber-100/90">
        <strong>Brutal honesty:</strong> These are hypotheses. Default is NO TRADE. Do not promote a
        rule until sample size is large and net-after-fees is still positive out of sample. Printing
        money is not on the menu.
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            source === 'live'
              ? 'bg-emerald-950 text-emerald-300'
              : 'bg-slate-800 text-amber-300'
          }`}
        >
          {source === 'live' ? 'LIVE Kalshi public API' : 'DEMO fixtures (offline)'}
        </span>
        {fetchedAt && <span>Updated {formatRelativeTime(fetchedAt)}</span>}
        {loading && <span className="text-slate-500">Refreshing…</span>}
        <button type="button" className="btn btn-ghost !py-1 text-xs" onClick={() => void refresh()}>
          Refresh now
        </button>
        {error && source === 'demo' && (
          <span className="max-w-xl truncate text-amber-400/80" title={error}>
            Live unavailable → demo
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <CryptoMarketFeed
            markets={markets}
            selectedTicker={selectedTicker}
            onSelect={setSelectedTicker}
          />
          <RuleExperimentsPanel market={selected} onTakePaper={handleTake} />
          <BacktestPanel />
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
  )
}

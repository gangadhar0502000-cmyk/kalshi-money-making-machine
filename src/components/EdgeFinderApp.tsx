import { useCallback, useEffect, useMemo, useState } from 'react'
import { FiltersBar } from './FiltersBar'
import { PaperBankroll } from './PaperBankroll'
import { StatusBanner } from './StatusBanner'
import { TradeIdeasBoard } from './TradeIdeasBoard'
import { DEMO_CATEGORIES } from '../fixtures/demoMarkets'
import { fetchOpenMarkets } from '../lib/api'
import { loadPortfolio, openPaperTrade, savePortfolio } from '../lib/bankroll'
import { STRICT_MIN_EDGE_PP, scoreAndRankAsync } from '../lib/scoring'
import type {
  DataSource,
  FilterState,
  PaperPortfolio,
  ScoreMeta,
  ScoredOpportunity,
} from '../types/kalshi'

/** Strict defaults: hide junk + structure-only; min |edge| 5pp. */
const INITIAL_FILTERS: FilterState = {
  category: 'All',
  minLiquidity: 45,
  minEdgePct: STRICT_MIN_EDGE_PP,
  midMin: 15,
  midMax: 85,
  search: '',
  hideIlliquid: true,
  strictMode: true,
}

export function EdgeFinderApp() {
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<DataSource>('demo')
  const [error, setError] = useState<string | undefined>()
  const [fetchedAt, setFetchedAt] = useState<string | undefined>()
  const [opportunities, setOpportunities] = useState<ScoredOpportunity[]>([])
  const [meta, setMeta] = useState<ScoreMeta | undefined>()
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
  const [portfolio, setPortfolio] = useState<PaperPortfolio>(() => loadPortfolio())

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const result = await fetchOpenMarkets(signal)
      if (signal?.aborted) return
      setSource(result.source)
      setError(result.error)
      setFetchedAt(result.fetchedAt)
      const scored = await scoreAndRankAsync(result.markets, signal)
      if (signal?.aborted) return
      setOpportunities(scored.opportunities)
      setMeta(scored.meta)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void refresh(ac.signal)
    return () => ac.abort()
  }, [refresh])

  const categories = useMemo(() => {
    const set = new Set<string>(['All', ...DEMO_CATEGORIES.filter((c) => c !== 'All')])
    for (const o of opportunities) set.add(o.category)
    return Array.from(set)
  }, [opportunities])

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return opportunities.filter((o) => {
      if (filters.strictMode) {
        // Strict: only TRADE (liquid + external fair); never surface Suggest-as-trade vibes
        if (o.opportunityKind !== 'TRADE') return false
      }
      if (filters.hideIlliquid && !o.passedLiquidityGate) return false
      if (filters.category !== 'All' && o.category !== filters.category) return false
      if (o.liquidityScore < filters.minLiquidity) return false
      if (o.absEdgePct < filters.minEdgePct) return false
      const midCents = o.midYes * 100
      if (midCents < filters.midMin || midCents > filters.midMax) return false
      if (q) {
        const hay = `${o.title} ${o.ticker} ${o.eventTicker}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [opportunities, filters])

  const handlePortfolioChange = (p: PaperPortfolio) => {
    savePortfolio(p)
    setPortfolio(p)
  }

  const handlePaperTrade = (opp: ScoredOpportunity) => {
    if (opp.opportunityKind !== 'TRADE') {
      alert('Strict Edge Finder: paper trades only on TRADE cards with external fair value.')
      return
    }

    const entry =
      opp.suggestedSide === 'YES'
        ? opp.yesAsk || opp.midYes
        : opp.noAsk || 1 - opp.midYes

    const stakePct =
      portfolio.stakeMode === 'flat' ? portfolio.flatStakePct : opp.suggestedStakePct
    const stakeDollars = (portfolio.cash * stakePct) / 100

    if (stakeDollars < 1) {
      alert('Not enough paper cash for a meaningful stake. Reset bankroll or close positions.')
      return
    }

    const ok = confirm(
      `Paper ${opp.suggestedSide} on "${opp.title}"?\n\n` +
        `Entry ~${(entry * 100).toFixed(0)}¢ · Fair ${(opp.fairProb * 100).toFixed(1)}% · Edge ${opp.edgePct >= 0 ? '+' : ''}${opp.edgePct.toFixed(1)}pp\n` +
        `Stake $${stakeDollars.toFixed(2)} (${stakePct}% of cash) · Confidence ${opp.confidence}\n\n` +
        `Local simulation only — not a real Kalshi order, not guaranteed profit.`,
    )
    if (!ok) return

    const next = openPaperTrade(portfolio, {
      ticker: opp.ticker,
      title: opp.title,
      side: opp.suggestedSide,
      entryPrice: entry,
      stakeDollars,
      note: `edge=${opp.edgePct.toFixed(1)}pp conf=${opp.confidence}`,
    })
    setPortfolio(next)
  }

  const junkHidden = opportunities.filter((o) => !o.passedLiquidityGate).length

  return (
    <div>
      <header className="mb-6 text-left">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400/90">
              Secondary · Edge Finder v3 · fully free — no API keys
            </p>
            <h1 className="bg-gradient-to-r from-emerald-300 via-slate-100 to-amber-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
              General Edge Finder
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Find <strong className="font-medium text-slate-300">tradeable edge</strong> vs free ESPN /
              Polymarket / NOAA fair value — not illiquid 99¢ junk or structure-only vibes.
              Fully free — no API keys. Primary metric is{' '}
              <strong className="font-medium text-slate-300">Edge pp</strong>. Research tool only;
              printing money is not guaranteed.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="btn btn-ghost"
              href="https://docs.kalshi.com/getting_started/quick_start_market_data"
              target="_blank"
              rel="noreferrer"
            >
              Kalshi API docs
            </a>
            <a className="btn btn-ghost" href="https://kalshi.com" target="_blank" rel="noreferrer">
              kalshi.com
            </a>
          </div>
        </div>
      </header>

      <div className="mb-4">
        <StatusBanner
          source={source}
          error={error}
          lastUpdated={fetchedAt}
          loading={loading}
          onRefresh={() => void refresh()}
          junkHidden={junkHidden}
          meta={meta}
        />
      </div>

      <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-left text-xs text-slate-400">
        <strong className="text-slate-300">Disclaimer:</strong> Educational research scanner. Fair
        values and edges are estimates — not mispricing proof, not investment advice, and{' '}
        <em>not</em> guaranteed profit. HIGH confidence means an external signal was used on a liquid
        book; it still can be wrong. Prediction markets involve risk of loss.
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <FiltersBar
            filters={filters}
            categories={categories}
            onChange={setFilters}
            count={filtered.length}
            total={opportunities.length}
          />
          <TradeIdeasBoard
            opportunities={filtered}
            bankroll={portfolio.cash}
            onPaperTrade={handlePaperTrade}
            strictMode={filters.strictMode}
          />
        </div>
        <PaperBankroll
          portfolio={portfolio}
          opportunities={opportunities}
          onChange={handlePortfolioChange}
        />
      </div>

    </div>
  )
}

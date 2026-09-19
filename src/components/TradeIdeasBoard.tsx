import type { ScoredOpportunity } from '../types/kalshi'
import { TradeIdeaCard } from './TradeIdeaCard'

interface Props {
  opportunities: ScoredOpportunity[]
  bankroll: number
  onPaperTrade: (opp: ScoredOpportunity) => void
}

export function TradeIdeasBoard({ opportunities, bankroll, onPaperTrade }: Props) {
  if (opportunities.length === 0) {
    return (
      <div className="panel p-8 text-center text-slate-400">
        No markets match your filters. Lower min volume/score or clear search.
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {opportunities.map((opp) => (
        <TradeIdeaCard
          key={opp.ticker}
          opp={opp}
          bankroll={bankroll}
          onPaperTrade={onPaperTrade}
        />
      ))}
    </div>
  )
}

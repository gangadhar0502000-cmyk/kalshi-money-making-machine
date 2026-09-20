import type { ScoredOpportunity } from '../types/kalshi'
import { TradeIdeaCard } from './TradeIdeaCard'

interface Props {
  opportunities: ScoredOpportunity[]
  bankroll: number
  onPaperTrade: (opp: ScoredOpportunity) => void
  strictMode: boolean
}

export function TradeIdeasBoard({
  opportunities,
  bankroll,
  onPaperTrade,
  strictMode,
}: Props) {
  if (opportunities.length === 0) {
    return (
      <div className="panel p-8 text-center text-slate-400">
        {strictMode ? (
          <>
            No <strong className="text-slate-200">TRADE</strong> edges match Strict Mode (free
            external fair + liquidity + min |edge|). Lower min |edge|, wait for ESPN/Polymarket
            matches, or turn off Strict Mode to inspect UNRANKED research cards.
          </>
        ) : (
          <>
            No opportunities match your filters. Lower min |edge| / liquidity, widen the mid band, or
            uncheck “Hide illiquid”.
          </>
        )}
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

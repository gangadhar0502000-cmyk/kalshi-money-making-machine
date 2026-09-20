import type { ScoredOpportunity } from '../types/kalshi'
import { formatCents, formatPct, formatVolume } from '../lib/format'
import { ScoreBadge } from './ScoreBadge'

interface Props {
  opp: ScoredOpportunity
  bankroll: number
  onPaperTrade: (opp: ScoredOpportunity) => void
}

export function TradeIdeaCard({ opp, bankroll, onPaperTrade }: Props) {
  const entry =
    opp.suggestedSide === 'YES'
      ? opp.yesAsk || opp.midYes
      : opp.noAsk || 1 - opp.midYes
  const stake = (bankroll * opp.suggestedStakePct) / 100
  const days = opp.hoursToExpiry / 24

  return (
    <article
      className={`panel flex flex-col gap-3 p-4 transition hover:border-slate-600 ${
        !opp.passedLiquidityGate ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-left">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {opp.category}
            </span>
            <span className="font-mono text-[11px] text-slate-500">{opp.ticker}</span>
            {!opp.passedLiquidityGate && (
              <span className="rounded-md bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300">
                Illiquid
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold leading-snug text-slate-50">{opp.title}</h3>
        </div>
        <ScoreBadge edgePct={opp.edgePct} confidence={opp.confidence} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Kalshi mid" value={formatCents(opp.midYes)} />
        <Stat label="Fair YES" value={`${(opp.fairProb * 100).toFixed(1)}%`} />
        <Stat
          label="Edge"
          value={`${opp.edgePct >= 0 ? '+' : ''}${opp.edgePct.toFixed(1)}pp`}
        />
        <Stat label="Liquidity" value={`${opp.liquidityScore}`} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="YES bid/ask" value={`${formatCents(opp.yesBid)} / ${formatCents(opp.yesAsk)}`} />
        <Stat label="Volume" value={formatVolume(opp.volume)} />
        <Stat label="Spread" value={`${opp.spreadCents.toFixed(1)}¢`} />
        <Stat
          label="Expiry"
          value={days < 1 ? `${Math.round(opp.hoursToExpiry)}h` : `${days.toFixed(1)}d`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-lg px-2.5 py-1 font-bold ${
            opp.suggestedSide === 'YES'
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-sky-500/20 text-sky-300'
          }`}
        >
          Suggest {opp.suggestedSide} @ ~{formatCents(entry)}
        </span>
        <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300">
          Kelly-lite ~{formatPct(opp.suggestedStakePct)} ≈ ${stake.toFixed(2)}
        </span>
      </div>

      <ul className="space-y-1 text-left text-xs text-slate-400">
        {opp.rationale.slice(0, 4).map((r) => (
          <li key={r} className="flex gap-2">
            <span className="text-emerald-500/80">▸</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>

      <details className="text-left text-xs text-slate-500">
        <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">
          Why / sources ({opp.fairSources.length})
        </summary>
        <ul className="mt-2 space-y-1.5">
          {opp.fairSources.map((s) => (
            <li key={`${s.kind}-${s.label}-${s.detail.slice(0, 24)}`} className="rounded-lg bg-slate-950/50 px-2 py-1.5">
              <span className="font-semibold text-slate-300">{s.label}</span>
              <span className="ml-1 text-[10px] uppercase text-slate-600">{s.kind}</span>
              <div className="text-slate-400">{s.detail}</div>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-5">
          {Object.entries(opp.scoreBreakdown).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-950/50 px-2 py-1">
              <div className="capitalize text-slate-500">{k.replace(/([A-Z])/g, ' $1')}</div>
              <div className="font-mono text-slate-200">{v}</div>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onPaperTrade(opp)}
          disabled={!opp.passedLiquidityGate}
        >
          Paper trade
        </button>
        <a
          className="btn btn-ghost"
          href={opp.kalshiUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open on Kalshi ↗
        </a>
      </div>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-950/50 px-2.5 py-2 text-left">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-sm text-slate-100">{value}</div>
    </div>
  )
}

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
  const isTrade = opp.opportunityKind === 'TRADE'

  const externalSources = opp.fairSources.filter((s) =>
    ['noaa', 'odds_api', 'odds_fallback', 'demo_external'].includes(s.kind),
  )

  return (
    <article
      className={`panel flex flex-col gap-3 p-4 transition hover:border-slate-600 ${
        !isTrade ? 'opacity-75 ring-1 ring-amber-500/20' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-left">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {opp.category}
            </span>
            <span className="font-mono text-[11px] text-slate-500">{opp.ticker}</span>
            {isTrade ? (
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                External edge
              </span>
            ) : (
              <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                UNRANKED
              </span>
            )}
            {!opp.passedLiquidityGate && (
              <span className="rounded-md bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300">
                Illiquid
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold leading-snug text-slate-50">{opp.title}</h3>
        </div>
        <ScoreBadge
          edgePct={opp.edgePct}
          confidence={opp.confidence}
          opportunityKind={opp.opportunityKind}
        />
      </div>

      {/* Primary metrics: Fair % | Kalshi mid % | Edge pp | Confidence | Sources */}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <Stat label="Fair %" value={`${(opp.fairProb * 100).toFixed(1)}%`} emphasize />
        <Stat label="Kalshi mid %" value={`${(opp.midYes * 100).toFixed(1)}%`} />
        <Stat
          label="Edge pp"
          value={`${opp.edgePct >= 0 ? '+' : ''}${opp.edgePct.toFixed(1)}`}
          emphasize
        />
        <Stat label="Confidence" value={opp.confidence} />
        <Stat
          label="Sources"
          value={externalSources.length ? externalSources.map((s) => s.label).slice(0, 2).join(', ') : 'Structure only'}
        />
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

      {isTrade ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={`rounded-lg px-2.5 py-1 font-bold ${
              opp.suggestedSide === 'YES'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-sky-500/20 text-sky-300'
            }`}
          >
            Lean {opp.suggestedSide} @ ~{formatCents(entry)}
          </span>
          <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300">
            Kelly-lite ~{formatPct(opp.suggestedStakePct)} ≈ ${stake.toFixed(2)}
          </span>
          <span
            className="rounded-lg bg-slate-950/60 px-2 py-1 text-[10px] text-slate-500"
            title="Sorting helper only — not edge"
          >
            Rank score {opp.rankScore}
          </span>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-100/90">
          <strong className="font-semibold">Not a trade suggestion.</strong> Structure-only or failed
          liquidity — no external fair value. Hidden by default in Strict Mode. Do not confuse with
          Edge pp from sportsbooks / NOAA.
        </div>
      )}

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
            <li
              key={`${s.kind}-${s.label}-${s.detail.slice(0, 24)}`}
              className="rounded-lg bg-slate-950/50 px-2 py-1.5"
            >
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
          disabled={!isTrade}
          title={isTrade ? 'Paper trade (local only)' : 'Strict: only TRADE cards with external fair'}
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

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string
  value: string
  emphasize?: boolean
}) {
  return (
    <div className="rounded-xl bg-slate-950/50 px-2.5 py-2 text-left">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`font-mono text-sm ${emphasize ? 'font-semibold text-emerald-200' : 'text-slate-100'} truncate`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

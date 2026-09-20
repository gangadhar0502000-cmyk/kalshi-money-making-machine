import type { ConfidenceLevel, OpportunityKind } from '../types/kalshi'

interface Props {
  edgePct: number
  confidence: ConfidenceLevel
  opportunityKind: OpportunityKind
}

/**
 * Hero metric = Edge pp. Confidence is secondary.
 * Rank score is never shown here (avoids MVP "Score" confusion).
 */
export function ScoreBadge({ edgePct, confidence, opportunityKind }: Props) {
  const confTone =
    confidence === 'HIGH'
      ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40'
      : confidence === 'MEDIUM'
        ? 'bg-amber-500/20 text-amber-200 ring-amber-500/40'
        : confidence === 'UNRANKED'
          ? 'bg-slate-800/80 text-slate-400 ring-slate-600/40'
          : 'bg-slate-700/60 text-slate-300 ring-slate-600/50'

  const edgeTone =
    opportunityKind !== 'TRADE'
      ? 'text-slate-400'
      : edgePct >= 0
        ? 'text-emerald-300'
        : 'text-sky-300'

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`font-mono text-xl font-extrabold tabular-nums leading-none ${edgeTone}`}
        title="Edge pp = (fair − Kalshi mid) × 100. Primary metric — not a vibes score."
      >
        {edgePct >= 0 ? '+' : ''}
        {edgePct.toFixed(1)}
        <span className="ml-0.5 text-xs font-semibold text-slate-500">pp</span>
      </span>
      <span
        className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${confTone}`}
        title="HIGH = external fair + liquid book + meaningful |edge|. UNRANKED = structure-only."
      >
        {confidence}
      </span>
      {opportunityKind === 'RESEARCH' && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500/90">
          Research only
        </span>
      )}
    </div>
  )
}

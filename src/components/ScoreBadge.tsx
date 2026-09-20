import type { ConfidenceLevel } from '../types/kalshi'

interface Props {
  edgePct: number
  confidence: ConfidenceLevel
}

export function ScoreBadge({ edgePct, confidence }: Props) {
  const confTone =
    confidence === 'HIGH'
      ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40'
      : confidence === 'MEDIUM'
        ? 'bg-amber-500/20 text-amber-200 ring-amber-500/40'
        : 'bg-slate-700/60 text-slate-300 ring-slate-600/50'

  const edgeTone = edgePct >= 0 ? 'text-emerald-300' : 'text-sky-300'

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`inline-flex min-w-14 items-center justify-center rounded-lg px-2 py-1 text-sm font-bold tabular-nums ring-1 ${confTone}`}
        title="Confidence: HIGH requires external fair source + liquidity OK"
      >
        {confidence}
      </span>
      <span className={`font-mono text-xs font-semibold tabular-nums ${edgeTone}`}>
        {edgePct >= 0 ? '+' : ''}
        {edgePct.toFixed(1)}pp
      </span>
    </div>
  )
}

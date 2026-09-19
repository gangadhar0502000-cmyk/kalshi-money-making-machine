interface Props {
  score: number
}

export function ScoreBadge({ score }: Props) {
  const tone =
    score >= 75
      ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40'
      : score >= 55
        ? 'bg-amber-500/20 text-amber-200 ring-amber-500/40'
        : 'bg-slate-700/60 text-slate-300 ring-slate-600/50'

  return (
    <span
      className={`inline-flex min-w-12 items-center justify-center rounded-lg px-2 py-1 text-sm font-bold tabular-nums ring-1 ${tone}`}
      title="Heuristic edge score 0–100 (research only)"
    >
      {score}
    </span>
  )
}

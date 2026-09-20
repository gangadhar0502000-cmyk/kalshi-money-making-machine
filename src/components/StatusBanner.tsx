import type { DataSource, ScoreMeta } from '../types/kalshi'

interface Props {
  source: DataSource
  error?: string
  lastUpdated?: string
  loading: boolean
  onRefresh: () => void
  junkHidden?: number
  meta?: ScoreMeta
}

export function StatusBanner({
  source,
  error,
  lastUpdated,
  loading,
  onRefresh,
  junkHidden = 0,
  meta,
}: Props) {
  const isDemo = source === 'demo'
  const freeFetchFailed = meta?.freeFetchFailed ?? false
  const blocked = meta?.sportsBlockedNoExternal ?? 0
  const fetchErrors = meta?.freeFetchErrors ?? []

  return (
    <div className="space-y-3">
      {freeFetchFailed && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-3 text-left shadow-lg shadow-amber-900/20">
          <p className="text-sm font-bold text-amber-100">
            Free external feeds failed (rate limit or network)
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-50/90">
            ESPN, Polymarket, or NOAA returned errors
            {fetchErrors.length ? ` (${fetchErrors.slice(0, 2).join('; ')})` : ''}.
            No paid API key is required — wait and refresh, or use demo fixtures offline.
            {blocked > 0 ? (
              <>
                {' '}
                — <strong className="text-amber-50">{blocked} market{blocked === 1 ? '' : 's'}</strong>{' '}
                still lack an external fair match.
              </>
            ) : null}
          </p>
        </div>
      )}

      <div
        className={`panel flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
          isDemo
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-emerald-500/30 bg-emerald-500/10'
        }`}
      >
        <div className="text-left text-sm">
          <div className="font-semibold text-slate-100">
            {isDemo ? 'Demo edge fixtures' : 'Live Kalshi + external signals'}
            {loading ? ' · refreshing…' : ''}
          </div>
          <p className="mt-0.5 text-slate-300/90">
            {isDemo
              ? `Live fetch unavailable${error ? ` (${error.slice(0, 100)})` : ''}. Demo set includes HIGH external-edge cards and illiquid junk so you can verify Strict Mode offline.`
              : 'Edge pp = fair − Kalshi mid. Strict Mode requires free external fair (ESPN / Polymarket / NOAA) + liquidity — not structure vibes. Fully free — no API keys.'}
            {junkHidden > 0 ? ` · ${junkHidden} failed liquidity gate.` : ''}
            {meta
              ? ` · ${meta.tradeableCount} TRADE / ${meta.structureOnlyCount} structure-only.`
              : ''}
          </p>
          {lastUpdated && (
            <p className="mt-1 text-xs text-slate-400">
              Last updated: {new Date(lastUpdated).toLocaleString()}
            </p>
          )}
        </div>
        <button type="button" className="btn btn-ghost shrink-0" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

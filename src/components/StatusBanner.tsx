import type { DataSource } from '../types/kalshi'

interface Props {
  source: DataSource
  error?: string
  lastUpdated?: string
  loading: boolean
  onRefresh: () => void
}

export function StatusBanner({ source, error, lastUpdated, loading, onRefresh }: Props) {
  const isDemo = source === 'demo'

  return (
    <div
      className={`panel flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
        isDemo
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-emerald-500/30 bg-emerald-500/10'
      }`}
    >
      <div className="text-left text-sm">
        <div className="font-semibold text-slate-100">
          {isDemo ? 'Demo data mode' : 'Live Kalshi markets'}
          {loading ? ' · refreshing…' : ''}
        </div>
        <p className="mt-0.5 text-slate-300/90">
          {isDemo
            ? `Live fetch unavailable${error ? ` (${error.slice(0, 120)})` : ''}. Showing bundled fixtures so you can explore scoring & paper trading.`
            : 'Pulled from Kalshi public Trade API (unauthenticated). Heuristics only — not financial advice.'}
        </p>
        {lastUpdated && (
          <p className="mt-1 text-xs text-slate-400">Last updated: {new Date(lastUpdated).toLocaleString()}</p>
        )}
      </div>
      <button type="button" className="btn btn-ghost shrink-0" onClick={onRefresh} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}

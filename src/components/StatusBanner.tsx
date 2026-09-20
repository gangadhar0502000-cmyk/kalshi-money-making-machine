import type { DataSource, ScoreMeta } from '../types/kalshi'
import { oddsApiConfigured } from '../lib/external/odds'

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
  const hasOddsKey = meta?.oddsApiConfigured ?? oddsApiConfigured()
  const blocked = meta?.sportsBlockedNoExternal ?? 0

  return (
    <div className="space-y-3">
      {!hasOddsKey && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-3 text-left shadow-lg shadow-amber-900/20">
          <p className="text-sm font-bold text-amber-100">
            Strict sports edge needs a free Odds API key
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-50/90">
            Get one at{' '}
            <a
              className="font-semibold underline decoration-amber-300/80 underline-offset-2 hover:text-white"
              href="https://the-odds-api.com"
              target="_blank"
              rel="noreferrer"
            >
              https://the-odds-api.com
            </a>
            , then put{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-amber-100">
              VITE_ODDS_API_KEY=your_key
            </code>{' '}
            in <code className="font-mono text-[11px]">.env</code> and restart{' '}
            <code className="font-mono text-[11px]">npm run dev</code>. Without it, sports markets
            cannot get external fair value
            {blocked > 0 ? (
              <>
                {' '}
                — <strong className="text-amber-50">{blocked} market{blocked === 1 ? '' : 's'}</strong>{' '}
                blocked for lacking external fair
              </>
            ) : null}
            . A weak ESPN keyless fallback may fill a few moneylines; demo fixtures still show
            HIGH external-edge cards offline.
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
              : 'Edge pp = fair − Kalshi mid. Strict Mode requires external fair (Odds API / NOAA) + liquidity — not structure vibes.'}
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

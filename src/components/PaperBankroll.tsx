import type { PaperPortfolio, ScoredOpportunity } from '../types/kalshi'
import { closePaperTrade, portfolioStats, resetPortfolio } from '../lib/bankroll'
import { formatDollars } from '../lib/format'

interface Props {
  portfolio: PaperPortfolio
  opportunities: ScoredOpportunity[]
  onChange: (p: PaperPortfolio) => void
}

export function PaperBankroll({ portfolio, opportunities, onChange }: Props) {
  const marks: Record<string, number> = {}
  for (const o of opportunities) {
    marks[`${o.ticker}:YES`] = o.yesBid || o.midYes
    marks[`${o.ticker}:NO`] = o.noBid || 1 - o.midYes
  }
  const stats = portfolioStats(portfolio, marks)
  const openTrades = portfolio.trades.filter((t) => t.status === 'open')
  const closedTrades = portfolio.trades.filter((t) => t.status === 'closed').slice(0, 8)

  return (
    <aside className="panel sticky top-4 space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Paper bankroll
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Local-only simulation via localStorage. No real orders are sent.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Cash" value={formatDollars(portfolio.cash)} />
        <Metric
          label="Equity"
          value={formatDollars(stats.equity)}
          tone={stats.pnl >= 0 ? 'good' : 'bad'}
        />
        <Metric
          label="P&L"
          value={`${stats.pnl >= 0 ? '+' : ''}${formatDollars(stats.pnl)}`}
          tone={stats.pnl >= 0 ? 'good' : 'bad'}
        />
        <Metric
          label="P&L %"
          value={`${stats.pnlPct >= 0 ? '+' : ''}${stats.pnlPct.toFixed(1)}%`}
          tone={stats.pnl >= 0 ? 'good' : 'bad'}
        />
      </div>

      <div className="grid gap-2">
        <label className="label" htmlFor="startCash">
          Starting cash (reset)
        </label>
        <div className="flex gap-2">
          <input
            id="startCash"
            type="number"
            min={50}
            step={50}
            className="input"
            defaultValue={portfolio.startingCash}
            onBlur={(e) => {
              const v = Math.max(50, Number(e.target.value) || 1000)
              e.target.value = String(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const el = e.target as HTMLInputElement
                const v = Math.max(50, Number(el.value) || 1000)
                if (
                  confirm(
                    `Reset paper portfolio to $${v}? This clears all paper trades.`,
                  )
                ) {
                  onChange(resetPortfolio(v))
                }
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ghost shrink-0"
            onClick={() => {
              const input = document.getElementById('startCash') as HTMLInputElement | null
              const v = Math.max(50, Number(input?.value) || portfolio.startingCash)
              if (confirm(`Reset paper portfolio to $${v}? This clears all paper trades.`)) {
                onChange(resetPortfolio(v))
              }
            }}
          >
            Reset
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="stakeMode">
              Stake mode
            </label>
            <select
              id="stakeMode"
              className="input"
              value={portfolio.stakeMode}
              onChange={(e) =>
                onChange({
                  ...portfolio,
                  stakeMode: e.target.value as 'kelly' | 'flat',
                  updatedAt: new Date().toISOString(),
                })
              }
            >
              <option value="kelly">¼-Kelly suggestion</option>
              <option value="flat">Flat %</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="flatPct">
              Flat stake %
            </label>
            <input
              id="flatPct"
              type="number"
              min={0.25}
              max={10}
              step={0.25}
              className="input"
              value={portfolio.flatStakePct}
              onChange={(e) =>
                onChange({
                  ...portfolio,
                  flatStakePct: Math.min(10, Math.max(0.25, Number(e.target.value) || 2)),
                })
              }
            />
          </div>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Open positions ({openTrades.length})
        </h3>
        {openTrades.length === 0 ? (
          <p className="text-xs text-slate-500">No open paper trades yet.</p>
        ) : (
          <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {openTrades.map((t) => {
              const mark = marks[`${t.ticker}:${t.side}`] ?? t.entryPrice
              const mtm = t.contracts * mark - t.stakeDollars
              return (
                <li
                  key={t.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5 text-left text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-200">{t.title}</div>
                      <div className="mt-0.5 text-slate-500">
                        {t.side} · {t.contracts.toFixed(2)} ctr @{' '}
                        {(t.entryPrice * 100).toFixed(0)}¢
                      </div>
                      <div className={mtm >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        MTM {mtm >= 0 ? '+' : ''}
                        {formatDollars(mtm)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost !px-2 !py-1 !text-xs"
                      onClick={() => onChange(closePaperTrade(portfolio, t.id, mark))}
                    >
                      Close
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {closedTrades.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recent closed
          </h3>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs text-slate-400">
            {closedTrades.map((t) => {
              const pnl =
                t.exitPrice !== undefined
                  ? t.contracts * t.exitPrice - t.stakeDollars
                  : 0
              return (
                <li key={t.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {t.side} {t.ticker}
                  </span>
                  <span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {pnl >= 0 ? '+' : ''}
                    {formatDollars(pnl)}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </aside>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  const color =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-slate-100'
  return (
    <div className="rounded-xl bg-slate-950/50 px-3 py-2 text-left">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  )
}

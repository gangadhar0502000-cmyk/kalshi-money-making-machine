import type { PaperJournalEntry, RuleStats } from '../../types/crypto15m'
import { PAPER } from '../../lib/crypto15m/ruleConfig'
import { ruleLabel } from '../../lib/crypto15m/journal'
import { formatDollars } from '../../lib/format'

interface Props {
  entries: PaperJournalEntry[]
  stats: RuleStats[]
  onMark: (
    id: string,
    outcome: 'yes' | 'no' | 'void' | 'manual_win' | 'manual_loss',
  ) => void
  onClear: () => void
}

export function PaperJournalPanel({ entries, stats, onMark, onClear }: Props) {
  return (
    <div className="panel p-4 text-left">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Paper journal</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Goal: <strong className="text-slate-300">kill losing rules</strong>. Fees estimated with
            ceil(0.07·C·P·(1−P)).
          </p>
        </div>
        <button type="button" className="btn btn-ghost text-xs" onClick={onClear}>
          Clear
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats
          .filter((s) => s.n > 0 || !['wide_spread_block', 'thin_book_block', 'extreme_late_block'].includes(s.ruleId))
          .map((s) => (
            <div
              key={s.ruleId}
              className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
            >
              <div className="text-[11px] font-semibold text-slate-200">{ruleLabel(s.ruleId)}</div>
              <div className="mt-1 font-mono text-xs text-slate-400">
                n={s.n} · W{s.wins}/L{s.losses} · pend {s.pending}
              </div>
              <div className="mt-0.5 font-mono text-xs">
                WR{' '}
                {s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(0)}%`} · net{' '}
                <span className={s.netAfterFees >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {formatDollars(s.netAfterFees)}
                </span>
              </div>
              {s.n > 0 && s.n < PAPER.minSampleToDiscuss && (
                <div className="mt-1 text-[10px] text-amber-400/90">
                  Sample &lt; {PAPER.minSampleToDiscuss} — do not promote
                </div>
              )}
            </div>
          ))}
      </div>

      {entries.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">
          No paper trades yet. When an experiment suggests PAPER YES/NO, log it here. Until a rule
          survives paper with size, you have no edge.
        </p>
      ) : (
        <ul className="mt-4 max-h-80 space-y-2 overflow-y-auto">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-200">
                  {e.side} {e.marketTicker}
                </span>
                <span className="font-mono text-slate-500">{ruleLabel(e.ruleId)}</span>
              </div>
              <div className="mt-0.5 font-mono text-slate-400">
                entry {(e.entry * 100).toFixed(0)}¢ · {e.contracts}c · fee≈$
                {e.feeEstimate.toFixed(2)} · {e.minutesRemainingAtEntry.toFixed(1)}m left ·{' '}
                {e.outcome}
                {e.netAfterFees != null && (
                  <>
                    {' '}
                    · net{' '}
                    <span className={e.netAfterFees >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {formatDollars(e.netAfterFees)}
                    </span>
                  </>
                )}
              </div>
              {e.outcome === 'pending' && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" className="btn btn-ghost !px-2 !py-1 text-[10px]" onClick={() => onMark(e.id, 'yes')}>
                    Resolved YES
                  </button>
                  <button type="button" className="btn btn-ghost !px-2 !py-1 text-[10px]" onClick={() => onMark(e.id, 'no')}>
                    Resolved NO
                  </button>
                  <button type="button" className="btn btn-ghost !px-2 !py-1 text-[10px]" onClick={() => onMark(e.id, 'manual_win')}>
                    Manual win
                  </button>
                  <button type="button" className="btn btn-ghost !px-2 !py-1 text-[10px]" onClick={() => onMark(e.id, 'manual_loss')}>
                    Manual loss
                  </button>
                  <button type="button" className="btn btn-ghost !px-2 !py-1 text-[10px]" onClick={() => onMark(e.id, 'void')}>
                    Void
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import type {
  Crypto15mMarket,
  ExperimentSuggestion,
  RuleEvalResult,
} from '../../types/crypto15m'
import { RULE_HYPOTHESES, evaluateRules } from '../../lib/crypto15m/rules'
import {
  EARLY_MOMENTUM,
  EXTREME_LATE_BLOCK,
  LATE_FADE,
  THIN_BOOK_BLOCK,
  WIDE_SPREAD_BLOCK,
} from '../../lib/crypto15m/ruleConfig'
import { formatCents } from '../../lib/format'

interface Props {
  market: Crypto15mMarket | null
  onTakePaper: (suggestion: ExperimentSuggestion, market: Crypto15mMarket) => void
}

export function RuleExperimentsPanel({ market, onTakePaper }: Props) {
  if (!market) {
    return (
      <div className="panel p-4 text-sm text-slate-400">
        Select a market to run <strong className="text-slate-300">EXPERIMENTS</strong> against it.
        Default outcome is NO TRADE.
      </div>
    )
  }

  const { results, suggestion, vetoed, vetoReasons } = evaluateRules(market)

  return (
    <div className="panel p-4 text-left">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400">
            Experiments — not advice
          </p>
          <h2 className="text-sm font-semibold text-slate-100">Rule candidates</h2>
        </div>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
          knobs → ruleConfig.ts
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        These are hypotheses. <strong className="text-slate-300">No edge until a rule survives paper.</strong>{' '}
        Most ticks should resolve to NO TRADE.
      </p>

      <div className="mt-3 space-y-2">
        {RULE_HYPOTHESES.map((h) => {
          const r = results.find((x) => x.ruleId === h.id)
          return <RuleRow key={h.id} hyp={h.name} isVeto={h.isVeto} result={r} text={h.hypothesis} />
        })}
      </div>

      <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Lab output for this market
        </div>
        {vetoed ? (
          <p className="mt-1 text-sm font-semibold text-slate-200">
            NO TRADE <span className="font-normal text-slate-400">— veto:</span>{' '}
            {vetoReasons.join(' · ')}
          </p>
        ) : suggestion ? (
          <div className="mt-1">
            <p className="text-sm font-semibold text-amber-200">
              PAPER suggestion: {suggestion.action.replace('PAPER_', '')} @ ~
              {formatCents(suggestion.entry)}
            </p>
            <p className="mt-1 text-xs text-slate-400">{suggestion.reason}</p>
            <p className="mt-1 text-[11px] italic text-slate-500">{suggestion.hypothesis}</p>
            <button
              type="button"
              className="btn btn-primary mt-3 w-full text-xs"
              onClick={() => onTakePaper(suggestion, market)}
            >
              Log paper trade (local journal)
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm font-semibold text-slate-200">
            NO TRADE <span className="font-normal text-slate-400">— no hypothesis matched</span>
          </p>
        )}
      </div>

      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer text-slate-400">Active constants (read-only)</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] text-slate-400">
{`LATE_FADE lastMinutes=${LATE_FADE.lastMinutes} minMovePp=${LATE_FADE.minMovePp}
EARLY_MOMENTUM firstMinutes=${EARLY_MOMENTUM.firstMinutes} minMovePp=${EARLY_MOMENTUM.minMovePp}
WIDE_SPREAD max=${WIDE_SPREAD_BLOCK.maxSpreadCents}¢
EXTREME_LATE ≤${EXTREME_LATE_BLOCK.minutesRemainingMax}m outside [${EXTREME_LATE_BLOCK.extremeLow},${EXTREME_LATE_BLOCK.extremeHigh}]
THIN_BOOK minSize=${THIN_BOOK_BLOCK.minBidSize}`}
        </pre>
      </details>
    </div>
  )
}

function RuleRow({
  hyp,
  isVeto,
  result,
  text,
}: {
  hyp: string
  isVeto: boolean
  result?: RuleEvalResult
  text: string
}) {
  const matched = result?.matched
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        matched
          ? isVeto
            ? 'border-rose-800/60 bg-rose-950/20'
            : 'border-amber-700/50 bg-amber-950/20'
          : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">
          {hyp}{' '}
          <span className="font-normal text-slate-500">{isVeto ? '· veto' : '· signal'}</span>
        </span>
        <span className="font-mono text-[10px] text-slate-400">
          {matched ? (isVeto ? 'MATCH→NO TRADE' : result?.action) : 'idle'}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{text}</p>
      {result && (
        <p className="mt-1 font-mono text-[10px] text-slate-400">{result.reason}</p>
      )}
    </div>
  )
}

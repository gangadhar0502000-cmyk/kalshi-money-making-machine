import type {
  Crypto15mMarket,
  ExperimentAction,
  ExperimentSuggestion,
  MidSample,
  RuleEvalResult,
  RuleHypothesis,
  RuleId,
} from '../../types/crypto15m'
import { midMovePp, midMovePpFromHistory } from './midHistory'
import {
  EARLY_MOMENTUM,
  EXTREME_LATE_BLOCK,
  LATE_FADE,
  THIN_BOOK_BLOCK,
  WIDE_SPREAD_BLOCK,
} from './ruleConfig'

export const RULE_HYPOTHESES: RuleHypothesis[] = [
  {
    id: 'wide_spread_block',
    name: 'Wide-spread veto',
    hypothesis:
      'If YES spread > maxSpreadCents, any edge is eaten by the book — default NO TRADE.',
    isVeto: true,
  },
  {
    id: 'thin_book_block',
    name: 'Thin-book veto',
    hypothesis:
      'If size is tiny or mid is locked near 0/1, fills are fantasy — default NO TRADE.',
    isVeto: true,
  },
  {
    id: 'extreme_late_block',
    name: 'Extreme late veto',
    hypothesis:
      'If little time remains and mid is already extreme, late entries are coin-flip noise — NO TRADE.',
    isVeto: true,
  },
  {
    id: 'late_fade',
    name: 'Late-window fade',
    hypothesis:
      'In the last N minutes, a sharp mid move often overshoots; fading may mean-revert into settlement. UNPROVEN.',
    isVeto: false,
  },
  {
    id: 'early_momentum',
    name: 'Early momentum',
    hypothesis:
      'In the first N minutes, continuing a sharp move may capture short-horizon momentum. UNPROVEN.',
    isVeto: false,
  },
]

const HYP_BY_ID = Object.fromEntries(RULE_HYPOTHESES.map((h) => [h.id, h])) as Record<
  RuleId,
  RuleHypothesis
>

function evalWideSpread(m: Crypto15mMarket): RuleEvalResult {
  if (!WIDE_SPREAD_BLOCK.enabled) {
    return { ruleId: 'wide_spread_block', action: 'NO_TRADE', matched: false, reason: 'disabled' }
  }
  if (m.spreadCents > WIDE_SPREAD_BLOCK.maxSpreadCents) {
    return {
      ruleId: 'wide_spread_block',
      action: 'NO_TRADE',
      matched: true,
      reason: `Spread ${m.spreadCents.toFixed(1)}¢ > ${WIDE_SPREAD_BLOCK.maxSpreadCents}¢ → NO TRADE`,
    }
  }
  return {
    ruleId: 'wide_spread_block',
    action: 'NO_TRADE',
    matched: false,
    reason: `Spread ${m.spreadCents.toFixed(1)}¢ OK`,
  }
}

function evalThinBook(m: Crypto15mMarket): RuleEvalResult {
  if (!THIN_BOOK_BLOCK.enabled) {
    return { ruleId: 'thin_book_block', action: 'NO_TRADE', matched: false, reason: 'disabled' }
  }
  if (m.midYes <= THIN_BOOK_BLOCK.lockedLow || m.midYes >= THIN_BOOK_BLOCK.lockedHigh) {
    return {
      ruleId: 'thin_book_block',
      action: 'NO_TRADE',
      matched: true,
      reason: `Mid ${(m.midYes * 100).toFixed(0)}¢ locked extreme → NO TRADE`,
    }
  }
  const thinSize =
    (m.yesBidSize > 0 && m.yesBidSize < THIN_BOOK_BLOCK.minBidSize) ||
    (m.yesAskSize > 0 && m.yesAskSize < THIN_BOOK_BLOCK.minAskSize)
  if (thinSize) {
    return {
      ruleId: 'thin_book_block',
      action: 'NO_TRADE',
      matched: true,
      reason: `Thin size bid=${m.yesBidSize.toFixed(0)} ask=${m.yesAskSize.toFixed(0)} → NO TRADE`,
    }
  }
  return {
    ruleId: 'thin_book_block',
    action: 'NO_TRADE',
    matched: false,
    reason: 'Book depth OK (or sizes unknown)',
  }
}

function evalExtremeLate(m: Crypto15mMarket): RuleEvalResult {
  if (!EXTREME_LATE_BLOCK.enabled) {
    return {
      ruleId: 'extreme_late_block',
      action: 'NO_TRADE',
      matched: false,
      reason: 'disabled',
    }
  }
  if (
    m.minutesRemaining <= EXTREME_LATE_BLOCK.minutesRemainingMax &&
    (m.midYes < EXTREME_LATE_BLOCK.extremeLow || m.midYes > EXTREME_LATE_BLOCK.extremeHigh)
  ) {
    return {
      ruleId: 'extreme_late_block',
      action: 'NO_TRADE',
      matched: true,
      reason: `${m.minutesRemaining.toFixed(1)}m left + mid ${(m.midYes * 100).toFixed(0)}¢ extreme → NO TRADE`,
    }
  }
  return {
    ruleId: 'extreme_late_block',
    action: 'NO_TRADE',
    matched: false,
    reason: 'Not in extreme-late band',
  }
}

type MoveFn = (lookbackMs: number, now: number) => number | null

function evalLateFade(m: Crypto15mMarket, moveFn: MoveFn): RuleEvalResult {
  if (!LATE_FADE.enabled) {
    return { ruleId: 'late_fade', action: 'NO_TRADE', matched: false, reason: 'disabled' }
  }
  if (m.minutesRemaining > LATE_FADE.lastMinutes) {
    return {
      ruleId: 'late_fade',
      action: 'NO_TRADE',
      matched: false,
      reason: `${m.minutesRemaining.toFixed(1)}m left > ${LATE_FADE.lastMinutes}m window`,
    }
  }
  const move = moveFn(LATE_FADE.lookbackMs, Date.now())
  if (move === null) {
    return {
      ruleId: 'late_fade',
      action: 'NO_TRADE',
      matched: false,
      reason: 'Need mid history — keep polling',
    }
  }
  if (Math.abs(move) < LATE_FADE.minMovePp) {
    return {
      ruleId: 'late_fade',
      action: 'NO_TRADE',
      matched: false,
      reason: `Move ${move >= 0 ? '+' : ''}${move.toFixed(1)}pp < ${LATE_FADE.minMovePp}pp`,
    }
  }
  const action: ExperimentAction = move > 0 ? 'PAPER_NO' : 'PAPER_YES'
  return {
    ruleId: 'late_fade',
    action,
    matched: true,
    reason: `Late fade: mid ${move >= 0 ? '+' : ''}${move.toFixed(1)}pp → ${action}`,
  }
}

function evalEarlyMomentum(m: Crypto15mMarket, moveFn: MoveFn): RuleEvalResult {
  if (!EARLY_MOMENTUM.enabled) {
    return { ruleId: 'early_momentum', action: 'NO_TRADE', matched: false, reason: 'disabled' }
  }
  if (m.minutesElapsed > EARLY_MOMENTUM.firstMinutes) {
    return {
      ruleId: 'early_momentum',
      action: 'NO_TRADE',
      matched: false,
      reason: `${m.minutesElapsed.toFixed(1)}m elapsed > ${EARLY_MOMENTUM.firstMinutes}m`,
    }
  }
  const move = moveFn(EARLY_MOMENTUM.lookbackMs, Date.now())
  if (move === null) {
    return {
      ruleId: 'early_momentum',
      action: 'NO_TRADE',
      matched: false,
      reason: 'Need mid history — keep polling',
    }
  }
  if (Math.abs(move) < EARLY_MOMENTUM.minMovePp) {
    return {
      ruleId: 'early_momentum',
      action: 'NO_TRADE',
      matched: false,
      reason: `Move ${move >= 0 ? '+' : ''}${move.toFixed(1)}pp < ${EARLY_MOMENTUM.minMovePp}pp`,
    }
  }
  const action: ExperimentAction = move > 0 ? 'PAPER_YES' : 'PAPER_NO'
  return {
    ruleId: 'early_momentum',
    action,
    matched: true,
    reason: `Early momentum: mid ${move >= 0 ? '+' : ''}${move.toFixed(1)}pp → ${action}`,
  }
}

function finalizeEval(
  m: Crypto15mMarket,
  moveFn: MoveFn,
  suggestedAtIso?: string,
): {
  results: RuleEvalResult[]
  suggestion: ExperimentSuggestion | null
  vetoed: boolean
  vetoReasons: string[]
} {
  // Bind "now" for moveFn via wrapper that uses market clock if provided through moveFn itself
  const vetoes = [evalWideSpread(m), evalThinBook(m), evalExtremeLate(m)]
  const signals = [evalLateFade(m, moveFn), evalEarlyMomentum(m, moveFn)]
  const results = [...vetoes, ...signals]

  const activeVetoes = vetoes.filter((r) => r.matched)
  const vetoed = activeVetoes.length > 0
  const vetoReasons = activeVetoes.map((r) => r.reason)

  if (vetoed) {
    return { results, suggestion: null, vetoed: true, vetoReasons }
  }

  const matched = signals.filter((r) => r.matched && r.action !== 'NO_TRADE')
  const pick = matched.find((r) => r.ruleId === 'late_fade') ?? matched[0]
  if (!pick) {
    return { results, suggestion: null, vetoed: false, vetoReasons: [] }
  }

  const side = pick.action === 'PAPER_YES' ? 'YES' : pick.action === 'PAPER_NO' ? 'NO' : null
  if (!side) {
    return { results, suggestion: null, vetoed: false, vetoReasons: [] }
  }

  const entry = side === 'YES' ? m.yesAsk || m.midYes : m.noAsk || 1 - m.midYes
  const hyp = HYP_BY_ID[pick.ruleId]

  const suggestion: ExperimentSuggestion = {
    marketTicker: m.ticker,
    ruleId: pick.ruleId,
    action: pick.action,
    side,
    entry,
    midYes: m.midYes,
    spreadCents: m.spreadCents,
    minutesRemaining: m.minutesRemaining,
    reason: pick.reason,
    hypothesis: hyp.hypothesis,
    feeEstimate1: m.feeEstimate1,
    suggestedAt: suggestedAtIso ?? new Date().toISOString(),
  }

  return { results, suggestion, vetoed: false, vetoReasons: [] }
}

/** Live lab: uses in-memory mid poll history. */
export function evaluateRules(m: Crypto15mMarket): {
  results: RuleEvalResult[]
  suggestion: ExperimentSuggestion | null
  vetoed: boolean
  vetoReasons: string[]
} {
  const moveFn: MoveFn = (lookbackMs, _now) => midMovePp(m.ticker, lookbackMs)
  return finalizeEval(m, moveFn)
}

/**
 * Backtest / offline: mid trail supplied explicitly; "now" is the snapshot clock.
 * moveFn ignores Date.now inside signal evals — we pass snapshot time via closure.
 */
export function evaluateRulesAt(
  m: Crypto15mMarket,
  history: MidSample[],
  nowMs: number,
): {
  results: RuleEvalResult[]
  suggestion: ExperimentSuggestion | null
  vetoed: boolean
  vetoReasons: string[]
} {
  const moveFn: MoveFn = (lookbackMs, _ignored) =>
    midMovePpFromHistory(history, lookbackMs, nowMs)
  // Patch signal evaluators' Date.now usage: we already ignore second arg via closure.
  // Re-bind late/early by temporarily replacing — finalizeEval calls moveFn(lookback, Date.now()).
  // Our moveFn ignores that and uses nowMs. Good.
  return finalizeEval(m, moveFn, new Date(nowMs).toISOString())
}

export function hypothesisFor(id: RuleId): RuleHypothesis {
  return HYP_BY_ID[id]
}

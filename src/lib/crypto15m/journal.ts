import type {
  ExperimentSuggestion,
  JournalOutcome,
  PaperJournalEntry,
  RuleId,
  RuleStats,
} from '../../types/crypto15m'
import type { Crypto15mMarket } from '../../types/crypto15m'
import { estimateKalshiFeeDollars } from './fees'
import { PAPER } from './ruleConfig'
import { RULE_HYPOTHESES } from './rules'

const STORAGE_KEY = 'kalshi-crypto15m-paper-journal-v1'

export function loadJournal(): PaperJournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PaperJournalEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveJournal(entries: PaperJournalEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function takePaperSuggestion(
  suggestion: ExperimentSuggestion,
  market: Crypto15mMarket,
  contracts = PAPER.defaultContracts,
): PaperJournalEntry {
  if (!suggestion.side) {
    throw new Error('Cannot take a NO_TRADE suggestion')
  }
  const fee = estimateKalshiFeeDollars(contracts, suggestion.entry)
  const entry: PaperJournalEntry = {
    id: `pj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ruleId: suggestion.ruleId,
    marketTicker: market.ticker,
    title: market.title,
    side: suggestion.side,
    entry: suggestion.entry,
    feeEstimate: fee,
    minutesRemainingAtEntry: suggestion.minutesRemaining,
    suggestedAt: suggestion.suggestedAt,
    takenAt: new Date().toISOString(),
    closeTime: market.closeTime,
    outcome: 'pending',
    contracts,
    note: suggestion.reason,
  }
  const all = loadJournal()
  all.unshift(entry)
  saveJournal(all)
  return entry
}

function pnlFor(
  entry: number,
  won: boolean,
  contracts: number,
  fee: number,
): number {
  // Binary $1 contract: win → (1 - entry) * C; lose → -entry * C; then subtract fee
  const gross = won ? (1 - entry) * contracts : -entry * contracts
  return gross - fee
}

export function markOutcome(
  id: string,
  outcome: Exclude<JournalOutcome, 'pending'>,
): PaperJournalEntry[] {
  const all = loadJournal()
  const next = all.map((e) => {
    if (e.id !== id) return e
    let net = e.netAfterFees
    if (outcome === 'void') {
      net = -e.feeEstimate // fees may still apply; conservative
    } else if (outcome === 'yes' || outcome === 'no') {
      const won =
        (outcome === 'yes' && e.side === 'YES') || (outcome === 'no' && e.side === 'NO')
      net = pnlFor(e.entry, won, e.contracts, e.feeEstimate)
    } else if (outcome === 'manual_win') {
      net = pnlFor(e.entry, true, e.contracts, e.feeEstimate)
    } else if (outcome === 'manual_loss') {
      net = pnlFor(e.entry, false, e.contracts, e.feeEstimate)
    }
    return {
      ...e,
      outcome,
      resolvedAt: new Date().toISOString(),
      netAfterFees: net,
    }
  })
  saveJournal(next)
  return next
}

export function computeRuleStats(entries: PaperJournalEntry[]): RuleStats[] {
  const ids = RULE_HYPOTHESES.map((h) => h.id)
  return ids.map((ruleId) => {
    const rows = entries.filter((e) => e.ruleId === ruleId)
    const pending = rows.filter((e) => e.outcome === 'pending').length
    const decided = rows.filter((e) => e.outcome !== 'pending' && e.outcome !== 'void')
    const wins = decided.filter((e) => {
      if (e.outcome === 'manual_win') return true
      if (e.outcome === 'manual_loss') return false
      return (
        (e.outcome === 'yes' && e.side === 'YES') || (e.outcome === 'no' && e.side === 'NO')
      )
    }).length
    const losses = decided.length - wins
    const netAfterFees = rows.reduce((s, e) => s + (e.netAfterFees ?? 0), 0)
    return {
      ruleId,
      n: rows.length,
      wins,
      losses,
      pending,
      winRate: decided.length ? wins / decided.length : null,
      netAfterFees,
    }
  })
}

export function clearJournal(): void {
  saveJournal([])
}

export function ruleLabel(id: RuleId): string {
  return RULE_HYPOTHESES.find((h) => h.id === id)?.name ?? id
}

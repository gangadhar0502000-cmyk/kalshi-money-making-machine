import type { Crypto15mMarket, MidSample, RuleId } from '../../../types/crypto15m'
import { estimateKalshiFeeDollars } from '../fees'
import { feePerContract } from '../fees'
import { PAPER } from '../ruleConfig'
import { evaluateRulesAt, RULE_HYPOTHESES } from '../rules'
import type {
  BacktestResult,
  BacktestRuleAgg,
  BacktestSnapshot,
  BacktestTrade,
  HistoricalMarketWindow,
} from './types'

function snapshotToMarket(
  w: HistoricalMarketWindow,
  s: BacktestSnapshot,
): Crypto15mMarket {
  const noBid = s.yesAsk > 0 ? Math.max(0, 1 - s.yesAsk) : 0
  const noAsk = s.yesBid > 0 ? Math.max(0, 1 - s.yesBid) : 0
  return {
    ticker: w.ticker,
    eventTicker: w.eventTicker,
    seriesTicker: w.seriesTicker,
    asset: w.seriesTicker.replace(/^KX/, '').replace(/15M$/, '') || 'CRYPTO',
    title: w.title,
    status: 'active',
    openTime: w.openTime,
    closeTime: w.closeTime,
    yesBid: s.yesBid,
    yesAsk: s.yesAsk,
    noBid,
    noAsk,
    midYes: s.midYes,
    spreadCents: s.spreadCents,
    last: s.last,
    volume: s.volume,
    volume24h: s.volume,
    openInterest: 0,
    yesBidSize: s.yesBidSize,
    yesAskSize: s.yesAskSize,
    floorStrike: null,
    rulesPrimary: '',
    kalshiUrl: `https://kalshi.com/markets/${w.ticker}`,
    windowMinutes: s.windowMinutes,
    minutesElapsed: s.minutesElapsed,
    minutesRemaining: s.minutesRemaining,
    feeEstimate1: feePerContract(s.midYes),
    thinBook: s.spreadCents >= 6,
    raw: {
      ticker: w.ticker,
      event_ticker: w.eventTicker,
      status: 'active',
      close_time: w.closeTime,
      open_time: w.openTime,
      result: w.result,
    },
  }
}

function pnl(entry: number, won: boolean, contracts: number, fee: number): number {
  const gross = won ? (1 - entry) * contracts : -entry * contracts
  return gross - fee
}

/**
 * Replay one window: walk minute snapshots, accumulate mid history,
 * take at most ONE trade (first signal that survives vetoes) — mirrors live lab.
 */
export function replayWindow(w: HistoricalMarketWindow): {
  trade: BacktestTrade | null
  vetoCounts: Partial<Record<RuleId, number>>
} {
  const hist: MidSample[] = []
  const vetoCounts: Partial<Record<RuleId, number>> = {}
  let trade: BacktestTrade | null = null

  for (const s of w.snapshots) {
    hist.push({ t: s.t, mid: s.midYes })
    const m = snapshotToMarket(w, s)
    const { results, suggestion, vetoed } = evaluateRulesAt(m, hist, s.t)

    for (const r of results) {
      if (r.matched && RULE_HYPOTHESES.find((h) => h.id === r.ruleId)?.isVeto) {
        vetoCounts[r.ruleId] = (vetoCounts[r.ruleId] ?? 0) + 1
      }
    }

    if (trade) continue
    if (vetoed || !suggestion || !suggestion.side) continue

    const contracts = PAPER.defaultContracts
    const fee = estimateKalshiFeeDollars(contracts, suggestion.entry)
    const won =
      (w.result === 'yes' && suggestion.side === 'YES') ||
      (w.result === 'no' && suggestion.side === 'NO')

    trade = {
      ticker: w.ticker,
      title: w.title,
      seriesTicker: w.seriesTicker,
      ruleId: suggestion.ruleId,
      side: suggestion.side,
      entry: suggestion.entry,
      feeDollars: fee,
      contracts,
      minutesRemainingAtEntry: suggestion.minutesRemaining,
      minutesElapsedAtEntry: m.minutesElapsed,
      entryAt: new Date(s.t).toISOString(),
      settlement: w.result,
      won,
      netAfterFees: pnl(suggestion.entry, won, contracts, fee),
      reason: suggestion.reason,
      dataKind: w.dataKind,
    }
  }

  return { trade, vetoCounts }
}

function aggregate(
  trades: BacktestTrade[],
  vetoTotals: Partial<Record<RuleId, number>>,
): BacktestRuleAgg[] {
  return RULE_HYPOTHESES.map((h) => {
    if (h.isVeto) {
      const fires = vetoTotals[h.id] ?? 0
      return {
        ruleId: h.id,
        name: h.name,
        isVeto: true,
        n: 0,
        wins: 0,
        losses: 0,
        winRate: null,
        netDollars: 0,
        maxDrawdown: 0,
        profitFactor: null,
        vetoFires: fires,
      }
    }

    const rows = trades.filter((t) => t.ruleId === h.id)
    const wins = rows.filter((t) => t.won).length
    const losses = rows.length - wins
    let equity = 0
    let peak = 0
    let maxDd = 0
    let grossWin = 0
    let grossLoss = 0
    for (const t of rows) {
      equity += t.netAfterFees
      peak = Math.max(peak, equity)
      maxDd = Math.max(maxDd, peak - equity)
      if (t.netAfterFees >= 0) grossWin += t.netAfterFees
      else grossLoss += Math.abs(t.netAfterFees)
    }
    const net = rows.reduce((s, t) => s + t.netAfterFees, 0)
    return {
      ruleId: h.id,
      name: h.name,
      isVeto: false,
      n: rows.length,
      wins,
      losses,
      winRate: rows.length ? wins / rows.length : null,
      netDollars: net,
      maxDrawdown: maxDd,
      profitFactor: rows.length >= 1 ? (grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null) : null,
      vetoFires: 0,
    }
  })
}

export function runBacktestEngine(
  windows: HistoricalMarketWindow[],
  meta: {
    dataSourceLabel: string
    dataMode: BacktestResult['dataMode']
    notes: string[]
  },
): BacktestResult {
  const trades: BacktestTrade[] = []
  const vetoTotals: Partial<Record<RuleId, number>> = {}
  let noTrade = 0

  for (const w of windows) {
    if (w.snapshots.length < 2) {
      noTrade++
      continue
    }
    const { trade, vetoCounts } = replayWindow(w)
    for (const [k, v] of Object.entries(vetoCounts) as [RuleId, number][]) {
      vetoTotals[k] = (vetoTotals[k] ?? 0) + v
    }
    if (trade) trades.push(trade)
    else noTrade++
  }


  return {
    ranAt: new Date().toISOString(),
    dataSourceLabel: meta.dataSourceLabel,
    dataMode: meta.dataMode,
    marketsTested: windows.length,
    windowsNoTrade: noTrade,
    windowsWithTrade: trades.length,
    trades,
    perRule: aggregate(trades, vetoTotals),
    notes: meta.notes,
  }
}

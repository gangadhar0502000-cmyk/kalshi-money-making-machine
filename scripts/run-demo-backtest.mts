import { runCrypto15mBacktest } from '../src/lib/crypto15m/backtest/runBacktest.ts'

async function main() {
  const mode = (process.argv[2] as 'demo' | 'bundled' | 'auto' | 'live') || 'bundled'
  const r = await runCrypto15mBacktest({ mode })
  console.log(JSON.stringify({
    mode: r.dataMode,
    label: r.dataSourceLabel,
    markets: r.marketsTested,
    noTrade: r.windowsNoTrade,
    trades: r.windowsWithTrade,
    notes: r.notes,
    perRule: r.perRule.map(x => ({
      id: x.ruleId, n: x.n, wins: x.wins, losses: x.losses,
      winRate: x.winRate, net: +x.netDollars.toFixed(2),
      dd: +x.maxDrawdown.toFixed(2),
      pf: x.profitFactor === Infinity ? 'Inf' : (x.profitFactor == null ? null : +x.profitFactor.toFixed(2)),
      vetoFires: x.vetoFires
    })),
    sampleTrades: r.trades.slice(0, 15).map(t => ({
      ticker: t.ticker, rule: t.ruleId, side: t.side,
      entryC: +(t.entry * 100).toFixed(0), settle: t.settlement, won: t.won,
      net: +t.netAfterFees.toFixed(2), kind: t.dataKind
    }))
  }, null, 2))
}
main()

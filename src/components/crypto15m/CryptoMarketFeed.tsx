import type { Crypto15mMarket } from '../../types/crypto15m'
import { formatCents, formatVolume } from '../../lib/format'

interface Props {
  markets: Crypto15mMarket[]
  selectedTicker: string | null
  onSelect: (ticker: string) => void
}

export function CryptoMarketFeed({ markets, selectedTicker, onSelect }: Props) {
  if (markets.length === 0) {
    return (
      <div className="panel p-6 text-sm text-slate-400">
        No open crypto 15m markets found. Demo fixtures load automatically when the live API is
        unreachable. Try Refresh.
      </div>
    )
  }

  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-800 px-4 py-3 text-left">
        <h2 className="text-sm font-semibold text-slate-100">Crypto 15m market feed</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Filtered to Kalshi series like KXBTC15M / KXETH15M (up/down in next 15 mins). Not a signal
          list.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 font-medium">Left</th>
              <th className="px-3 py-2 font-medium">YES bid/ask</th>
              <th className="px-3 py-2 font-medium">Mid</th>
              <th className="px-3 py-2 font-medium">Spr</th>
              <th className="px-3 py-2 font-medium">Vol</th>
              <th className="px-3 py-2 font-medium">Fee≈1</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => {
              const sel = m.ticker === selectedTicker
              return (
                <tr
                  key={m.ticker}
                  onClick={() => onSelect(m.ticker)}
                  className={`cursor-pointer border-t border-slate-800/80 transition hover:bg-slate-800/40 ${
                    sel ? 'bg-emerald-950/30' : ''
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-100">
                      <span className="mr-1.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                        {m.asset}
                      </span>
                      {m.title}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">{m.ticker}</div>
                    {m.thinBook && (
                      <div className="mt-0.5 text-[11px] font-semibold text-amber-400">
                        Thin book warning
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-200">
                    {fmtLeft(m.minutesRemaining)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">
                    {formatCents(m.yesBid)}/{formatCents(m.yesAsk)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-emerald-300">
                    {formatCents(m.midYes)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">
                    {m.spreadCents.toFixed(1)}¢
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">
                    {formatVolume(m.volume)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">
                    ${m.feeEstimate1.toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function fmtLeft(mins: number): string {
  if (mins <= 0) return 'closed'
  if (mins < 1) return `${Math.round(mins * 60)}s`
  const m = Math.floor(mins)
  const s = Math.round((mins - m) * 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

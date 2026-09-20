import { useEffect, useState } from 'react'
import type { Crypto15mMarket } from '../../types/crypto15m'
import { getMidHistory } from '../../lib/crypto15m/midHistory'
import { formatCents } from '../../lib/format'

interface Props {
  market: Crypto15mMarket | null
}

export function LiveContextPanel({ market }: Props) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  if (!market) {
    return (
      <div className="panel p-4 text-sm text-slate-400">
        Select a market in the feed for live context (countdown, mid trail, liquidity warnings).
      </div>
    )
  }

  const hist = getMidHistory(market.ticker)
  const closeMs = new Date(market.closeTime).getTime()
  const leftMs = Math.max(0, closeMs - Date.now())
  const leftMin = leftMs / 60_000

  return (
    <div className="panel p-4 text-left">
      <h2 className="text-sm font-semibold text-slate-100">Live context</h2>
      <p className="mt-1 text-xs text-slate-500">{market.title}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat
          label="Countdown"
          value={leftMs <= 0 ? 'ENDED' : `${Math.floor(leftMin)}m ${Math.floor((leftMs / 1000) % 60)
            .toString()
            .padStart(2, '0')}s`}
          warn={leftMin < 2}
        />
        <Stat label="Mid" value={formatCents(market.midYes)} />
        <Stat label="Spread" value={`${market.spreadCents.toFixed(1)}¢`} warn={market.thinBook} />
        <Stat
          label="Fee≈1@"
          value={`$${market.feeEstimate1.toFixed(2)} @ mid`}
        />
      </div>

      {market.thinBook && (
        <div className="mt-3 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Liquidity warning: wide spread, tiny size, and/or locked mid. Paper fills here are fantasy.
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
          Mid history (polled)
        </div>
        {hist.length < 2 ? (
          <p className="text-xs text-slate-500">
            Collecting samples… keep the lab open; rules need a short trail.
          </p>
        ) : (
          <div className="flex h-16 items-end gap-0.5 rounded-lg bg-slate-950/60 p-2">
            {hist.slice(-40).map((s, i) => {
              const h = Math.max(4, s.mid * 56)
              return (
                <div
                  key={`${s.t}-${i}`}
                  title={`${formatCents(s.mid)}`}
                  className="flex-1 rounded-sm bg-emerald-500/70"
                  style={{ height: h }}
                />
              )
            })}
          </div>
        )}
        <p className="mt-1 font-mono text-[11px] text-slate-500">
          {hist.length} samples · last {hist.length ? formatCents(hist[hist.length - 1]!.mid) : '—'}
        </p>
      </div>

      {market.floorStrike != null && (
        <p className="mt-3 text-xs text-slate-500">
          Floor / reference strike (API): {market.floorStrike.toLocaleString()}
        </p>
      )}

      <a
        className="btn btn-ghost mt-4 w-full text-xs"
        href={market.kalshiUrl}
        target="_blank"
        rel="noreferrer"
      >
        Open on Kalshi
      </a>
    </div>
  )
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string
  value: string
  warn?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold ${warn ? 'text-amber-300' : 'text-slate-100'}`}>
        {value}
      </div>
    </div>
  )
}

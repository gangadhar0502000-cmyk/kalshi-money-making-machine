import { useCallback, useRef, useState } from 'react'
import {
  runCrypto15mBacktest,
  type BacktestMode,
} from '../../lib/crypto15m/backtest/runBacktest'
import type { BacktestProgress, BacktestResult } from '../../lib/crypto15m/backtest/types'
import { formatDollars, formatPct } from '../../lib/format'

function modeBadge(mode: BacktestResult['dataMode']): string {
  switch (mode) {
    case 'live_history':
      return 'LIVE Kalshi settled'
    case 'bundled_live_snapshot':
      return 'BUNDLED real snapshot'
    case 'hybrid':
      return 'HYBRID live+bundled'
    case 'demo_synthetic':
      return 'DEMO synthetic'
  }
}

function badgeClass(mode: BacktestResult['dataMode']): string {
  if (mode === 'demo_synthetic') return 'bg-amber-950 text-amber-300'
  if (mode === 'live_history') return 'bg-emerald-950 text-emerald-300'
  return 'bg-sky-950 text-sky-300'
}

export function BacktestPanel() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BacktestProgress | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<BacktestMode>('bundled')
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setError(null)
    setProgress({ phase: 'Starting…', current: 0, total: 1 })
    try {
      const res = await runCrypto15mBacktest({
        mode,
        maxLiveMarkets: mode === 'live' ? 12 : mode === 'auto' ? 6 : 0,
        signal: ac.signal,
        onProgress: setProgress,
      })
      if (!ac.signal.aborted) setResult(res)
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (!ac.signal.aborted) {
        setRunning(false)
        setProgress(null)
      }
    }
  }, [mode])

  const stop = () => {
    abortRef.current?.abort()
    setRunning(false)
    setProgress(null)
  }

  return (
    <div className="panel p-4 text-left">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-400">
            Backtest — after fees
          </p>
          <h2 className="text-sm font-semibold text-slate-100">Crypto 15m rule replay</h2>
        </div>
        <span className="rounded-full border border-rose-900/60 bg-rose-950/40 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
          Past ≠ future. Kill losers.
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Replays experiment rules on <strong className="text-slate-300">settled</strong> Kalshi
        crypto 15m windows (1-minute candlesticks → mid trail). Fees via{' '}
        <code className="text-slate-400">ceil(0.07·C·P·(1−P))</code>. Default: many windows ={' '}
        <strong className="text-slate-300">NO TRADE</strong>.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-slate-500">
          Source{' '}
          <select
            className="ml-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            value={mode}
            disabled={running}
            onChange={(e) => setMode(e.target.value as BacktestMode)}
          >
            <option value="bundled">REAL bundled snapshot (default)</option>
            <option value="auto">Auto (REAL bundled + brief live enrich)</option>
            <option value="live">Live Kalshi API (rate-limited)</option>
            <option value="demo">DEMO synthetic only (not real)</option>
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary text-xs"
          disabled={running}
          onClick={() => void run()}
        >
          {running ? 'Running…' : 'Run backtest'}
        </button>
        {running && (
          <button type="button" className="btn btn-ghost text-xs" onClick={stop}>
            Stop
          </button>
        )}
      </div>

      {progress && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">{progress.phase}</span>
          {progress.total > 0 && (
            <span className="ml-2">
              {progress.current}/{progress.total}
            </span>
          )}
          {progress.detail && <span className="ml-2 text-slate-500">{progress.detail}</span>}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-rose-400">Backtest error: {error}</p>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${badgeClass(result.dataMode)}`}>
              {modeBadge(result.dataMode)}
            </span>
            <span className="text-slate-400">{result.dataSourceLabel}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Windows tested" value={String(result.marketsTested)} />
            <Stat label="NO TRADE windows" value={String(result.windowsNoTrade)} />
            <Stat label="Trades taken" value={String(result.windowsWithTrade)} />
            <Stat
              label="Net (all rules)"
              value={formatDollars(result.trades.reduce((s, t) => s + t.netAfterFees, 0))}
              tone={
                result.trades.reduce((s, t) => s + t.netAfterFees, 0) >= 0 ? 'good' : 'bad'
              }
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">n</th>
                  <th className="px-3 py-2">Win%</th>
                  <th className="px-3 py-2">Net $</th>
                  <th className="px-3 py-2">Max DD</th>
                  <th className="px-3 py-2">PF</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {result.perRule.map((r) => (
                  <tr key={r.ruleId} className="border-t border-slate-800/80">
                    <td className="px-3 py-2 font-medium text-slate-200">
                      {r.name}
                      <div className="text-[10px] font-normal text-slate-500">{r.ruleId}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.isVeto ? '—' : r.n}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.isVeto
                        ? '—'
                        : r.winRate == null
                          ? '—'
                          : formatPct(r.winRate * 100, 0)}
                    </td>
                    <td
                      className={`px-3 py-2 ${
                        r.isVeto
                          ? 'text-slate-500'
                          : r.netDollars >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                      }`}
                    >
                      {r.isVeto ? '—' : formatDollars(r.netDollars)}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.isVeto ? '—' : formatDollars(r.maxDrawdown)}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.isVeto
                        ? '—'
                        : r.profitFactor == null
                          ? '—'
                          : r.profitFactor === Infinity
                            ? '∞'
                            : r.profitFactor.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.isVeto
                        ? `veto fires (tick×window): ${r.vetoFires}`
                        : r.n === 0
                          ? 'no trades — good default'
                          : `${r.wins}W / ${r.losses}L`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.trades.length > 0 && (
            <details className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-300">
                Trade log ({result.trades.length})
              </summary>
              <div className="mt-2 max-h-56 overflow-auto">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Ticker</th>
                      <th className="py-1 pr-2">Rule</th>
                      <th className="py-1 pr-2">Side</th>
                      <th className="py-1 pr-2">Entry</th>
                      <th className="py-1 pr-2">Settle</th>
                      <th className="py-1 pr-2">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={`${t.ticker}-${i}`} className="border-t border-slate-800/60">
                        <td className="py-1 pr-2 font-mono text-slate-400">{t.ticker}</td>
                        <td className="py-1 pr-2 text-slate-300">{t.ruleId}</td>
                        <td className="py-1 pr-2">{t.side}</td>
                        <td className="py-1 pr-2">{(t.entry * 100).toFixed(0)}¢</td>
                        <td className="py-1 pr-2">
                          {t.settlement.toUpperCase()} {t.won ? '✓' : '✗'}
                        </td>
                        <td
                          className={`py-1 pr-2 ${t.netAfterFees >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                        >
                          {formatDollars(t.netAfterFees)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {result.notes.length > 0 && (
            <ul className="list-inside list-disc text-[11px] text-slate-500">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`text-sm font-semibold ${
          tone === 'good'
            ? 'text-emerald-400'
            : tone === 'bad'
              ? 'text-rose-400'
              : 'text-slate-100'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

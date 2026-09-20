import { useEffect, useMemo, useState } from 'react'
import type { Crypto15mMarket } from '../../types/crypto15m'
import { formatCents, formatDollars, formatRelativeTime } from '../../lib/format'
import {
  DEFAULT_PAPER_MM_CONFIG,
  type PaperMmConfig,
} from '../../lib/crypto15m/mm/config'
import { paperMmEngine } from '../../lib/crypto15m/mm/engine'
import type { MmEngineState } from '../../lib/crypto15m/mm/types'

interface Props {
  markets: Crypto15mMarket[]
  selectedTicker: string | null
  onSelect: (ticker: string) => void
  source: 'live' | 'demo'
}

function useEngineState(): MmEngineState {
  const [state, setState] = useState(() => paperMmEngine.getState())
  useEffect(() => paperMmEngine.subscribe(() => setState(paperMmEngine.getState())), [])
  return state
}

export function PaperMmPanel({ markets, selectedTicker, onSelect, source }: Props) {
  const state = useEngineState()
  const { snapshot: s, fills, cancels } = state
  const [draft, setDraft] = useState<PaperMmConfig>(() => ({
    ...DEFAULT_PAPER_MM_CONFIG,
  }))

  const selected = useMemo(
    () => markets.find((m) => m.ticker === selectedTicker) ?? null,
    [markets, selectedTicker],
  )

  useEffect(() => {
    paperMmEngine.setMarket(selected)
  }, [selected])

  // Keep engine synced when parent refreshes mid
  useEffect(() => {
    if (selected) paperMmEngine.onMarketTick(selected)
  }, [selected, selected?.midYes, selected?.yesBid, selected?.yesAsk])

  const applyConfig = () => {
    paperMmEngine.setConfig(draft)
  }

  const guardLive = s.guardMode
    ? `${s.guardMode.toUpperCase()} · until ${new Date(s.guardActiveUntil).toLocaleTimeString()}`
    : 'clear'

  const totalPnl = s.realizedSpreadPnl + s.unrealizedInventoryPnl

  return (
    <div className="space-y-4 text-left">
      <div className="rounded-xl border border-rose-800/50 bg-rose-950/30 px-4 py-3 text-xs text-rose-100/95">
        <strong>Paper only.</strong> Live MM needs API keys. On 15m, bots cancel faster — this
        teaches whether <em>YOUR</em> params survive. Adverse selection is modeled on purpose; do
        not pretend fills are always friendly. No live order placement in this build.
      </div>

      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">
              15m MM (Paper)
            </p>
            <h2 className="text-sm font-semibold text-slate-100">
              Spread capture sim · spot guard
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                source === 'live' ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-amber-300'
              }`}
            >
              {source === 'live' ? 'LIVE markets' : 'DEMO markets'}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                s.running ? 'bg-violet-950 text-violet-200' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {s.running ? 'RUNNING' : 'STOPPED'}
            </span>
          </div>
        </div>

        <p className="mt-2 text-xs text-slate-400">{s.message}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-slate-400">
            Market
            <select
              className="input"
              value={selectedTicker ?? ''}
              onChange={(e) => onSelect(e.target.value)}
              disabled={s.running}
            >
              {markets.length === 0 && <option value="">No markets</option>}
              {markets.map((m) => (
                <option key={m.ticker} value={m.ticker}>
                  {m.asset} · {m.ticker} · mid {(m.midYes * 100).toFixed(0)}¢ ·{' '}
                  {m.minutesRemaining.toFixed(1)}m left
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            {!s.running ? (
              <button type="button" className="btn btn-primary" onClick={() => paperMmEngine.start()}>
                Start paper MM
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => paperMmEngine.stop()}>
                Stop
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (confirm('Reset paper session (cash, inventory, logs)?')) {
                  paperMmEngine.resetSession()
                  setDraft({ ...paperMmEngine.getConfig() })
                }
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Dashboard */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cash" value={formatDollars(s.cash)} />
        <Stat
          label="Inventory (YES)"
          value={`${s.inventory > 0 ? '+' : ''}${s.inventory}`}
          sub={s.avgEntry != null ? `avg ${formatCents(s.avgEntry)}` : 'flat'}
        />
        <Stat
          label="Unrealized (inv)"
          value={formatDollars(s.unrealizedInventoryPnl)}
          tone={s.unrealizedInventoryPnl >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="Realized (spread)"
          value={formatDollars(s.realizedSpreadPnl)}
          tone={s.realizedSpreadPnl >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="Total P&L"
          value={formatDollars(totalPnl)}
          tone={totalPnl >= 0 ? 'good' : 'bad'}
        />
        <Stat
          label="Spot"
          value={
            s.spotPrice != null
              ? `$${s.spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : '—'
          }
          sub={s.spotSource ?? 'polling…'}
        />
        <Stat label="Market mid" value={formatCents(s.midYes)} />
        <Stat label="Spot guard" value={guardLive} tone={s.guardMode ? 'warn' : 'neutral'} />
      </div>

      {/* Live quote */}
      <div className="panel p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Simulated quotes
        </p>
        {s.quote ? (
          <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-sm">
            <span className="text-emerald-300">
              YES bid {formatCents(s.quote.yesBid)} × {s.quote.size}
            </span>
            <span className="text-slate-500">mid {formatCents(s.midYes)}</span>
            <span className="text-rose-300">
              YES ask {formatCents(s.quote.yesAsk)} × {s.quote.size}
            </span>
            <span className="text-xs text-slate-500">
              half {s.quote.halfSpreadCents.toFixed(1)}¢ · skew {s.quote.skewCents.toFixed(2)}¢ ·{' '}
              {s.quote.active ? 'ACTIVE' : 'CANCELLED'}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">No quote — start the paper MM.</p>
        )}
      </div>

      {/* Config knobs */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Config knobs
          </p>
          <button type="button" className="btn btn-ghost !py-1 text-xs" onClick={applyConfig}>
            Apply
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Knob
            label="Half-spread (¢)"
            value={draft.halfSpreadCents}
            step={0.5}
            min={0.5}
            max={20}
            onChange={(v) => setDraft((d) => ({ ...d, halfSpreadCents: v }))}
          />
          <Knob
            label="Size (contracts)"
            value={draft.quoteSize}
            step={1}
            min={1}
            max={100}
            onChange={(v) => setDraft((d) => ({ ...d, quoteSize: v }))}
          />
          <Knob
            label="Max inventory"
            value={draft.maxInventory}
            step={1}
            min={1}
            max={500}
            onChange={(v) => setDraft((d) => ({ ...d, maxInventory: v }))}
          />
          <Knob
            label="Spot move threshold (%)"
            value={draft.spotMovePct}
            step={0.01}
            min={0.01}
            max={5}
            onChange={(v) => setDraft((d) => ({ ...d, spotMovePct: v }))}
          />
          <Knob
            label="Spot move threshold ($)"
            value={draft.spotMoveDollars}
            step={1}
            min={1}
            max={5000}
            onChange={(v) => setDraft((d) => ({ ...d, spotMoveDollars: v }))}
          />
          <Knob
            label="Spot window (sec)"
            value={draft.spotWindowSec}
            step={1}
            min={1}
            max={120}
            onChange={(v) => setDraft((d) => ({ ...d, spotWindowSec: v }))}
          />
          <Knob
            label="Quote refresh (ms)"
            value={draft.quoteRefreshMs}
            step={100}
            min={200}
            max={30_000}
            onChange={(v) => setDraft((d) => ({ ...d, quoteRefreshMs: v }))}
          />
          <Knob
            label="Inv skew ¢ / unit"
            value={draft.inventorySkewCentsPerUnit}
            step={0.05}
            min={0}
            max={2}
            onChange={(v) => setDraft((d) => ({ ...d, inventorySkewCentsPerUnit: v }))}
          />
          <Knob
            label="Toxicity bias"
            value={draft.toxicityBias}
            step={0.02}
            min={0}
            max={0.8}
            onChange={(v) => setDraft((d) => ({ ...d, toxicityBias: v }))}
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Spot guard: if free public BTC/ETH (etc.) spot moves more than X% <em>or</em> $Y within Z
          seconds → cancel / widen / skew. Fills: mid-cross + random with toxicity when spot moved
          against your quote.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LogPanel
          title="Fills log"
          empty="No fills yet."
          rows={fills.map((f) => ({
            id: f.id,
            tone: f.toxic ? 'bad' : 'neutral',
            primary: `${f.side === 'buy_yes' ? 'BUY YES' : 'SELL YES'} ${f.size} @ ${formatCents(f.price)}`,
            secondary: `${f.reason}${f.toxic ? ' · TOXIC' : ''} · mid ${formatCents(f.midAtFill)} · ${new Date(f.t).toLocaleTimeString()}`,
          }))}
        />
        <LogPanel
          title="Spot-guard cancels"
          empty="No guard events yet."
          rows={cancels.map((c) => ({
            id: c.id,
            tone: c.action === 'cancel' ? 'bad' : 'warn',
            primary: `${c.action.toUpperCase()} · spot $${c.spotPrice.toFixed(2)}`,
            secondary: `${c.reason} · ${new Date(c.t).toLocaleTimeString()}`,
          }))}
        />
      </div>

      {s.lastTickAt && (
        <p className="text-[11px] text-slate-600">
          Last engine tick {formatRelativeTime(new Date(s.lastTickAt).toISOString())}
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad' | 'warn' | 'neutral'
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'bad'
        ? 'text-rose-300'
        : tone === 'warn'
          ? 'text-amber-300'
          : 'text-slate-100'
  return (
    <div className="panel px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-mono text-sm font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  )
}

function Knob({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="label !mb-0.5">{label}</span>
      <input
        type="number"
        className="input"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
      />
    </label>
  )
}

function LogPanel({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: { id: string; primary: string; secondary: string; tone: 'bad' | 'warn' | 'neutral' }[]
}) {
  return (
    <div className="panel p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{title}</p>
      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto text-xs">
        {rows.length === 0 && <p className="text-slate-600">{empty}</p>}
        {rows.map((r) => (
          <div
            key={r.id}
            className={`rounded-lg border px-2 py-1.5 ${
              r.tone === 'bad'
                ? 'border-rose-900/50 bg-rose-950/20'
                : r.tone === 'warn'
                  ? 'border-amber-900/40 bg-amber-950/15'
                  : 'border-slate-800 bg-slate-950/40'
            }`}
          >
            <p className="font-medium text-slate-200">{r.primary}</p>
            <p className="text-[10px] text-slate-500">{r.secondary}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

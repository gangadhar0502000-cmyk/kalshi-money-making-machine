import { useEffect, useMemo, useState } from 'react'
import type { Crypto15mMarket } from '../types/crypto15m'
import { getMidHistory } from '../lib/crypto15m/midHistory'
import { normalizeSpotAsset } from '../lib/crypto15m/spot'
import { useContinuousFeed } from './useContinuousFeed'
import { useSpotMap } from './useSpotMap'
import {
  assetShortName,
  deriveV1FeedStatus,
  fmtMinutesLeft,
  fmtPrice,
  fmtSpot,
  fmtSpreadCents,
  sparklinePolylinePoints,
  timeUrgencyClass,
  windowProgress,
} from './feedStatus'

/**
 * v1 Orbit console — probability-first product UI.
 * Feed only. Paper / read-only.
 */
export function V1App() {
  const snap = useContinuousFeed()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 200)
    return () => clearInterval(id)
  }, [])

  const status = useMemo(() => deriveV1FeedStatus(snap, nowMs), [snap, nowMs])
  const markets = snap.markets

  useEffect(() => {
    if (markets.length === 0) {
      setSelected(null)
      return
    }
    if (!selected || !markets.some((m) => m.ticker === selected)) {
      setSelected(markets[0]!.ticker)
    }
  }, [markets, selected])

  const active = markets.find((m) => m.ticker === selected) ?? null
  const assets = useMemo(() => markets.map((m) => m.asset), [markets])
  const spots = useSpotMap(assets)

  const chipClass =
    status.feedTone === 'ok'
      ? 'v1-chip v1-chip--live'
      : status.feedTone === 'amber'
        ? 'v1-chip v1-chip--warn'
        : status.feedTone === 'red'
          ? 'v1-chip v1-chip--off'
          : 'v1-chip'

  return (
    <div className="v1-shell">
      <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        {/* Top nav */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 sm:mb-8">
          <div className="flex items-center gap-3">
            <LogoMark />
            <div>
              <div className="flex items-baseline gap-2">
                <h1 className="font-display text-xl font-bold tracking-tight text-[var(--color-ink)] sm:text-2xl">
                  Kalshi 15m
                </h1>
                <span className="v1-chip">v1</span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-mute)]">
                Paper feed · read-only · never places trades
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={chipClass}>
              <span
                className={`live-pulse inline-block h-1.5 w-1.5 rounded-full ${
                  status.feedTone === 'ok'
                    ? 'bg-[var(--color-accent-2)]'
                    : status.feedTone === 'amber'
                      ? 'bg-[var(--color-warm)]'
                      : status.feedTone === 'red'
                        ? 'bg-[var(--color-danger)]'
                        : 'bg-[var(--color-mute)]'
                }`}
              />
              {status.liveLabel}
            </span>
            <span className="v1-chip num">{status.feedAgeShort}</span>
            <span className="v1-chip">{status.marketCount} open</span>
            <span className="v1-chip">{status.proxyShort}</span>
          </div>
        </header>

        {/* Hero focus */}
        <section className="v1-hero mb-6 p-5 sm:mb-8 sm:p-8">
          {!status.everSucceeded ? (
            <HeroConnecting />
          ) : !active ? (
            <HeroEmpty />
          ) : (
            <HeroMarket
              market={active}
              spot={
                normalizeSpotAsset(active.asset)
                  ? spots[normalizeSpotAsset(active.asset)!] ?? null
                  : null
              }
              nowMs={nowMs}
            />
          )}
        </section>

        {/* Market mosaic */}
        <section className="mb-8 flex-1">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold tracking-wide text-[var(--color-ink)]">
                Open window
              </h2>
              <p className="text-xs text-[var(--color-mute)]">
                Tap a market to focus · sorted by time left
              </p>
            </div>
            {status.lastError && (
              <p
                className="max-w-xs truncate text-right text-[10px] text-[var(--color-mute)]"
                title={status.lastError}
              >
                {status.lastError}
              </p>
            )}
          </div>

          {markets.length === 0 ? (
            <div className="v1-glass rounded-2xl px-6 py-16 text-center text-sm text-[var(--color-mute)]">
              {status.everSucceeded
                ? 'No open crypto 15m contracts in this window.'
                : 'Waiting for the continuous proxy feed…'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {markets.map((m) => {
                const canon = normalizeSpotAsset(m.asset)
                const spot = canon ? spots[canon] ?? null : null
                const on = m.ticker === selected
                return (
                  <button
                    key={m.ticker}
                    type="button"
                    onClick={() => setSelected(m.ticker)}
                    className={`v1-card p-3.5 text-left sm:p-4 ${on ? 'v1-card--active' : ''}`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <span className="rounded-md bg-[rgba(124,108,255,0.15)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[var(--color-accent)]">
                        {m.asset}
                      </span>
                      <span
                        className={`num text-[10px] font-medium ${timeUrgencyClass(m.minutesRemaining)}`}
                      >
                        {fmtMinutesLeft(m.minutesRemaining)}
                      </span>
                    </div>
                    <div className="mb-1 text-xs text-[var(--color-mute)]">
                      {assetShortName(m.asset)}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <div className="num text-2xl font-semibold tracking-tight text-[var(--color-yes)] sm:text-3xl">
                          {Math.round(m.midYes * 100)}
                          <span className="text-base text-[var(--color-mute)]">¢</span>
                        </div>
                        <div className="num mt-1 text-[10px] text-[var(--color-mute)]">
                          {fmtPrice(m.yesBid)} · {fmtPrice(m.yesAsk)}
                        </div>
                      </div>
                      <MiniArc pct={m.midYes} size={44} />
                    </div>
                    {spot != null && (
                      <div className="num mt-2.5 border-t border-[var(--color-line)] pt-2 text-[10px] text-[var(--color-mute)]">
                        Spot {fmtSpot(spot)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <footer className="mt-auto flex items-center justify-between border-t border-[var(--color-line)] pt-4 text-[10px] text-[var(--color-mute)]">
          <span>Continuous proxy cache · 1s UI poll</span>
          <a href="?legacy=1" className="opacity-40 transition hover:opacity-80">
            legacy
          </a>
        </footer>
      </div>
    </div>
  )
}

function LogoMark() {
  return (
    <div
      className="relative flex h-10 w-10 items-center justify-center rounded-xl"
      style={{
        background:
          'linear-gradient(145deg, rgba(124,108,255,0.35), rgba(61,255,192,0.2))',
        boxShadow: '0 0 24px rgba(124,108,255,0.25)',
      }}
      aria-hidden
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="rgba(244,241,234,0.25)" strokeWidth="1.5" />
        <path
          d="M12 3a9 9 0 0 1 0 18"
          stroke="var(--color-accent-2)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="2.5" fill="var(--color-ink)" />
      </svg>
    </div>
  )
}

function HeroConnecting() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-[var(--color-accent)]"
            style={{ animation: `v1-pulse 1.2s ease-in-out ${i * 0.15}s infinite` }}
          />
        ))}
      </div>
      <p className="font-display text-lg font-semibold">Connecting feed</p>
      <p className="max-w-sm text-sm text-[var(--color-mute)]">
        Pulling open crypto 15m markets through the local read-only proxy.
      </p>
    </div>
  )
}

function HeroEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="font-display text-lg font-semibold">Between windows</p>
      <p className="max-w-sm text-sm text-[var(--color-mute)]">
        Feed is up — Kalshi has no open crypto 15m markets right now.
      </p>
    </div>
  )
}

function HeroMarket({
  market,
  spot,
  nowMs,
}: {
  market: Crypto15mMarket
  spot: number | null
  nowMs: number
}) {
  void nowMs
  const mids = getMidHistory(market.ticker).map((s) => s.mid)
  const spark = sparklinePolylinePoints(mids, 320, 72)
  const progress = windowProgress(market.minutesRemaining, 15)
  const pct = Math.round(market.midYes * 100)
  const left = fmtMinutesLeft(market.minutesRemaining)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-[rgba(124,108,255,0.2)] px-2 py-1 text-xs font-bold tracking-wider text-[var(--color-accent)]">
            {market.asset}
          </span>
          <span className="text-sm text-[var(--color-mute)]">
            {assetShortName(market.asset)}
          </span>
          <span className="num hidden text-[10px] text-[var(--color-mute)] sm:inline">
            {market.ticker}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-mute)]">
              YES mid
            </div>
            <div className="num mt-1 font-display text-6xl font-bold leading-none tracking-tight text-[var(--color-yes)] sm:text-7xl">
              {pct}
              <span className="text-3xl text-[var(--color-mute)]">¢</span>
            </div>
          </div>
          <ProbabilityRing pct={market.midYes} />
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-md">
          <Stat label="Bid" value={fmtPrice(market.yesBid)} />
          <Stat label="Ask" value={fmtPrice(market.yesAsk)} />
          <Stat
            label="Spread"
            value={fmtSpreadCents(market.yesBid, market.yesAsk, market.spreadCents)}
          />
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-[11px] text-[var(--color-mute)]">
            <span>Window</span>
            <span className={`num font-medium ${timeUrgencyClass(market.minutesRemaining)}`}>
              {left} left
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] transition-[width] duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        {spot != null && (
          <p className="num mt-4 text-xs text-[var(--color-mute)]">
            Underlying spot {fmtSpot(spot)}
          </p>
        )}
      </div>

      <div className="v1-glass rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-mute)]">
            Mid trail
          </span>
          <span className="num text-[10px] text-[var(--color-mute)]">{mids.length} pts</span>
        </div>
        {spark ? (
          <svg
            viewBox="0 0 320 72"
            className="h-24 w-full"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(61,255,192,0.35)" />
                <stop offset="100%" stopColor="rgba(61,255,192,0)" />
              </linearGradient>
            </defs>
            <polygon
              points={`0,72 ${spark} 320,72`}
              fill="url(#sparkFill)"
            />
            <polyline
              points={spark}
              fill="none"
              stroke="var(--color-accent-2)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <div className="flex h-24 items-center justify-center text-xs text-[var(--color-mute)]">
            Building history…
          </div>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-mute)]">
          Live mid samples from the continuous feed. History grows while this tab stays open.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-mute)]">{label}</div>
      <div className="num mt-0.5 text-sm font-semibold text-[var(--color-ink)]">{value}</div>
    </div>
  )
}

function ProbabilityRing({ pct }: { pct: number }) {
  const p = Math.min(1, Math.max(0, pct))
  const r = 52
  const c = 2 * Math.PI * r
  const dash = c * p
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" className="shrink-0" aria-hidden>
      <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
      <circle
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke="url(#ringGrad)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform="rotate(-90 64 64)"
      />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-accent-2)" />
        </linearGradient>
      </defs>
      <text
        x="64"
        y="68"
        textAnchor="middle"
        className="num"
        fill="var(--color-ink)"
        style={{ fontSize: '18px', fontWeight: 600 }}
      >
        {Math.round(p * 100)}%
      </text>
    </svg>
  )
}

function MiniArc({ pct, size }: { pct: number; size: number }) {
  const p = Math.min(1, Math.max(0, pct))
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const dash = c * p
  const mid = size / 2
  return (
    <svg width={size} height={size} aria-hidden>
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
      <circle
        cx={mid}
        cy={mid}
        r={r}
        fill="none"
        stroke="var(--color-accent-2)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform={`rotate(-90 ${mid} ${mid})`}
      />
    </svg>
  )
}

export default V1App

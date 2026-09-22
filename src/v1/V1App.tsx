import { useEffect, useMemo, useState } from 'react'
import type { Crypto15mMarket } from '../types/crypto15m'
import { getMidHistory } from '../lib/crypto15m/midHistory'
import { normalizeSpotAsset } from '../lib/crypto15m/spot'
import { useContinuousFeed } from './useContinuousFeed'
import { useSpotMap } from './useSpotMap'
import {
  assetShortName,
  betterBookHint,
  deriveV1FeedStatus,
  fmtMinutesLeft,
  fmtPrice,
  fmtSpot,
  fmtSpreadCents,
  midNo,
  sparklinePolylinePoints,
  spreadCentsNo,
  spreadCentsYes,
  timeUrgencyClass,
  windowProgress,
} from './feedStatus'

/**
 * KMM v1 — Money Machine ops console.
 * Unique hacker / print-money aesthetic. Feed only. Paper / read-only.
 * YES and NO are complements (same $ outcome); tighter book → less queue ahead.
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

  const chip =
    status.feedTone === 'ok'
      ? 'kmm-chip kmm-chip--live'
      : status.feedTone === 'amber'
        ? 'kmm-chip kmm-chip--warn'
        : status.feedTone === 'red'
          ? 'kmm-chip kmm-chip--off'
          : 'kmm-chip'

  return (
    <div className="kmm-shell">
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
        {/* OPS HEADER */}
        <header className="kmm-frame kmm-corners mb-4 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center border border-[var(--color-profit)] bg-[rgba(184,255,60,0.08)] font-display text-xs font-bold text-[var(--color-profit)]"
                aria-hidden
              >
                $
              </div>
              <div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <h1 className="font-display text-lg font-bold tracking-tight text-[var(--color-ink)] sm:text-xl">
                    KALSHI MONEY MACHINE
                  </h1>
                  <span className="kmm-chip">v1 · PAPER</span>
                </div>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
                  ops console · continuous feed · read-only · never live
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={chip}>
                <span
                  className={`live-pulse inline-block h-1.5 w-1.5 rounded-full ${
                    status.feedTone === 'ok'
                      ? 'bg-[var(--color-profit)]'
                      : status.feedTone === 'amber'
                        ? 'bg-[var(--color-gold)]'
                        : 'bg-[var(--color-alert)]'
                  }`}
                />
                {status.liveLabel.toUpperCase()}
              </span>
              <span className="kmm-chip num">AGE {status.feedAgeShort.toUpperCase()}</span>
              <span className="kmm-chip num">{status.marketCount} MKTS</span>
              <span className="kmm-chip">PX {status.proxyShort.toUpperCase()}</span>
            </div>
          </div>
        </header>

        {/* HERO TARGET */}
        <section className="kmm-hero kmm-corners mb-4 p-4 sm:p-6">
          {!status.everSucceeded ? (
            <BootBlock label="BOOTING FEED…" sub="local proxy → kalshi L2 (read-only)" />
          ) : !active ? (
            <BootBlock label="NO OPEN WINDOWS" sub="feed healthy · waiting next 15m crypto set" />
          ) : (
            <TargetHero
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

        {/* GRID */}
        <section className="mb-4 flex-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-dim)]">
              open crypto 15m
            </p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-gold)]">
              YES / NO books · same outcome · different queues
            </p>
          </div>

          {markets.length === 0 ? (
            <div className="kmm-frame px-4 py-14 text-center text-xs uppercase tracking-widest text-[var(--color-dim)]">
              {status.everSucceeded ? 'empty set' : 'awaiting packets…'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {markets.map((m) => {
                const on = m.ticker === selected
                const canon = normalizeSpotAsset(m.asset)
                const spot = canon ? spots[canon] ?? null : null
                const hint = betterBookHint(m)
                const noMid = midNo(m)
                return (
                  <button
                    key={m.ticker}
                    type="button"
                    onClick={() => setSelected(m.ticker)}
                    className={`kmm-card p-3 ${on ? 'kmm-card--on' : ''}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-1">
                      <span className="border border-[rgba(184,255,60,0.3)] bg-[rgba(184,255,60,0.08)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[var(--color-profit)]">
                        {m.asset}
                      </span>
                      <span
                        className={`num text-[10px] ${timeUrgencyClass(m.minutesRemaining)}`}
                      >
                        {fmtMinutesLeft(m.minutesRemaining)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <div className="font-display text-[11px] text-[var(--color-dim)]">
                        {assetShortName(m.asset)}
                      </div>
                      {hint !== 'TIE' && (
                        <span
                          className="border border-[rgba(255,214,10,0.35)] px-1 py-px text-[8px] font-bold uppercase tracking-wider text-[var(--color-gold)]"
                          title="Tighter touch spread (proxy until L2 sizes)"
                        >
                          {hint}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[8px] uppercase tracking-wider text-[var(--color-dim)]">
                          YES
                        </div>
                        <div className="num text-xl font-bold leading-none text-[var(--color-profit)] sm:text-2xl">
                          {Math.round(m.midYes * 100)}
                          <span className="text-xs text-[var(--color-dim)]">¢</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase tracking-wider text-[var(--color-dim)]">
                          NO
                        </div>
                        <div className="num text-xl font-bold leading-none text-[var(--color-gold)] sm:text-2xl">
                          {Math.round(noMid * 100)}
                          <span className="text-xs text-[var(--color-dim)]">¢</span>
                        </div>
                      </div>
                    </div>
                    <div className="num mt-2 text-[10px] text-[var(--color-dim)]">
                      Y {fmtPrice(m.yesBid)}/{fmtPrice(m.yesAsk)}
                      {' · '}
                      N {fmtPrice(m.noBid)}/{fmtPrice(m.noAsk)}
                      {spot != null ? ` · ${fmtSpot(spot)}` : ''}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] pt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--color-dim)]">
          <span>kmm · paper mode · live orders off</span>
          <a href="?legacy=1" className="opacity-30 hover:opacity-70">
            legacy lab
          </a>
        </footer>
      </div>
    </div>
  )
}

function BootBlock({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex flex-col items-start gap-2 py-10 sm:py-14">
      <p className="font-display text-xl font-bold tracking-tight text-[var(--color-profit)] sm:text-2xl">
        {label}
      </p>
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-dim)]">{sub}</p>
    </div>
  )
}

function TargetHero({
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
  const spark = sparklinePolylinePoints(mids, 360, 80)
  const progress = windowProgress(market.minutesRemaining, 15)
  const yesPct = Math.round(market.midYes * 100)
  const noMid = midNo(market)
  const noPct = Math.round(noMid * 100)
  const hint = betterBookHint(market)
  const yesSpr = spreadCentsYes(market)
  const noSpr = spreadCentsNo(market)

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-stretch">
      <div>
        <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-gold)]">
          active target
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="border border-[var(--color-profit)] bg-[rgba(184,255,60,0.1)] px-2 py-0.5 text-xs font-bold text-[var(--color-profit)]">
            {market.asset}
          </span>
          <span className="font-display text-sm text-[var(--color-ink)]">
            {assetShortName(market.asset)}
          </span>
          <span className="num text-[10px] text-[var(--color-dim)]">{market.ticker}</span>
          <span
            className="border border-[rgba(255,214,10,0.4)] bg-[rgba(255,214,10,0.08)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-gold)]"
            title="Tighter touch spread ≈ better book until L2 sizes on both sides"
          >
            better book: {hint}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <BookColumn
            side="YES"
            midCents={yesPct}
            bid={market.yesBid}
            ask={market.yesAsk}
            spreadLabel={
              Number.isFinite(yesSpr)
                ? fmtSpreadCents(market.yesBid, market.yesAsk, yesSpr)
                : '—'
            }
            accent="profit"
            better={hint === 'YES'}
          />
          <BookColumn
            side="NO"
            midCents={noPct}
            bid={market.noBid}
            ask={market.noAsk}
            spreadLabel={
              Number.isFinite(noSpr)
                ? fmtSpreadCents(market.noBid, market.noAsk, noSpr)
                : '—'
            }
            accent="gold"
            better={hint === 'NO'}
          />
        </div>

        <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--color-dim)]">
          YES + NO ≈ $1 · same economic outcome · less queue ahead → more fills
        </p>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-[var(--color-dim)]">
            <span>window</span>
            <span className={`num ${timeUrgencyClass(market.minutesRemaining)}`}>
              {fmtMinutesLeft(market.minutesRemaining)} left
            </span>
          </div>
          <div className="h-2 border border-[var(--color-line)] bg-black/40">
            <div
              className="h-full bg-[var(--color-profit)] transition-[width] duration-200"
              style={{
                width: `${Math.round(progress * 100)}%`,
                boxShadow: '0 0 12px rgba(184,255,60,0.45)',
              }}
            />
          </div>
        </div>

        {spot != null && (
          <p className="num mt-3 text-[11px] text-[var(--color-gold)]">
            spot {fmtSpot(spot)}
          </p>
        )}
      </div>

      <div className="kmm-frame flex flex-col p-3 sm:p-4">
        <div className="mb-2 flex justify-between text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
          <span>YES mid trace</span>
          <span className="num">{mids.length} samples</span>
        </div>
        {spark ? (
          <svg viewBox="0 0 360 80" className="h-28 w-full" preserveAspectRatio="none">
            <polyline
              points={spark}
              fill="none"
              stroke="var(--color-profit)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <polyline
              points={spark}
              fill="none"
              stroke="var(--color-gold)"
              strokeWidth="1"
              opacity="0.35"
              transform="translate(0, 2)"
            />
          </svg>
        ) : (
          <div className="flex h-28 items-center justify-center text-[10px] uppercase tracking-widest text-[var(--color-dim)]">
            collecting ticks…
          </div>
        )}
        <p className="mt-auto pt-2 text-[10px] leading-relaxed text-[var(--color-dim)]">
          Paper surveillance only. Complements share payoff; pick the thinner queue for fills.
          Edge / MM print layer lands later — this feed is the spine.
        </p>
      </div>
    </div>
  )
}

function BookColumn({
  side,
  midCents,
  bid,
  ask,
  spreadLabel,
  accent,
  better,
}: {
  side: 'YES' | 'NO'
  midCents: number
  bid: number
  ask: number
  spreadLabel: string
  accent: 'profit' | 'gold'
  better: boolean
}) {
  const midColor =
    accent === 'profit' ? 'text-[var(--color-profit)]' : 'text-[var(--color-gold)]'
  const border = better
    ? accent === 'profit'
      ? 'border-[var(--color-profit)]'
      : 'border-[var(--color-gold)]'
    : 'border-[var(--color-line)]'

  return (
    <div className={`border ${border} bg-black/30 p-3`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-dim)]">
          {side} mid
        </span>
        {better && (
          <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-gold)]">
            tighter
          </span>
        )}
      </div>
      <div className={`num font-display text-5xl font-bold leading-none tracking-tight ${midColor} sm:text-6xl`}>
        {midCents}
        <span className="text-xl text-[var(--color-dim)]">¢</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <Cell k="bid" v={fmtPrice(bid)} />
        <Cell k="ask" v={fmtPrice(ask)} />
        <Cell k="spr" v={spreadLabel} />
      </div>
    </div>
  )
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-[var(--color-line)] bg-black/30 px-2 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--color-dim)]">{k}</div>
      <div className="num text-sm font-semibold text-[var(--color-ink)]">{v}</div>
    </div>
  )
}

export default V1App

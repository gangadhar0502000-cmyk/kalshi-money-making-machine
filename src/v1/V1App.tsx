import { useEffect, useMemo, useState } from 'react'
import type { Crypto15mMarket } from '../types/crypto15m'
import { getMidHistory } from '../lib/crypto15m/midHistory'
import { normalizeSpotAsset } from '../lib/crypto15m/spot'
import { useContinuousFeed } from './useContinuousFeed'
import { useSpotMap } from './useSpotMap'
import {
  formatSignedDollars,
  formatUpdateError,
  MM_MAX_ACTIVE_BOOKS,
  statusPillLabel,
} from './mm/mmSession'
import { useMmSession } from './mm/useMmSession'
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
import { fmtMmInvHint, sortMarketsForRail } from './marketRail'

/**
 * KMM v1 — Apple-clean feed UI.
 * Dark iOS-style surface. Continuous feed + YES/NO + Paper MM Start/Stop/Reset.
 * U2.4 Start runs loose multi-book paper portfolio (up to 5 books).
 * U2.5 Active books panel under the MM strip (per-book P&L; click focuses hero).
 * U2.6 Apple-clean MM strip metric polish (scannable cash / P&L grid).
 * U2.7 Market rail: MM badge + quoted books float first while running.
 * U2.8 Shared cash aggregate + Start disabled look + feed-stale strip line.
 * Paper / read-only. YES and NO are complements (same $ outcome); tighter book → less queue ahead.
 */
export function V1App() {
  const snap = useContinuousFeed()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)
  const { state: mm, start, stop, reset } = useMmSession()

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

  /** U2.7 — tickers the multi-book MM is actively quoting. */
  const quotedTickers = useMemo(
    () => new Set(mm.books.map((b) => b.ticker)),
    [mm.books],
  )
  const invByTicker = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of mm.books) map.set(b.ticker, b.inventory)
    return map
  }, [mm.books])
  const railMarkets = useMemo(() => {
    if (mm.status === 'idle' || quotedTickers.size === 0) return markets
    return sortMarketsForRail(markets, quotedTickers)
  }, [markets, mm.status, quotedTickers])

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
      <div className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-label)] sm:text-[26px]">
                Kalshi 15m
              </h1>
              <span className="text-[13px] font-medium text-[var(--color-secondary)]">
                Paper · v1
              </span>
            </div>
            <p className="mt-1 text-[13px] text-[var(--color-tertiary)]">
              Continuous feed · read-only
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={chip}>
              <span
                className={`live-pulse inline-block h-1.5 w-1.5 rounded-full ${
                  status.feedTone === 'ok'
                    ? 'bg-[var(--color-profit)]'
                    : status.feedTone === 'amber'
                      ? 'bg-[var(--color-warn)]'
                      : 'bg-[var(--color-danger)]'
                }`}
              />
              {status.liveLabel}
            </span>
            <span className="kmm-chip num">{status.feedAgeShort}</span>
            <span className="kmm-chip num">{status.marketCount} markets</span>
            <span className="kmm-chip">{status.proxyShort}</span>
          </div>
        </header>

        {/* Paper MM control strip — U2.4–U2.6 multi-book + metric polish */}
        <section className="kmm-mm-strip mb-6 px-4 py-3.5 sm:px-5" aria-label="Paper market making">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] font-semibold tracking-tight text-[var(--color-label)]">
                Paper MM
              </span>
              <span
                className={
                  mm.status === 'running'
                    ? 'kmm-chip kmm-chip--live'
                    : mm.status === 'stopped'
                      ? 'kmm-chip kmm-chip--warn'
                      : 'kmm-chip'
                }
              >
                {mm.status === 'running' && (
                  <span className="live-pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-profit)]" />
                )}
                <span className="num">{statusPillLabel(mm, nowMs)}</span>
              </span>
              {/* Ticker chip only when books panel is empty (U2.6 — avoid double-focus noise) */}
              {mm.activeTicker && mm.books.length === 0 && (
                <span className="kmm-chip num text-[11px]">{mm.activeTicker}</span>
              )}
              {mm.quoteBook && (
                <span className="text-[12px] font-medium text-[var(--color-secondary)]">
                  Book {mm.quoteBook}
                </span>
              )}
              {mm.status !== 'idle' && (
                <span className="kmm-chip num text-[11px]">
                  Books {mm.activeBooks}/{MM_MAX_ACTIVE_BOOKS}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="kmm-btn kmm-btn--primary"
                disabled={mm.status === 'running'}
                onClick={() => start(selected)}
              >
                Start
              </button>
              <button
                type="button"
                className="kmm-btn"
                disabled={mm.status !== 'running'}
                onClick={stop}
              >
                Stop
              </button>
              <button type="button" className="kmm-btn" onClick={reset}>
                Reset
              </button>
            </div>
          </div>

          <div className="kmm-mm-metrics" role="group" aria-label="Paper MM metrics">
            <div className="kmm-mm-metric">
              <span className="kmm-mm-metric__label">Cash</span>
              <span className="kmm-mm-metric__value kmm-mm-metric__value--lg num">
                ${mm.cash.toFixed(2)}
              </span>
            </div>
            <div className="kmm-mm-metric">
              <span className="kmm-mm-metric__label">Inv</span>
              <span className="kmm-mm-metric__value num">
                {mm.inventory > 0 ? '+' : ''}
                {mm.inventory}
              </span>
            </div>
            <div className="kmm-mm-metric">
              <span className="kmm-mm-metric__label">Realized</span>
              <span
                className={`kmm-mm-metric__value kmm-mm-metric__value--lg num ${
                  mm.realizedPnl >= 0
                    ? 'kmm-mm-metric__value--profit'
                    : 'kmm-mm-metric__value--danger'
                }`}
              >
                {formatSignedDollars(mm.realizedPnl)}
              </span>
            </div>
            <div className="kmm-mm-metric">
              <span className="kmm-mm-metric__label">Unrealized</span>
              <span
                className={`kmm-mm-metric__value num ${
                  mm.unrealizedPnl >= 0
                    ? 'kmm-mm-metric__value--profit'
                    : 'kmm-mm-metric__value--danger'
                }`}
              >
                {formatSignedDollars(mm.unrealizedPnl)}
              </span>
            </div>
            <div className="kmm-mm-metric">
              <span className="kmm-mm-metric__label">Fills</span>
              <span className="kmm-mm-metric__value num">{mm.fillsCount}</span>
            </div>
            {mm.fees > 0 && (
              <div className="kmm-mm-metric">
                <span className="kmm-mm-metric__label">Fees</span>
                <span className="kmm-mm-metric__value num">${mm.fees.toFixed(2)}</span>
              </div>
            )}
            <div className="kmm-mm-metric">
              <span className="kmm-mm-metric__label">Mark</span>
              <span className="kmm-mm-metric__value kmm-mm-metric__value--muted num">
                {formatSignedDollars(mm.realizedPnl + mm.unrealizedPnl)}
              </span>
            </div>
          </div>

          {mm.updateError ? (
            <p
              className={`mt-2 text-[12px] font-medium ${
                /orderbook|proxy/i.test(mm.updateError.dependency)
                  ? 'text-[var(--color-danger)]'
                  : 'text-[var(--color-warn)]'
              }`}
              role="alert"
            >
              {formatUpdateError(mm.updateError)}
            </p>
          ) : mm.status === 'running' && status.feedTone !== 'ok' ? (
            <p
              className={`mt-2 text-[12px] font-medium ${
                status.feedTone === 'red'
                  ? 'text-[var(--color-danger)]'
                  : 'text-[var(--color-warn)]'
              }`}
              role="alert"
            >
              {status.lastError
                ? `U2.8: feed data stale (${status.feedAgeShort}) — ${status.lastError}`
                : `U2.8: feed data stale (${status.feedAgeShort}) — needs mm-proxy :8787`}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-[var(--color-tertiary)]">
              {mm.status === 'idle'
                ? 'Idle · Start runs paper multi-book (observability) · U3.0 quoting paused — no paper quotes until new logic · L2 / drop-refill still on'
                : mm.status === 'running'
                  ? 'Session running · paper quotes · read-only'
                  : 'Stopped · numbers frozen · Reset clears P&L'}
            </p>
          )}
        </section>

        {/* U2.5 — Active books panel (under strip; not market rail) */}
        {(mm.status !== 'idle' || mm.books.length > 0) && (
          <section
            className="kmm-books-panel mb-6 px-4 py-3.5 sm:px-5"
            aria-label="Active paper books"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold tracking-tight text-[var(--color-label)]">
                Active books
              </p>
              <span className="num text-[11px] text-[var(--color-tertiary)]">
                {mm.books.length}/{MM_MAX_ACTIVE_BOOKS}
              </span>
            </div>
            {mm.books.length === 0 ? (
              <p className="text-[12px] text-[var(--color-tertiary)]">
                Waiting for books…
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mm.books.map((book) => {
                  const on = book.ticker === selected
                  const midCents =
                    typeof book.midYes === 'number' && Number.isFinite(book.midYes)
                      ? Math.round(book.midYes * 100)
                      : null
                  const tickerShort =
                    book.ticker.length > 22
                      ? `${book.ticker.slice(0, 10)}…${book.ticker.slice(-8)}`
                      : book.ticker
                  return (
                    <li key={book.slotId}>
                      <button
                        type="button"
                        className={`kmm-book-row ${on ? 'kmm-book-row--on' : ''}`}
                        onClick={() => setSelected(book.ticker)}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="kmm-badge">
                              {(book.asset || '—').toUpperCase()}
                            </span>
                            <span className="truncate text-[13px] font-medium text-[var(--color-label)]">
                              {book.asset ? assetShortName(book.asset) : '—'}
                            </span>
                            <span
                              className="num truncate text-[11px] text-[var(--color-tertiary)]"
                              title={book.ticker}
                            >
                              {tickerShort}
                            </span>
                            {book.quoteBook && (
                              <span className="text-[11px] font-medium text-[var(--color-secondary)]">
                                Book {book.quoteBook}
                              </span>
                            )}
                            {!book.liveBook && (
                              <span
                                className="kmm-chip kmm-chip--warn text-[10px]"
                                title={book.message || 'Live book off'}
                              >
                                {/U2\.14:.*holding inv/i.test(book.message)
                                  ? 'L2 hold'
                                  : 'off'}
                              </span>
                            )}
                          </div>
                          <span className="num text-[12px] text-[var(--color-secondary)]">
                            Mid{' '}
                            <span className="font-semibold text-[var(--color-label)]">
                              {midCents != null ? `${midCents}¢` : '—'}
                            </span>
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--color-secondary)]">
                          <span>
                            Inv{' '}
                            <span className="num font-semibold text-[var(--color-label)]">
                              {book.inventory > 0 ? '+' : ''}
                              {book.inventory}
                            </span>
                          </span>
                          <span>
                            Realized{' '}
                            <span
                              className={`num font-semibold ${
                                book.realizedPnl >= 0
                                  ? 'text-[var(--color-profit)]'
                                  : 'text-[var(--color-danger)]'
                              }`}
                            >
                              {book.realizedPnl >= 0 ? '+' : ''}
                              ${book.realizedPnl.toFixed(2)}
                            </span>
                          </span>
                          <span>
                            Unrealized{' '}
                            <span
                              className={`num font-semibold ${
                                book.unrealizedPnl >= 0
                                  ? 'text-[var(--color-profit)]'
                                  : 'text-[var(--color-danger)]'
                              }`}
                            >
                              {book.unrealizedPnl >= 0 ? '+' : ''}
                              ${book.unrealizedPnl.toFixed(2)}
                            </span>
                          </span>
                          <span>
                            Fills{' '}
                            <span className="num font-semibold text-[var(--color-label)]">
                              {book.fillsCount}
                            </span>
                          </span>
                        </div>
                        {book.message && !book.liveBook && (
                          <p className="mt-1.5 truncate text-[11px] text-[var(--color-tertiary)]">
                            {book.message}
                          </p>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {/* Hero */}
        <section className="kmm-hero mb-6 p-5 sm:p-7">
          {!status.everSucceeded ? (
            <BootBlock label="Connecting…" sub="Local proxy → Kalshi L2 (read-only)" />
          ) : !active ? (
            <BootBlock label="No open windows" sub="Feed healthy · waiting for the next 15m set" />
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

        {/* Market list — U2.7 MM highlight + quoted-first sort */}
        <section className="mb-6 flex-1">
          <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium text-[var(--color-secondary)]">
              <span>Open markets</span>
              {mm.status !== 'idle' && mm.books.length > 0 && (
                <span className="num font-normal text-[var(--color-tertiary)]">
                  {mm.books.length} books
                </span>
              )}
            </p>
            <p className="text-[12px] text-[var(--color-tertiary)]">
              YES / NO books · same outcome
            </p>
          </div>

          {railMarkets.length === 0 ? (
            <div className="kmm-frame px-4 py-16 text-center text-[14px] text-[var(--color-secondary)]">
              {status.everSucceeded ? 'No open markets right now' : 'Waiting for feed…'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {railMarkets.map((m) => {
                const on = m.ticker === selected
                const isMm = quotedTickers.has(m.ticker)
                const canon = normalizeSpotAsset(m.asset)
                const spot = canon ? spots[canon] ?? null : null
                const hint = betterBookHint(m)
                const noMid = midNo(m)
                const mmInv = isMm ? invByTicker.get(m.ticker) : undefined
                return (
                  <button
                    key={m.ticker}
                    type="button"
                    onClick={() => setSelected(m.ticker)}
                    className={`kmm-card p-3.5 ${on ? 'kmm-card--on' : ''} ${isMm ? 'kmm-card--mm' : ''}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="kmm-badge">{m.asset}</span>
                        <span className="text-[13px] font-medium text-[var(--color-label)]">
                          {assetShortName(m.asset)}
                        </span>
                        {isMm && (
                          <span
                            className="kmm-badge kmm-badge--mm"
                            title="Paper MM quoting this book"
                          >
                            MM
                          </span>
                        )}
                      </div>
                      <span
                        className={`num shrink-0 text-[12px] font-medium ${timeUrgencyClass(m.minutesRemaining)}`}
                      >
                        {fmtMinutesLeft(m.minutesRemaining)}
                      </span>
                    </div>

                    {hint !== 'TIE' && (
                      <div className="mb-1.5">
                        <span
                          className="kmm-badge kmm-badge--better"
                          title="Tighter touch spread (proxy until L2 sizes)"
                        >
                          Better {hint}
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-tertiary)]">
                          YES
                        </div>
                        <div className="num text-[26px] font-semibold leading-none tracking-tight text-[var(--color-label)] sm:text-[28px]">
                          {Math.round(m.midYes * 100)}
                          <span className="text-[13px] font-medium text-[var(--color-secondary)]">
                            ¢
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-tertiary)]">
                          NO
                        </div>
                        <div className="num text-[26px] font-semibold leading-none tracking-tight text-[var(--color-label)] sm:text-[28px]">
                          {Math.round(noMid * 100)}
                          <span className="text-[13px] font-medium text-[var(--color-secondary)]">
                            ¢
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="num mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-tertiary)]">
                      <span>
                        Y {fmtPrice(m.yesBid)}/{fmtPrice(m.yesAsk)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        N {fmtPrice(m.noBid)}/{fmtPrice(m.noAsk)}
                      </span>
                      {spot != null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{fmtSpot(spot)}</span>
                        </>
                      )}
                      {mmInv != null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{fmtMmInvHint(mmInv)}</span>
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-separator)] pt-4 text-[12px] text-[var(--color-tertiary)]">
          <span>Paper mode · live orders off</span>
          <a href="?legacy=1" className="text-[var(--color-secondary)] hover:text-[var(--color-label)]">
            Legacy lab
          </a>
        </footer>
      </div>
    </div>
  )
}

function BootBlock({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5 py-10 sm:py-12">
      <p className="text-[22px] font-semibold tracking-tight text-[var(--color-label)] sm:text-[26px]">
        {label}
      </p>
      <p className="text-[14px] text-[var(--color-secondary)]">{sub}</p>
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
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-stretch">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="kmm-badge">{market.asset}</span>
          <span className="text-[17px] font-semibold tracking-tight text-[var(--color-label)]">
            {assetShortName(market.asset)}
          </span>
          <span className="num text-[12px] text-[var(--color-tertiary)]">{market.ticker}</span>
          <span
            className="kmm-badge kmm-badge--better"
            title="Tighter touch spread ≈ better book until L2 sizes on both sides"
          >
            Better book · {hint}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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
            better={hint === 'NO'}
          />
        </div>

        <p className="mt-3 text-[12px] text-[var(--color-tertiary)]">
          YES + NO ≈ $1 · same economic outcome · thinner queue → more fills
        </p>

        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-[12px] text-[var(--color-secondary)]">
            <span>Window</span>
            <span className={`num font-medium ${timeUrgencyClass(market.minutesRemaining)}`}>
              {fmtMinutesLeft(market.minutesRemaining)} left
            </span>
          </div>
          <div className="kmm-progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>

        {spot != null && (
          <p className="num mt-3 text-[13px] text-[var(--color-secondary)]">
            Spot {fmtSpot(spot)}
          </p>
        )}
      </div>

      <div className="flex flex-col rounded-[16px] bg-[var(--color-elevated)] p-4">
        <div className="mb-2 flex justify-between text-[12px] text-[var(--color-secondary)]">
          <span>YES mid</span>
          <span className="num">{mids.length} samples</span>
        </div>
        {spark ? (
          <svg viewBox="0 0 360 80" className="h-24 w-full" preserveAspectRatio="none">
            <polyline
              points={spark}
              fill="none"
              stroke="var(--color-tint)"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <div className="flex h-24 items-center justify-center text-[13px] text-[var(--color-tertiary)]">
            Collecting ticks…
          </div>
        )}
        <p className="mt-auto pt-3 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
          Paper surveillance only. Complements share payoff; pick the thinner book for fills.
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
  better,
}: {
  side: 'YES' | 'NO'
  midCents: number
  bid: number
  ask: number
  spreadLabel: string
  better: boolean
}) {
  return (
    <div
      className={`rounded-[16px] bg-[var(--color-elevated)] p-4 ${
        better ? 'ring-1 ring-[rgba(48,209,88,0.35)]' : ''
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--color-secondary)]">
          {side}
        </span>
        {better && (
          <span className="text-[11px] font-medium text-[var(--color-profit)]">Tighter</span>
        )}
      </div>
      <div className="num text-[48px] font-semibold leading-none tracking-tight text-[var(--color-label)] sm:text-[56px]">
        {midCents}
        <span className="text-[20px] font-medium text-[var(--color-secondary)]">¢</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Cell k="Bid" v={fmtPrice(bid)} />
        <Cell k="Ask" v={fmtPrice(ask)} />
        <Cell k="Spr" v={spreadLabel} />
      </div>
    </div>
  )
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[10px] bg-black/40 px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-tertiary)]">
        {k}
      </div>
      <div className="num text-[13px] font-semibold text-[var(--color-label)]">{v}</div>
    </div>
  )
}

export default V1App

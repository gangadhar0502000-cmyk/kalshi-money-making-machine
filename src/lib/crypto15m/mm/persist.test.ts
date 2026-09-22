/**
 * Paper MM session serialize/restore — survives full page reload wipe.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmPortfolio } from './portfolio'
import {
  clearPaperMmSession,
  deserializePaperMmSession,
  emptySessionLedger,
  serializePaperMmSession,
  sessionLedgerSigma,
} from './persist'
import { DEFAULT_PAPER_MM_CONFIG } from './config'
import type { MmFill } from './types'
import { isValidQuoteMid } from './prices'
import { scoreMarketEdge } from './edgeRank'

function mk(
  partial: Partial<Crypto15mMarket> & Pick<Crypto15mMarket, 'ticker' | 'asset'>,
): Crypto15mMarket {
  return {
    eventTicker: partial.eventTicker ?? partial.ticker,
    seriesTicker: partial.seriesTicker ?? `KX${partial.asset}15M`,
    title: partial.title ?? `${partial.asset} 15m`,
    status: partial.status ?? 'active',
    openTime: partial.openTime ?? new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: partial.closeTime ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: partial.yesBid ?? 0.4,
    yesAsk: partial.yesAsk ?? 0.6,
    noBid: 0.4,
    noAsk: 0.6,
    midYes: partial.midYes ?? 0.5,
    spreadCents: 2,
    last: 0.5,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 10,
    yesAskSize: 10,
    floorStrike: partial.floorStrike ?? 100,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: partial.minutesRemaining ?? 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
    ...partial,
  }
}

function mkFill(id: string): MmFill {
  return {
    id,
    t: Date.now(),
    side: 'buy_yes',
    price: 0.45,
    size: 1,
    midAtFill: 0.5,
    toxic: false,
    reason: 'random',
    feeDollars: 0.01,
    taker: false,
  }
}

describe('paper MM session persistence', () => {
  let portfolio: PaperMmPortfolio
  const mem = new Map<string, string>()

  beforeEach(() => {
    mem.clear()
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v)
      },
      removeItem: (k: string) => {
        mem.delete(k)
      },
    })
    portfolio = new PaperMmPortfolio({ skipRestore: true })
    portfolio.setConfig({
      maxActiveMarkets: 3,
      multiBook: true,
      fvQuoting: true,
      minEdgeCents: 2,
      annualVol: 0.7,
      quoteSize: 1,
      maxInventory: 5,
      autoRoll: true,
      useLiveBook: false,
      strictRealism: true,
      startingCash: 100,
    })
  })

  afterEach(() => {
    portfolio.stop()
    clearPaperMmSession()
    vi.unstubAllGlobals()
  })

  it('serialize/restore ledger → same Σ', () => {
    const ledger = {
      ...emptySessionLedger(),
      realizedSpreadPnl: 3.25,
      feesPaid: 0.12,
      fillCount: 4,
      cancelCount: 1,
      fills: [mkFill('a'), mkFill('b')],
    }
    const ser = serializePaperMmSession({
      running: true,
      config: DEFAULT_PAPER_MM_CONFIG,
      sessionLedger: ledger,
      sessionStartedAt: 1_700_000_000_000,
      activeTickers: ['BTC-1'],
    })
    const back = deserializePaperMmSession(ser)
    expect(back).not.toBeNull()
    expect(sessionLedgerSigma(back!.sessionLedger)).toEqual(sessionLedgerSigma(ledger))
    expect(back!.running).toBe(true)
    expect(back!.sessionStartedAt).toBe(1_700_000_000_000)
  })

  it('restore with wasRunning → start called / running true', () => {
    const btc = mk({ ticker: 'BTC-R', asset: 'BTC', midYes: 0.48, floorStrike: 100 })
    portfolio.seedSpot('BTC', 100.05)
    portfolio.syncMarketUniverse([btc])
    portfolio.start()
    portfolio.seedBookStats('BTC-R', {
      realizedSpreadPnl: 2.5,
      feesPaid: 0.08,
      fill: mkFill('restore-1'),
    })
    // Force bank into session ledger via release
    const dead = mk({
      ...btc,
      status: 'closed',
      minutesRemaining: 0,
      closeTime: new Date(Date.now() - 1000).toISOString(),
    })
    const eth = mk({ ticker: 'ETH-R', asset: 'ETH', midYes: 0.35, floorStrike: 100 })
    portfolio.seedSpot('ETH', 100.05)
    portfolio.syncMarketUniverse([dead, eth])
    expect(portfolio.getState().aggregate.fillCount).toBeGreaterThanOrEqual(1)
    const realized = portfolio.getState().aggregate.realizedSpreadPnl
    expect(realized).toBeGreaterThan(0)

    portfolio.setPersistEnabled(true)
    const snap = portfolio.serializeSession()
    expect(snap.running).toBe(true)
    expect(snap.sessionLedger.fillCount).toBeGreaterThanOrEqual(1)

    // Simulate full page reload: new portfolio applies serialized session
    const reloaded = new PaperMmPortfolio({ skipRestore: true })
    reloaded.setPersistEnabled(false)
    reloaded.setConfig({
      maxActiveMarkets: 3,
      multiBook: true,
      useLiveBook: false,
    })
    expect(reloaded.applySerializedSession(snap)).toBe(true)
    expect(reloaded.wantsAutoResume()).toBe(true)
    expect(reloaded.getState().running).toBe(false) // not started until sync
    expect(reloaded.getState().aggregate.realizedSpreadPnl).toBeCloseTo(
      snap.sessionLedger.realizedSpreadPnl,
      5,
    )
    expect(reloaded.getState().aggregate.fillCount).toBe(snap.sessionLedger.fillCount)

    reloaded.seedSpot('BTC', 100.05)
    reloaded.seedSpot('ETH', 100.05)
    const nextWin = mk({
      ticker: 'BTC-R2',
      asset: 'BTC',
      midYes: 0.48,
      floorStrike: 100,
      minutesRemaining: 14,
    })
    reloaded.syncMarketUniverse([nextWin, eth])
    expect(reloaded.getState().running).toBe(true)
    expect(reloaded.getState().aggregate.realizedSpreadPnl).toBeGreaterThanOrEqual(
      snap.sessionLedger.realizedSpreadPnl - 0.01,
    )
    expect(reloaded.getState().aggregate.fillCount).toBeGreaterThanOrEqual(
      snap.sessionLedger.fillCount,
    )
    reloaded.stop()
  })

  it('simulate roll of all books while running → still running, ledger non-zero preserved', () => {
    const assets = ['BTC', 'ETH', 'SOL'] as const
    const books = assets.map((asset) =>
      mk({
        ticker: `${asset}-OLD`,
        asset,
        midYes: 0.48,
        floorStrike: 100,
        minutesRemaining: 1,
        closeTime: new Date(Date.now() + 60_000).toISOString(),
      }),
    )
    for (const a of assets) portfolio.seedSpot(a, 100.05)
    portfolio.setConfig({ maxActiveMarkets: 3 })
    portfolio.syncMarketUniverse(books)
    portfolio.start()
    expect(portfolio.getState().running).toBe(true)
    expect(portfolio.getState().aggregate.activeBooks).toBe(3)

    portfolio.seedBookStats('BTC-OLD', {
      realizedSpreadPnl: 1.1,
      feesPaid: 0.02,
      fill: mkFill('roll-btc'),
    })
    portfolio.seedBookStats('ETH-OLD', {
      realizedSpreadPnl: 0.7,
      feesPaid: 0.01,
      fill: mkFill('roll-eth'),
    })
    const before = portfolio.getState().aggregate
    expect(before.realizedSpreadPnl).toBeCloseTo(1.8, 5)
    expect(before.fillCount).toBe(2)

    // Flip all windows to new same-asset tickers (15m roll)
    const closed = books.map((b) =>
      mk({
        ...b,
        status: 'closed',
        minutesRemaining: 0,
        closeTime: new Date(Date.now() - 1000).toISOString(),
      }),
    )
    const next = assets.map((asset) =>
      mk({
        ticker: `${asset}-NEW`,
        asset,
        midYes: 0.48,
        floorStrike: 101,
        minutesRemaining: 14,
        closeTime: new Date(Date.now() + 14 * 60_000).toISOString(),
      }),
    )
    portfolio.syncMarketUniverse([...closed, ...next])
    const after = portfolio.getState()
    expect(after.running).toBe(true)
    expect(after.aggregate.activeBooks).toBe(3)
    expect(after.books.every((b) => (b.snapshot.marketTicker ?? '').endsWith('-NEW'))).toBe(true)
    expect(after.aggregate.realizedSpreadPnl).toBeCloseTo(1.8, 5)
    expect(after.aggregate.fillCount).toBe(2)
    expect(after.sessionStartedAt).not.toBeNull()
  })

  it('resetSession clears; refresh/sync does not', () => {
    const btc = mk({ ticker: 'BTC-Z', asset: 'BTC', midYes: 0.48, floorStrike: 100 })
    portfolio.seedSpot('BTC', 100.05)
    portfolio.setPersistEnabled(true)
    portfolio.syncMarketUniverse([btc])
    portfolio.start()
    portfolio.seedBookStats('BTC-Z', {
      realizedSpreadPnl: 0.9,
      feesPaid: 0.03,
      fill: mkFill('z1'),
    })
    // Bank via release to opposite asset only
    const dead = mk({
      ...btc,
      status: 'closed',
      minutesRemaining: 0,
      closeTime: new Date(Date.now() - 1000).toISOString(),
    })
    const eth = mk({ ticker: 'ETH-Z', asset: 'ETH', midYes: 0.35, floorStrike: 100 })
    portfolio.seedSpot('ETH', 100.05)
    portfolio.syncMarketUniverse([dead, eth])
    expect(portfolio.getState().aggregate.fillCount).toBe(1)

    // Refresh/sync with same open set — must NOT wipe
    portfolio.syncMarketUniverse([
      mk({ ticker: 'ETH-Z', asset: 'ETH', midYes: 0.36, floorStrike: 100 }),
    ])
    expect(portfolio.getState().running).toBe(true)
    expect(portfolio.getState().aggregate.fillCount).toBe(1)
    expect(portfolio.getState().aggregate.realizedSpreadPnl).toBeCloseTo(0.9, 5)

    portfolio.resetSession()
    expect(portfolio.getState().running).toBe(false)
    expect(portfolio.getState().aggregate.fillCount).toBe(0)
    expect(portfolio.getState().aggregate.realizedSpreadPnl).toBe(0)
    expect(portfolio.getState().sessionStartedAt).toBeNull()
    // reset clears then emit may re-save empty shell — explicit clear is authoritative
    clearPaperMmSession()
    expect(mem.size).toBe(0)
  })
})

describe('invalid mid → no wild edge quoting', () => {
  it('mid=0 or null → no wild edge / not quoteEligible', () => {
    expect(isValidQuoteMid(0)).toBe(false)
    expect(isValidQuoteMid(null)).toBe(false)
    expect(isValidQuoteMid(undefined)).toBe(false)
    expect(isValidQuoteMid(0.5)).toBe(true)

    const m0 = mk({
      ticker: 'BTC-MID0',
      asset: 'BTC',
      midYes: 0,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    // Spot deep ITM → FV≈0.99 — must NOT yield EDGE +98
    const scored0 = scoreMarketEdge(m0, 200, 0.7, 2)
    expect(scored0.edgeCents).toBeNull()
    expect(scored0.absEdgeCents).toBe(0)
    expect(scored0.quoteEligible).toBe(false)
    expect(scored0.fairValue).not.toBeNull()
    expect(scored0.fairValue!).toBeGreaterThan(0.9)

    const mNull = mk({
      ticker: 'BTC-BAD',
      asset: 'BTC',
      midYes: Number.NaN,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    // asDollarPrice(NaN)=0.5 via isValidQuoteMid false path — mid stored 0, no edge
    const scoredBad = scoreMarketEdge(mNull, 200, 0.7, 2)
    // NaN is invalid → no edge
    expect(scoredBad.quoteEligible).toBe(false)
    expect(scoredBad.edgeCents).toBeNull()
  })

  it('mid inside toxic extreme vs FV 0.99 does not quoteEligible', () => {
    const m = mk({
      ticker: 'BTC-TOX',
      asset: 'BTC',
      midYes: 0.01,
      floorStrike: 100,
      minutesRemaining: 2,
    })
    const scored = scoreMarketEdge(m, 200, 0.7, 2, 0.05, 0.95)
    expect(scored.quoteEligible).toBe(false)
    // Edge may still be computed for diagnostics, but quoting is gated.
    expect(scored.midFallbackEligible).toBe(false)
  })
})

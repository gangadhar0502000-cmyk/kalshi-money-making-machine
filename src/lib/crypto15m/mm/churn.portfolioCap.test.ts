/**
 * A–E: hard portfolio 15m cap, churn filter, scarcity migration, settle-before-roll.
 * PAPER ONLY.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import {
  clampConfig,
  migratePersistedScarcityConfig,
  STRICT_PAPER_MM_CONFIG,
} from './config'
import { PaperMmEngine } from './engine'
import {
  deserializePaperMmSession,
  emptySessionLedger,
  serializePaperMmSession,
} from './persist'
import { PaperMmPortfolio } from './portfolio'
import {
  portfolioFillCap15m,
  TickerFillCapStore,
} from './fillCaps'

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
    rulesPrimary: 'Will the price be above the floor at expiry?',
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

type ApplyFillFn = (
  side: 'buy_yes' | 'sell_yes',
  price: number,
  size: number,
  mid: number,
  toxic: boolean,
  reason: string,
  taker: boolean,
) => void

function applyFill(eng: PaperMmEngine): ApplyFillFn {
  return (eng as unknown as { applyFill: ApplyFillFn }).applyFill.bind(eng)
}

describe('A: hard portfolio fill cap blocks applyFill', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('portfolioFillCap15m = activeBooks * perTicker', () => {
    expect(portfolioFillCap15m(5, 4)).toBe(20)
    expect(portfolioFillCap15m(5, 8)).toBe(40)
    expect(portfolioFillCap15m(0, 4)).toBe(4)
  })

  it('shared store hard-blocks at portfolio cap even when per-ticker has room', () => {
    const store = new TickerFillCapStore()
    store.setPortfolioCap15m(3)
    const now = Date.now()
    // Spread 3 fills across 3 tickers — each under per-ticker 4, but portfolio at 3
    store.record('T1', now - 1000)
    store.record('T2', now - 900)
    store.record('T3', now - 800)
    expect(store.canAcceptPortfolio(now).ok).toBe(false)
    expect(store.canAccept('T4', now, 10, 10).ok).toBe(false)
    expect(store.canAccept('T4', now, 10, 10)?.reason).toMatch(/portfolio rate cap/)
  })

  it('engine applyFill refuses when portfolio cap hit', () => {
    const store = new TickerFillCapStore()
    store.setPortfolioCap15m(2)
    const eng = new PaperMmEngine()
    eng.setFillCapStore(store)
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.05,
        fillCooldownMs: 0,
        maxFillsPerMinute: 10,
        maxFillsPerMarketPer15m: 10,
        minChurnCaptureCents: 0,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
      }),
    )
    eng.setMarket(mk({ ticker: 'BTC-PORT', asset: 'BTC' }))
    eng.start()
    const fill = applyFill(eng)
    fill('buy_yes', 0.48, 1, 0.5, false, 'book_depth', false)
    fill('sell_yes', 0.52, 1, 0.5, false, 'book_depth', false)
    expect(eng.getState().snapshot.fillCount).toBe(2)
    fill('buy_yes', 0.48, 1, 0.5, false, 'book_depth', false)
    expect(eng.getState().snapshot.fillCount).toBe(2)
    expect(eng.getState().snapshot.message.toLowerCase()).toMatch(/portfolio rate cap/)
    eng.stop()
  })
})

describe('C: churn filter skips flat closes near avgEntry', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks sell with <1¢ signed capture unless S4 risk flat', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.05,
        fillCooldownMs: 0,
        maxFillsPerMinute: 20,
        maxFillsPerMarketPer15m: 50,
        minChurnCaptureCents: 1.0,
        minCloseProfitCents: 1.0,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
        expiryPullMinutes: 0.5,
      }),
    )
    eng.setMarket(mk({ ticker: 'BTC-CHURN', asset: 'BTC', minutesRemaining: 10 }))
    eng.start()
    eng.seedInventory(1, 0.5)
    const fill = applyFill(eng)
    const before = eng.getState().snapshot.fillCount
    // Close at exactly avgEntry → 0¢ capture → churn skip
    fill('sell_yes', 0.5, 1, 0.5, false, 'book_depth', false)
    expect(eng.getState().snapshot.fillCount).toBe(before)
    expect(eng.getState().snapshot.inventory).toBe(1)
    expect(eng.getState().snapshot.message.toLowerCase()).toMatch(/churn skip/)

    // Close with 1¢ edge → allowed
    fill('sell_yes', 0.51, 1, 0.5, false, 'book_depth', false)
    expect(eng.getState().snapshot.inventory).toBe(0)
    expect(eng.getState().snapshot.realizedSpreadPnl).toBeCloseTo(0.01, 6)
    eng.stop()
  })

  it('blocks recent-style −0.88¢/fill unwind unless S4', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.05,
        fillCooldownMs: 0,
        maxFillsPerMinute: 20,
        maxFillsPerMarketPer15m: 50,
        minChurnCaptureCents: 1.0,
        minCloseProfitCents: 1.0,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
        expiryPullMinutes: 0.5,
        hardFlatMinutes: 2,
      }),
    )
    eng.setMarket(mk({ ticker: 'BTC-LOSS', asset: 'BTC', minutesRemaining: 10 }))
    eng.start()
    eng.seedInventory(1, 0.5)
    const fill = applyFill(eng)
    const before = eng.getState().snapshot.fillCount
    fill('sell_yes', 0.4912, 1, 0.5, false, 'book_depth', false)
    expect(eng.getState().snapshot.fillCount).toBe(before)
    expect(eng.getState().snapshot.inventory).toBe(1)
    expect(eng.getState().snapshot.message).toMatch(/CLOSE blocked: capture|CHURN SKIP/)
    eng.stop()
  })

  it('allows flat close when minutesRemaining < expiryPull', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.05,
        fillCooldownMs: 0,
        maxFillsPerMinute: 20,
        maxFillsPerMarketPer15m: 50,
        minChurnCaptureCents: 1.0,
        minCloseProfitCents: 1.0,
        expiryPullMinutes: 0.5,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
      }),
    )
    eng.setMarket(
      mk({ ticker: 'BTC-EXP', asset: 'BTC', minutesRemaining: 0.2 }),
    )
    eng.start()
    eng.seedInventory(1, 0.5)
    const fill = applyFill(eng)
    fill('sell_yes', 0.5, 1, 0.5, false, 'book_depth', false)
    expect(eng.getState().snapshot.inventory).toBe(0)
    eng.stop()
  })
})

describe('D: migrate persisted scarcity to STRICT defaults', () => {
  it('clamps older 8/ticker and high /min down under strictRealism', () => {
    const migrated = migratePersistedScarcityConfig({
      strictRealism: true,
      maxFillsPerMarketPer15m: 8,
      maxFillsPerMinute: 5,
      minChurnCaptureCents: 0,
    })
    expect(migrated.maxFillsPerMarketPer15m).toBe(4)
    expect(migrated.maxFillsPerMinute).toBe(1)
    expect(migrated.minChurnCaptureCents).toBe(1.0)
    expect(migrated.minCloseProfitCents).toBe(1.0)
  })

  it('deserialize upgrades loose scarcity knobs on strict sessions', () => {
    const ser = serializePaperMmSession({
      running: false,
      config: clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.05,
        maxFillsPerMarketPer15m: 8,
        maxFillsPerMinute: 4,
      }),
      sessionLedger: emptySessionLedger(),
      sessionStartedAt: Date.now(),
    })
    // Simulate older blob with inflated caps before serialize clamp path
    const raw = {
      ...ser,
      config: {
        ...STRICT_PAPER_MM_CONFIG,
        maxFillsPerMarketPer15m: 8,
        maxFillsPerMinute: 4,
        minChurnCaptureCents: 0,
      },
    }
    const back = deserializePaperMmSession(raw)!
    expect(back.config.maxFillsPerMarketPer15m).toBe(4)
    expect(back.config.maxFillsPerMinute).toBe(1)
    expect(back.config.minChurnCaptureCents).toBe(1.0)
  })
})


describe('U3.2.8 migrate snaps depth/touch to STRICT 3/2', () => {
  it('strict + saved 8/4 → 3/2; soft paths stay off', () => {
    const migrated = migratePersistedScarcityConfig({
      strictRealism: true,
      minBookDepthConsumed: 8,
      minTouchPolls: 4,
      allowMidWalk: true,
      fillMidFallback: true,
    })
    expect(migrated.minBookDepthConsumed).toBe(3)
    expect(migrated.minTouchPolls).toBe(2)
    expect(migrated.allowMidWalk).toBe(false)
    expect(migrated.fillMidFallback).toBe(false)
  })
})

describe('U3.2.6 migrate lifts longOpenMinMid even in loose', () => {
  it('loose + persisted longOpenMinMid 0.40 → becomes 0.50', () => {
    const migrated = migratePersistedScarcityConfig({
      strictRealism: false,
      longOpenMinMid: 0.4,
    })
    expect(migrated.longOpenMinMid).toBe(0.5)
    expect(migrated.strictRealism).toBe(false)
  })

  it('loose + missing longOpenMinMid → STRICT 0.50', () => {
    const migrated = migratePersistedScarcityConfig({
      strictRealism: false,
    })
    expect(migrated.longOpenMinMid).toBe(0.5)
  })

  it('strict + saved 0.40 → lifts to 0.50', () => {
    const migrated = migratePersistedScarcityConfig({
      strictRealism: true,
      longOpenMinMid: 0.4,
    })
    expect(migrated.longOpenMinMid).toBe(0.5)
  })
})

describe('E: settle inventory before ticker roll — never silent wipe', () => {
  it('roll realizes open inventory into realizedSpreadPnl', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.05,
        autoRoll: true,
        settleOnClose: true,
        applyFees: false,
        fvQuoting: false,
        useLiveBook: false,
      }),
    )
    const oldM = mk({
      ticker: 'BTC-OLD-ROLL',
      asset: 'BTC',
      midYes: 0.4,
      minutesRemaining: 0,
      status: 'closed',
      closeTime: new Date(Date.now() - 1000).toISOString(),
    })
    eng.setMarket(oldM)
    eng.seedInventory(2, 0.3)
    const before = eng.getState().snapshot.realizedSpreadPnl
    const fresh = mk({
      ticker: 'BTC-NEW-ROLL',
      asset: 'BTC',
      midYes: 0.5,
      closeTime: new Date(Date.now() + 12 * 60_000).toISOString(),
    })
    eng.rollToMarket(fresh)
    const after = eng.getState().snapshot
    expect(after.inventory).toBe(0)
    expect(after.marketTicker).toBe('BTC-NEW-ROLL')
    // Long 2 @ 0.3 marked to old mid 0.4 → +0.20 realized
    expect(after.realizedSpreadPnl).toBeGreaterThan(before)
    expect(after.realizedSpreadPnl - before).toBeCloseTo(0.2, 5)
  })
})

describe('portfolio integrates hard cap + capture metrics', () => {
  let portfolio: PaperMmPortfolio

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    const mem = new Map<string, string>()
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
    portfolio.setPersistEnabled(false)
    portfolio.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.05,
        maxActiveMarkets: 2,
        maxFillsPerMarketPer15m: 4,
        maxFillsPerMinute: 10,
        fillCooldownMs: 0,
        minChurnCaptureCents: 0,
        fvQuoting: false,
        useLiveBook: false,
        fillMidFallback: true,
        applyFees: false,
      }),
    )
  })

  afterEach(() => {
    portfolio.stop()
    vi.unstubAllGlobals()
  })

  it('getState exposes portfolioFillCap15m = books * perTicker', () => {
    const btc = mk({ ticker: 'BTC-A', asset: 'BTC', midYes: 0.48, floorStrike: 100 })
    const eth = mk({ ticker: 'ETH-A', asset: 'ETH', midYes: 0.48, floorStrike: 100 })
    portfolio.seedSpot('BTC', 100)
    portfolio.seedSpot('ETH', 100)
    portfolio.syncMarketUniverse([btc, eth])
    portfolio.start()
    const st = portfolio.getState()
    expect(st.aggregate.activeBooks).toBe(2)
    expect(st.aggregate.portfolioFillCap15m).toBe(8)
    expect(portfolio.getFillCapStore().getPortfolioCap15m()).toBe(8)
  })
})

describe('U3.2.6 applyFill still refuses new long at mid≤0.50', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('buy_yes at mid 0.45 with flat inv is refused', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.5,
        fillCooldownMs: 0,
        maxFillsPerMinute: 60,
        maxFillsPerMarketPer15m: 60,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
      }),
    )
    eng.setMarket(
      mk({
        ticker: 'BTC-CURB',
        asset: 'BTC',
        midYes: 0.45,
        yesBid: 0.43,
        yesAsk: 0.47,
        minutesRemaining: 8,
      }),
    )
    eng.start()
    const fill = applyFill(eng)
    fill('buy_yes', 0.43, 1, 0.45, false, 'book_depth', false)
    const snap = eng.getState().snapshot
    expect(snap.inventory).toBe(0)
    expect(snap.fillCount).toBe(0)
    eng.stop()
  })

  it('buy_yes cover while short at mid 0.45 still allowed', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        longOpenMinMid: 0.5,
        fillCooldownMs: 0,
        maxFillsPerMinute: 60,
        maxFillsPerMarketPer15m: 60,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
        minCloseProfitCents: 0,
        minChurnCaptureCents: 0,
      }),
    )
    eng.setMarket(
      mk({
        ticker: 'BTC-COVER',
        asset: 'BTC',
        midYes: 0.45,
        yesBid: 0.43,
        yesAsk: 0.47,
        minutesRemaining: 8,
      }),
    )
    eng.start()
    eng.seedInventory(-1, 0.55)
    const fill = applyFill(eng)
    fill('buy_yes', 0.43, 1, 0.45, false, 'book_depth', false)
    expect(eng.getState().snapshot.inventory).toBe(0)
    eng.stop()
  })
})


describe('U3.2.7 applyFill refuses absurd $0 fills', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses buy_yes @ 0 with mid≈0.99 (scam cover pattern)', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        fillCooldownMs: 0,
        maxFillsPerMinute: 60,
        maxFillsPerMarketPer15m: 60,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
        minCloseProfitCents: 0,
        minChurnCaptureCents: 0,
      }),
    )
    eng.setMarket(
      mk({
        ticker: 'NEAR-SCAM0',
        asset: 'NEAR',
        midYes: 0.98,
        yesBid: 0.97,
        yesAsk: 0.99,
        minutesRemaining: 8,
      }),
    )
    eng.start()
    eng.seedInventory(-1, 0.55)
    const fill = applyFill(eng)
    fill('buy_yes', 0.01, 1, 0.98, false, 'book_depth', false)
    const st = eng.getState()
    expect(st.snapshot.inventory).toBe(-1)
    expect(st.fills.length).toBe(0)
    expect(st.snapshot.message ?? '').toMatch(/U3\.2\.7: ABSURD FILL REFUSED/)
    eng.stop()
  })

  it('allows maker buy_yes near bid with mid≈0.60 (non-absurd)', () => {
    const eng = new PaperMmEngine()
    eng.setConfig(
      clampConfig({
        ...STRICT_PAPER_MM_CONFIG,
        fillCooldownMs: 0,
        maxFillsPerMinute: 60,
        maxFillsPerMarketPer15m: 60,
        fvQuoting: false,
        useLiveBook: false,
        applyFees: false,
        longOpenMinMid: 0.5,
        openMinEdgeCents: 0,
        minEdgeCents: 0,
        quotingEnabled: true,
      }),
    )
    eng.setMarket(
      mk({
        ticker: 'SOL-OK',
        asset: 'SOL',
        midYes: 0.6,
        yesBid: 0.59,
        yesAsk: 0.61,
        minutesRemaining: 8,
      }),
    )
    eng.start()
    // Seed book touch so absurd/touch refs match maker bid fill
    const engAny = eng as unknown as { bookBestBid: number; bookBestAsk: number }
    engAny.bookBestBid = 0.59
    engAny.bookBestAsk = 0.61
    const fill = applyFill(eng)
    fill('buy_yes', 0.59, 1, 0.6, false, 'book_depth', false)
    expect(eng.getState().snapshot.inventory).toBe(1)
    expect(eng.getState().fills.length).toBe(1)
    eng.stop()
  })
})

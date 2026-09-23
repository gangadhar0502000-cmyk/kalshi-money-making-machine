/**
 * U2.14.1 — pollBook / soft-sim must not overwrite U2.14 hold-inv; soft marks when L2 off.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crypto15mMarket } from '../../../types/crypto15m'
import { PaperMmEngine } from './engine'

function mkMarket(partial: Partial<Crypto15mMarket> & { ticker: string }): Crypto15mMarket {
  return {
    eventTicker: partial.ticker,
    seriesTicker: 'KXBTC15M',
    asset: partial.asset ?? 'BTC',
    title: 'BTC 15m',
    status: 'active',
    openTime: new Date(Date.now() - 5 * 60_000).toISOString(),
    closeTime: new Date(Date.now() + 10 * 60_000).toISOString(),
    yesBid: 0.48,
    yesAsk: 0.52,
    noBid: 0.48,
    noAsk: 0.52,
    midYes: 0.5,
    spreadCents: 4,
    last: 0.5,
    volume: 0,
    volume24h: 0,
    openInterest: 0,
    yesBidSize: 10,
    yesAskSize: 10,
    floorStrike: 100_000,
    rulesPrimary: '',
    kalshiUrl: '',
    windowMinutes: 15,
    minutesElapsed: 5,
    minutesRemaining: 10,
    feeEstimate1: 0,
    thinBook: false,
    raw: {} as Crypto15mMarket['raw'],
    ...partial,
  }
}

describe('U2.14.1 L2-off hold message + soft marks', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    engine = new PaperMmEngine()
    engine.setConfig({
      useLiveBook: true,
      strictRealism: false,
      midCrossFillProb: 1,
      baseFillProb: 1,
      fillCooldownMs: 0,
      settleOnClose: false,
      fvQuoting: false,
      minEdgeCents: 0,
      quoteSize: 1,
      maxInventory: 10,
      halfSpreadCents: 2,
    })
  })

  afterEach(() => {
    engine.stop()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('pollBook-null path with inv keeps U2.14 hold message (not U2.13 overwrite)', () => {
    const m = mkMarket({ ticker: 'KX-U2141-HOLD' })
    engine.setMarket(m)
    engine.start()
    engine.seedInventory(2, 0.5)
    engine.noteL2OffHoldingInv()
    expect(engine.getState().snapshot.message).toMatch(/U2\.14: L2 off — holding inv until flat/)

    // Same path as pollBook when fetch returns null / throws.
    engine.__noteL2PollFailedForTests('fetch failed')
    expect(engine.getState().snapshot.liveBook).toBe(false)
    expect(engine.getState().snapshot.message).toMatch(/U2\.14: L2 off — holding inv until flat/)
    expect(engine.getState().snapshot.message).not.toMatch(/U2\.13/)

    // Soft-sim / onMarketTick path must also preserve hold advisory.
    engine.onMarketTick({ ...m, midYes: 0.99 })
    expect(engine.getState().snapshot.message).toMatch(/U2\.14: L2 off — holding inv until flat/)
  })

  it('freezes mark mid / zeros unrealized when L2 off without live mark', () => {
    const m = mkMarket({ ticker: 'KX-U2141-MARK', midYes: 0.5 })
    engine.setMarket(m)
    engine.start()
    engine.seedInventory(2, 0.5)

    // Never had L2 → extreme feed mid must not invent huge unrealized.
    engine.__setLiveBookForTests(false)
    engine.onMarketTick({ ...m, midYes: 1.0 })
    let st = engine.getState().snapshot
    expect(st.liveBook).toBe(false)
    expect(st.unrealizedInventoryPnl).toBe(0)

    // After a live mark, freeze to that mid while L2 off (ignore 100¢ feed).
    engine.__setLastLiveMarkMidForTests(0.55)
    engine.onMarketTick({ ...m, midYes: 1.0 })
    st = engine.getState().snapshot
    expect(st.midYes).toBeCloseTo(0.55, 5)
    // inv +2 @ 0.50 vs mark 0.55 → +0.10 unrealized
    expect(st.unrealizedInventoryPnl).toBeCloseTo(0.1, 5)
  })
})

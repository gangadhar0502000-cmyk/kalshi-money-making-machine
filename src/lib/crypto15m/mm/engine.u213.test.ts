/**
 * U2.13 — no soft fills when useLiveBook && !liveBook.
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

describe('U2.13 no soft fills when L2 off', () => {
  let engine: PaperMmEngine

  beforeEach(() => {
    vi.stubGlobal('window', {
      setInterval: () => 1,
      clearInterval: () => undefined,
    })
    vi.spyOn(Math, 'random').mockReturnValue(0) // would always fill soft-sim if allowed
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

  it('useLiveBook && !liveBook → no mid_cross/random fills + L2 off message', () => {
    const m = mkMarket({ ticker: 'KX-U213' })
    engine.setMarket(m)
    engine.start()
    // Force soft mid-cross conditions: mid at/below bid
    engine.onMarketTick({ ...m, midYes: 0.4, yesBid: 0.48, yesAsk: 0.52 })
    engine.onMarketTick({ ...m, midYes: 0.4, yesBid: 0.48, yesAsk: 0.52 })
    const st = engine.getState()
    expect(st.snapshot.liveBook).toBe(false)
    expect(st.snapshot.quoteBookSide).toBe('yes')
    expect(st.fills.filter((f) => f.reason !== 'settlement')).toHaveLength(0)
    expect(st.snapshot.message).toMatch(/L2 off — no soft fills \(U2\.13\)/)
  })

  it('setQuoteBookSide flips config and resets queue state', () => {
    const m = mkMarket({ ticker: 'KX-U213-NO' })
    engine.setMarket(m)
    engine.setQuoteBookSide('no')
    expect(engine.getConfig().quoteBookSide).toBe('no')
    expect(engine.getState().snapshot.quoteBookSide).toBe('no')
    expect(engine.getState().snapshot.liveBook).toBe(false)
  })
})

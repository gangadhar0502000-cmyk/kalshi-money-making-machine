/**
 * Journal line format + digest aggregation by scenario.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateDigest,
  buildBlockedCloseEvent,
  buildFillEvent,
  buildS51EvictEvent,
  classifyFillLeg,
  formatJournalLine,
  hourKeyFromMs,
  parseBlockedCloseCaptureCents,
  parseJournalLine,
} from './headlessJournal'

describe('headlessJournal format', () => {
  it('formats and parses a fill line round-trip', () => {
    const ev = buildFillEvent({
      t: 1_700_000_000_000,
      scenarioId: 'S1',
      ticker: 'KXBTC15M-99',
      asset: 'BTC',
      side: 'buy_yes',
      price: 0.42,
      edgeCents: 5.5,
      inventory: 1,
      minutesLeft: 8.2,
      captureCents: 0,
      reason: 'book_depth',
      realizedDelta: 0,
    })
    const line = formatJournalLine(ev)
    expect(line.startsWith('{')).toBe(true)
    expect(line.includes('\n')).toBe(false)
    const parsed = parseJournalLine(line)
    expect(parsed).toEqual(ev)
    expect(parsed?.iso).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('parses capture ¢ from CLOSE blocked reason', () => {
    expect(parseBlockedCloseCaptureCents('CLOSE blocked: capture -3.0¢ < 1¢')).toBeCloseTo(-3, 5)
    expect(parseBlockedCloseCaptureCents('CLOSE blocked: capture 0.4¢ < 1.0¢')).toBeCloseTo(0.4, 5)
    expect(parseBlockedCloseCaptureCents('ask OFF: toxic mid')).toBeNull()
  })

  it('formats blocked_close with stuckTicks + capture gap', () => {
    const ev = buildBlockedCloseEvent({
      t: 1_700_000_000_500,
      scenarioId: 'S5',
      ticker: 'KXETH15M-1',
      asset: 'ETH',
      side: 'sell_yes',
      inventory: 2,
      captureCents: 0.4,
      stuckTicks: 12,
      captureGapCents: 0.6,
      reason: 'CLOSE blocked: capture 0.4 < 1.0¢',
    })
    const line = formatJournalLine(ev)
    const parsed = parseJournalLine(line)
    expect(parsed?.type).toBe('blocked_close')
    expect(parsed?.reason).toMatch(/CLOSE blocked/)
    expect(parsed?.captureCents).toBe(0.4)
    expect(parsed?.stuckTicks).toBe(12)
    expect(parsed?.captureGapCents).toBe(0.6)
  })

  it('returns null for corrupt journal lines', () => {
    expect(parseJournalLine('')).toBeNull()
    expect(parseJournalLine('not-json')).toBeNull()
    expect(parseJournalLine('{"type":"fill"}')).toBeNull()
  })
})

describe('classifyFillLeg', () => {
  it('stamps open vs close from scenario / capture', () => {
    expect(classifyFillLeg('S1', 0)).toBe('open')
    expect(classifyFillLeg('S2', 0)).toBe('open')
    expect(classifyFillLeg('S3', 1.2)).toBe('close')
    expect(classifyFillLeg('S4.2', -7)).toBe('close')
    // Legacy mis-tag: lossy flatten logged as S5 still counts as close
    expect(classifyFillLeg('S5', -6)).toBe('close')
    expect(classifyFillLeg('S5', 0)).toBe('open')
  })
})

describe('headlessJournal digest', () => {
  it('aggregates fills / stuck / SLOT_EVICT by scenario', () => {
    const t0 = Date.UTC(2026, 8, 22, 3, 10, 0) // inside a known hour UTC
    const events = [
      buildFillEvent({
        t: t0 + 1000,
        scenarioId: 'S1',
        side: 'buy_yes',
        price: 0.4,
        captureCents: 0,
        realizedDelta: 0,
      }),
      buildFillEvent({
        t: t0 + 2000,
        scenarioId: 'S3',
        side: 'sell_yes',
        price: 0.45,
        captureCents: 3.2,
        realizedDelta: 0.032,
        reason: 'S3 PROFITABLE_CLOSE',
      }),
      buildFillEvent({
        t: t0 + 3000,
        scenarioId: 'S4.1',
        side: 'sell_yes',
        price: 0.41,
        captureCents: 0.1,
        realizedDelta: 0.001,
        reason: 'S4.1 STUCK_UNWIND',
      }),
      buildFillEvent({
        t: t0 + 3500,
        scenarioId: 'S4.2',
        side: 'sell_yes',
        price: 0.35,
        captureCents: -5,
        realizedDelta: -0.05,
        reason: 'S4.2 MARK_BLEED',
      }),
      buildBlockedCloseEvent({
        t: t0 + 4000,
        scenarioId: 'S5',
        reason: 'CLOSE blocked: capture 0.2 < 1.0¢',
        captureCents: 0.2,
        stuckTicks: 7,
        captureGapCents: 0.8,
      }),
      buildS51EvictEvent({
        t: t0 + 5000,
        ticker: 'KXSOL15M-9',
        asset: 'SOL',
      }),
      // outside window
      buildFillEvent({
        t: t0 + 3_600_000 + 10,
        scenarioId: 'S1',
        side: 'buy_yes',
        price: 0.5,
      }),
    ]

    const digest = aggregateDigest(events, t0, t0 + 3_600_000)
    expect(digest.paperOnly).toBe(true)
    expect(digest.byScenario.S1?.fills).toBe(1)
    expect(digest.byScenario.S1?.openFills).toBe(1)
    expect(digest.byScenario.S1?.closeFills).toBe(0)
    expect(digest.byScenario.S3?.fills).toBe(1)
    expect(digest.byScenario.S3?.closeFills).toBe(1)
    expect(digest.byScenario.S3?.avgCentsPerFill).toBeCloseTo(3.2, 5)
    expect(digest.byScenario['S4.1']?.fills).toBe(1)
    expect(digest.byScenario['S4.1']?.stuckS41).toBe(1)
    expect(digest.byScenario['S4.2']?.fills).toBe(1)
    expect(digest.byScenario['S4.2']?.markBleedS42).toBe(1)
    expect(digest.byScenario.S5?.blockedCloses).toBe(1)
    expect(digest.byScenario['SLOT_EVICT']?.s51Evictions ?? digest.byScenario['S5.1']?.s51Evictions).toBe(1)
    expect(digest.totals.fills).toBe(4)
    expect(digest.totals.openFills).toBe(1)
    expect(digest.totals.closeFills).toBe(3)
    expect(digest.totals.avgCentsPerRoundTrip).toBeCloseTo(
      (0 + 3.2 + 0.1 + -5) / 3,
      5,
    )
    expect(digest.totals.markBleedS42).toBe(1)
    expect(digest.totals.s51Evictions).toBe(1)
    expect(digest.totals.blockedCloses).toBe(1)
    expect(digest.totals.events).toBe(6)
  })

  it('digest split keeps blended avgCentsPerFill backward-compatible', () => {
    const t0 = Date.UTC(2026, 8, 22, 4, 0, 0)
    const events = [
      buildFillEvent({
        t: t0 + 1,
        scenarioId: 'S1',
        side: 'buy_yes',
        price: 0.4,
        captureCents: 0,
      }),
      buildFillEvent({
        t: t0 + 2,
        scenarioId: 'S3',
        side: 'sell_yes',
        price: 0.42,
        captureCents: 2,
        realizedDelta: 0.02,
      }),
    ]
    const digest = aggregateDigest(events, t0, t0 + 3_600_000)
    expect(digest.totals.fills).toBe(2)
    expect(digest.totals.openFills).toBe(1)
    expect(digest.totals.closeFills).toBe(1)
    expect(digest.totals.avgCentsPerFill).toBeCloseTo(1, 5) // blended 2/2
    expect(digest.totals.avgCentsPerRoundTrip).toBeCloseTo(2, 5) // 2/1 closes
  })

  it('hourKeyFromMs returns YYYY-MM-DD-HH', () => {
    const key = hourKeyFromMs(Date.UTC(2026, 8, 22, 5, 30, 0), 'UTC')
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}$/)
    expect(key.endsWith('-05') || key.endsWith('-05')).toBe(true)
  })
})

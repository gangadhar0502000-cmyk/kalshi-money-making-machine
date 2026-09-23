/**
 * U3.2.2 — UI disk journal client + proxy append helpers.
 * PAPER ONLY.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  attachUiDiskJournal,
  mmFillToJournalEvent,
  postUiJournalEvents,
  postUiRunMeta,
  resetUiDiskJournalForTests,
  UI_JOURNAL_FAIL_LOUD_AFTER,
  getUiDiskJournalStatus,
  uiDiskJournalFailLoudMessage,
} from './uiDiskJournal'
import type { MmFill } from './types'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u322-journal-'))

afterEach(() => {
  resetUiDiskJournalForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function sampleFill(id = 'f1'): MmFill {
  return {
    id,
    t: 1_700_000_000_000,
    side: 'buy_yes',
    price: 0.42,
    size: 1,
    midAtFill: 0.43,
    toxic: false,
    reason: 'book_depth',
    feeDollars: 0,
    taker: false,
    ticker: 'KXBTC15M-TEST',
    asset: 'BTC',
    scenarioId: 'house_mid',
    inventoryBefore: 0,
    inventoryAfter: 1,
    fillSize: 1,
    captureDollars: 0,
    centerMode: 'mid',
  }
}

describe('mmFillToJournalEvent', () => {
  it('maps rich fill tape fields (shared schema w/ headless)', () => {
    const ev = mmFillToJournalEvent(sampleFill())
    expect(ev.type).toBe('fill')
    expect(ev.source).toBe('ui')
    expect(ev.ticker).toBe('KXBTC15M-TEST')
    expect(ev.side).toBe('buy_yes')
    expect(ev.price).toBe(0.42)
    expect(ev.mid).toBe(0.43)
    expect(ev.scenarioId).toBe('house_mid')
    expect(ev.inventoryBefore).toBe(0)
    expect(ev.inventory).toBe(1)
    expect(ev.reason).toBe('book_depth')
    expect(ev.iso).toMatch(/^\d{4}-/)
  })
})

describe('postUiJournalEvents', () => {
  it('POSTs events and clears fail streak on success', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fillsOnDisk: 2 }),
    })) as unknown as typeof fetch
    const fetchMock = fetchImpl as unknown as Mock
    const r = await postUiJournalEvents(
      [mmFillToJournalEvent(sampleFill('a')), mmFillToJournalEvent(sampleFill('b'))],
      fetchImpl,
    )
    expect(r.ok).toBe(true)
    expect(r.fillsOnDisk).toBe(2)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/local-api/paper-mm/journal')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.events).toHaveLength(2)
    expect(getUiDiskJournalStatus().consecutiveFailures).toBe(0)
    expect(getUiDiskJournalStatus().failLoud).toBe(false)
  })

  it('fail-loud after repeated POST failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('proxy down')
    }) as unknown as typeof fetch
    for (let i = 0; i < UI_JOURNAL_FAIL_LOUD_AFTER; i++) {
      const r = await postUiJournalEvents([mmFillToJournalEvent(sampleFill(`x${i}`))], fetchImpl)
      expect(r.ok).toBe(false)
    }
    expect(getUiDiskJournalStatus().failLoud).toBe(true)
    expect(uiDiskJournalFailLoudMessage()).toMatch(/disk journal POST failed/)
  })
})

describe('postUiRunMeta', () => {
  it('POSTs run-meta on session start', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, fillsOnDisk: 0 }),
    })) as unknown as typeof fetch
    const fetchMock = fetchImpl as unknown as Mock
    const r = await postUiRunMeta({ startedAt: 123, sha: 'abc' }, fetchImpl)
    expect(r.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/local-api/paper-mm/run-meta')
    expect(JSON.parse(String((init as RequestInit).body)).sha).toBe('abc')
  })
})

describe('attachUiDiskJournal', () => {
  it('no-op in Node (headless owns journal.jsonl)', () => {
    expect(typeof window).toBe('undefined')
    const unsub = attachUiDiskJournal({
      subscribe: () => () => {},
      getState: () => {
        throw new Error('should not read state when not attaching')
      },
    } as never)
    unsub()
  })

  it('in browser mock: posts new fills from portfolio subscribe', async () => {
    vi.stubGlobal('window', { document: {} } as Window)
    const fill = sampleFill('live-1')
    const listeners = new Set<() => void>()
    const state = {
      running: true,
      sessionStartedAt: 99,
      sessionFills: [] as MmFill[],
      books: [
        {
          slotId: 's1',
          fills: [fill],
          cancels: [],
          snapshot: {
            marketTicker: fill.ticker,
            asset: 'BTC',
            midYes: 0.43,
            fairValue: 0.4,
            edgeVsMidCents: -3,
            inventory: 1,
            minutesRemaining: 10,
            cash: 99.58,
            spotPrice: 100,
            floorStrike: 99,
            bookBestBid: 0.42,
            bookBestAsk: 0.44,
            quote: { centerMode: 'mid' as const },
          },
        },
      ],
      aggregate: {
        fillCount: 1,
        cash: 99.58,
        realizedSpreadPnl: 0,
        inventoryNet: 1,
      },
    }
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('journal-status')) {
        return { ok: true, json: async () => ({ fillsOnDisk: 0 }) }
      }
      if (String(url).includes('run-meta')) {
        return { ok: true, json: async () => ({ ok: true, fillsOnDisk: 0 }) }
      }
      return { ok: true, json: async () => ({ ok: true, fillsOnDisk: 1 }) }
    })
    vi.stubGlobal('fetch', fetchImpl)

    const portfolio = {
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      getState: () => state as never,
    }
    resetUiDiskJournalForTests()
    attachUiDiskJournal(portfolio as never)
    // Trigger a new fill
    state.books[0]!.fills = [fill, sampleFill('live-2')]
    state.aggregate.fillCount = 2
    for (const l of listeners) l()
    // allow microtasks
    await Promise.resolve()
    await Promise.resolve()
    const journalPosts = (fetchImpl as unknown as Mock).mock.calls.filter(
      ([u]: unknown[]) => String(u).includes('/local-api/paper-mm/journal'),
    )
    expect(journalPosts.length).toBeGreaterThanOrEqual(1)
  })
})

describe('mm-proxy-ui-journal append (server helpers)', () => {
  it('appends JSONL and counts fills', async () => {
    // @ts-expect-error — plain .mjs helper, no declaration file
    const mod = await import('../../../../scripts/mm-proxy-ui-journal.mjs')
    const journalPath = path.join(tmpRoot, 'ui-journal.jsonl')
    const metaPath = path.join(tmpRoot, 'ui-run-meta.json')
    if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath)

    const r = mod.appendUiJournalEvents(
      [
        {
          type: 'fill',
          t: 1,
          iso: '2026-09-23T00:00:00.000Z',
          ticker: 'T',
          side: 'buy_yes',
          price: 0.5,
          source: 'ui',
        },
      ],
      { journalPath },
    )
    expect(r.appended).toBe(1)
    expect(r.fillsOnDisk).toBe(1)
    const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).type).toBe('fill')

    const meta = mod.writeUiRunMeta(
      { startedAt: 42, sha: 'deadbeef' },
      { metaPath },
    )
    expect(meta.meta.sha).toBe('deadbeef')
    expect(fs.existsSync(metaPath)).toBe(true)

    expect(() => mod.assertSafeLocalApi('POST', '/local-api/paper-mm/journal')).not.toThrow()
    expect(() => mod.assertSafeLocalApi('POST', '/local-api/orderbook')).toThrow()
    expect(() => mod.assertSafeLocalApi('GET', '/local-api/health')).not.toThrow()
    expect(mod.isPaperMmLocalWritePath('/local-api/paper-mm/run-meta')).toBe(true)
  })
})

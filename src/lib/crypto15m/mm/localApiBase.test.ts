import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLocalApiBase, localApiUrl } from './localApiBase'

describe('localApiBase (U2.12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('Node/tests: empty base → relative /local-api', () => {
    // vitest default environment is node — no window
    expect(typeof window).toBe('undefined')
    expect(getLocalApiBase()).toBe('')
    expect(localApiUrl('/local-api/crypto15m')).toBe('/local-api/crypto15m')
    expect(localApiUrl('local-api/health')).toBe('/local-api/health')
  })

  it('jsdom/browser mock: uses http://127.0.0.1:8787 base', () => {
    vi.stubGlobal('window', { document: {} } as Window)
    expect(getLocalApiBase()).toBe('http://127.0.0.1:8787')
    expect(localApiUrl('/local-api/crypto15m')).toBe(
      'http://127.0.0.1:8787/local-api/crypto15m',
    )
    expect(localApiUrl('/local-api/orderbooks?tickers=A')).toBe(
      'http://127.0.0.1:8787/local-api/orderbooks?tickers=A',
    )
  })
})

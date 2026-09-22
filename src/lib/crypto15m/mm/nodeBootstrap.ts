/**
 * Node bootstrap for headless paper MM.
 * Polyfills window timers, file-backed localStorage, and absolute fetch URLs.
 * PAPER ONLY — never places live Kalshi orders.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface NodeBootstrapOpts {
  /** Directory for session.json + journal (default data/paper-mm). */
  dataDir: string
  /** mm-proxy base, e.g. http://127.0.0.1:8787 */
  proxyBase?: string
  /** Debounce ms for session disk writes. */
  persistDebounceMs?: number
}

function rewriteUrl(raw: string, proxyBase: string): string {
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/local-api')) {
    return proxyBase.replace(/\/$/, '') + raw
  }
  if (raw.startsWith('/api/binance')) {
    // Prefer .us (US / Mac get 451 from api.binance.com); fetch wrapper may fall back to .com
    return 'https://api.binance.us' + raw.replace(/^\/api\/binance/, '')
  }
  if (raw.startsWith('/api/coinbase')) {
    return 'https://api.exchange.coinbase.com' + raw.replace(/^\/api\/coinbase/, '')
  }
  if (raw.startsWith('/api/kalshi-ext')) {
    return (
      'https://external-api.kalshi.com/trade-api/v2' + raw.replace(/^\/api\/kalshi-ext/, '')
    )
  }
  if (raw.startsWith('/api/kalshi')) {
    return (
      'https://api.elections.kalshi.com/trade-api/v2' + raw.replace(/^\/api\/kalshi/, '')
    )
  }
  return raw
}

class FileLocalStorage implements Storage {
  private map = new Map<string, string>()
  private filePath: string
  private timer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number

  constructor(filePath: string, debounceMs: number) {
    this.filePath = filePath
    this.debounceMs = debounceMs
    this.load()
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const obj = JSON.parse(raw) as Record<string, string>
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') this.map.set(k, v)
      }
    } catch {
      /* corrupt — start empty */
    }
  }

  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flushSync(), this.debounceMs)
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      ;(this.timer as NodeJS.Timeout).unref?.()
    }
  }

  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const obj: Record<string, string> = {}
    for (const [k, v] of this.map) obj[k] = v
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const tmp = this.filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
    this.scheduleFlush()
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
    this.scheduleFlush()
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
    this.scheduleFlush()
  }
}

let bootstrapped = false

/**
 * Install Node polyfills once. Safe to call repeatedly.
 * Must run before importing portfolio/engine.
 */
export function bootstrapNodePaperMm(opts: NodeBootstrapOpts): {
  dataDir: string
  proxyBase: string
  storage: FileLocalStorage
} {
  const dataDir = opts.dataDir
  const proxyBase = opts.proxyBase ?? process.env.MM_PROXY_URL ?? 'http://127.0.0.1:8787'
  const debounceMs = opts.persistDebounceMs ?? 2000
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'digests'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true })

  const storage = new FileLocalStorage(path.join(dataDir, 'session-storage.json'), debounceMs)

  if (!bootstrapped) {
    // Timers — engine/portfolio use window.setInterval
    const win = {
      setInterval: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
        setInterval(fn, ms, ...args) as unknown as number,
      clearInterval: (id: number | null | undefined) => {
        if (id != null) clearInterval(id as unknown as NodeJS.Timeout)
      },
      setTimeout: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
        setTimeout(fn, ms, ...args) as unknown as number,
      clearTimeout: (id: number | null | undefined) => {
        if (id != null) clearTimeout(id as unknown as NodeJS.Timeout)
      },
    }
    ;(globalThis as unknown as { window: typeof win }).window = win

    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    })

    const origFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      let url: string
      if (typeof input === 'string') url = input
      else if (input instanceof URL) url = input.toString()
      else url = input.url
      const rewritten = rewriteUrl(url, proxyBase)
      if (rewritten === url) return origFetch(input as RequestInfo, init)
      const res = await origFetch(rewritten, init)
      // Binance geo: try .us first; if blocked, fall back to .com
      if (
        rewritten.includes('://api.binance.us/') &&
        (res.status === 451 || res.status === 403)
      ) {
        const comUrl = rewritten.replace('://api.binance.us/', '://api.binance.com/')
        return origFetch(comUrl, init)
      }
      return res
    }) as typeof fetch

    bootstrapped = true
  }

  return { dataDir, proxyBase, storage }
}

export function flushPaperMmStorage(): void {
  const s = (globalThis as unknown as { localStorage?: FileLocalStorage }).localStorage
  if (s && typeof s.flushSync === 'function') s.flushSync()
}

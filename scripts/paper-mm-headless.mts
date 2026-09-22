/**
 * Headless 24/7 paper crypto 15m MM runner (Node — no browser / Mac).
 * PAPER ONLY — NEVER places live Kalshi orders.
 *
 * Usage:
 *   npx vite-node scripts/paper-mm-headless.mts
 *   npm run mm:headless
 *
 * Expects mm-proxy on MM_PROXY_PORT (default 8787), or SPAWN_PROXY=1 to spawn it.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWriteStream, type WriteStream } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const DATA_DIR = process.env.PAPER_MM_DATA_DIR || path.join(REPO, 'data', 'paper-mm')
const PROXY_PORT = process.env.MM_PROXY_PORT || '8787'
const PROXY_BASE = process.env.MM_PROXY_URL || `http://127.0.0.1:${PROXY_PORT}`
const MARKET_POLL_MS = Number(process.env.PAPER_MM_MARKET_POLL_MS || 5000)
const DIGEST_CHECK_MS = Number(process.env.PAPER_MM_DIGEST_CHECK_MS || 60_000)
const SPAWN_PROXY = process.env.SPAWN_PROXY !== '0'

const { bootstrapNodePaperMm, flushPaperMmStorage } = await import(
  '../src/lib/crypto15m/mm/nodeBootstrap.ts',
)
bootstrapNodePaperMm({
  dataDir: DATA_DIR,
  proxyBase: PROXY_BASE,
})

const {
  formatJournalLine,
  parseJournalLine,
  aggregateDigest,
  buildFillEvent,
  buildBlockedCloseEvent,
  buildS51EvictEvent,
  hourKeyFromMs,
} = await import('../src/lib/crypto15m/mm/headlessJournal.ts')

const { PaperMmPortfolio } = await import('../src/lib/crypto15m/mm/portfolio.ts')
const { fetchCrypto15mMarkets } = await import('../src/lib/crypto15m/api.ts')
const { fetchLocalHealth } = await import('../src/lib/crypto15m/mm/liveBook.ts')
const { STRICT_PAPER_MM_CONFIG } = await import('../src/lib/crypto15m/mm/config.ts')

import type { JournalEvent } from '../src/lib/crypto15m/mm/headlessJournal.ts'
import type { PortfolioState } from '../src/lib/crypto15m/mm/portfolio.ts'

const JOURNAL_PATH = path.join(DATA_DIR, 'journal.jsonl')
const DIGEST_DIR = path.join(DATA_DIR, 'digests')
const LATEST_DIGEST = path.join(DATA_DIR, 'digest-latest.json')
const HEALTH_PATH = path.join(DATA_DIR, 'runner-health.json')

function log(...args: unknown[]) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })
  console.log(`[paper-mm ${ts} CT]`, ...args)
}

function appendJournal(ev: JournalEvent, stream: WriteStream): void {
  stream.write(formatJournalLine(ev) + '\n')
  const bits = [
    ev.type,
    ev.scenarioId,
    ev.ticker,
    ev.asset,
    ev.side,
    ev.price != null ? `px=${ev.price.toFixed(3)}` : null,
    ev.edgeCents != null ? `edge=${ev.edgeCents.toFixed(1)}¢` : null,
    ev.inventory != null ? `inv=${ev.inventory}` : null,
    ev.minutesLeft != null ? `minLeft=${ev.minutesLeft.toFixed(1)}` : null,
    ev.captureCents != null ? `cap=${ev.captureCents.toFixed(2)}¢` : null,
    ev.realizedDelta != null ? `ΔR=$${ev.realizedDelta.toFixed(4)}` : null,
    ev.reason,
  ].filter(Boolean)
  log(...bits)
}

function readRecentJournal(maxLines = 50_000): JournalEvent[] {
  if (!fs.existsSync(JOURNAL_PATH)) return []
  const raw = fs.readFileSync(JOURNAL_PATH, 'utf8')
  const lines = raw.split('\n')
  const slice = lines.length > maxLines ? lines.slice(-maxLines) : lines
  const out: JournalEvent[] = []
  for (const line of slice) {
    const ev = parseJournalLine(line)
    if (ev) out.push(ev)
  }
  return out
}

function writeDigestForHour(hourKey: string, events: JournalEvent[]): void {
  const inHour = events.filter((e) => hourKeyFromMs(e.t) === hourKey)
  const lo = inHour.length ? Math.min(...inHour.map((e) => e.t)) : Date.now() - 3_600_000
  const hi = inHour.length ? Math.max(...inHour.map((e) => e.t)) + 1 : Date.now()
  const digest = aggregateDigest(inHour, lo - 1, hi + 1)
  digest.hourKey = hourKey
  fs.mkdirSync(DIGEST_DIR, { recursive: true })
  const outPath = path.join(DIGEST_DIR, `${hourKey}.json`)
  fs.writeFileSync(outPath, JSON.stringify(digest, null, 2))
  fs.writeFileSync(LATEST_DIGEST, JSON.stringify(digest, null, 2))
  log(`digest wrote ${outPath} fills=${digest.totals.fills} events=${digest.totals.events}`)
}

async function waitForProxy(timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const h = await fetchLocalHealth()
    if (h?.ok) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

function spawnProxyProc(): ChildProcess {
  const child = spawn(process.execPath, [path.join(__dirname, 'mm-proxy.mjs')], {
    cwd: REPO,
    env: { ...process.env, MM_PROXY_PORT: PROXY_PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (b) => process.stdout.write(`[mm-proxy] ${b}`))
  child.stderr?.on('data', (b) => process.stderr.write(`[mm-proxy] ${b}`))
  child.on('exit', (code, signal) => {
    log(`mm-proxy exited code=${code} signal=${signal}`)
  })
  return child
}

async function runPaperMmLoop(): Promise<void> {
  log('PAPER ONLY — never places live Kalshi orders')
  log(`dataDir=${DATA_DIR} proxy=${PROXY_BASE}`)

  let proxyChild: ChildProcess | null = null
  if (SPAWN_PROXY) {
    const already = await fetchLocalHealth()
    if (already?.ok) {
      log('mm-proxy already healthy — not spawning another')
    } else {
      log('spawning mm-proxy…')
      proxyChild = spawnProxyProc()
    }
  }

  const ok = await waitForProxy(45_000)
  if (!ok) {
    throw new Error(`mm-proxy not healthy at ${PROXY_BASE}/local-api/health`)
  }
  log('mm-proxy healthy')

  const journalStream = createWriteStream(JOURNAL_PATH, { flags: 'a' })
  const hourEvents: JournalEvent[] = []
  let currentHourKey = hourKeyFromMs(Date.now())

  for (const ev of readRecentJournal(20_000)) {
    if (hourKeyFromMs(ev.t) === currentHourKey) hourEvents.push(ev)
  }

  const portfolio = new PaperMmPortfolio()
  portfolio.setPersistEnabled(true)
  portfolio.setConfig({
    ...STRICT_PAPER_MM_CONFIG,
    multiBook: true,
    strictRealism: true,
    fvQuoting: true,
  })

  const seenFillIds = new Set<string>()
  for (const f of portfolio.getSessionLedger().fills) {
    seenFillIds.add(f.id)
  }
  const lastBlockedKey = new Map<string, string>()
  let lastMessage = ''

  const onState = (st: PortfolioState) => {
    for (const book of st.books) {
      const snap = book.snapshot
      for (const f of book.fills) {
        if (seenFillIds.has(f.id)) continue
        seenFillIds.add(f.id)
        const scenario =
          f.side === 'buy_yes' ? snap.quote?.bidScenario : snap.quote?.askScenario
        const ev = buildFillEvent({
          t: f.t,
          scenarioId: scenario ?? snap.quote?.activeScenario,
          ticker: f.ticker ?? snap.marketTicker,
          asset: snap.asset,
          side: f.side,
          price: f.price,
          edgeCents: snap.edgeVsMidCents,
          inventory: snap.inventory,
          minutesLeft: snap.minutesRemaining,
          captureCents: f.captureDollars != null ? f.captureDollars * 100 : undefined,
          reason: f.reason,
          realizedDelta: f.captureDollars,
        })
        hourEvents.push(ev)
        appendJournal(ev, journalStream)
      }

      const q = snap.quote
      if (q) {
        for (const [side, reason, scenario] of [
          ['bid', q.bidReason, q.bidScenario],
          ['ask', q.askReason, q.askScenario],
        ] as const) {
          if (!reason || !/CLOSE blocked/i.test(reason)) continue
          const fp = `${snap.marketTicker}|${side}|${reason}`
          const mapKey = `${snap.marketTicker}|${side}`
          if (lastBlockedKey.get(mapKey) === fp) continue
          lastBlockedKey.set(mapKey, fp)
          const ev = buildBlockedCloseEvent({
            scenarioId: scenario ?? 'S5',
            ticker: snap.marketTicker,
            asset: snap.asset,
            side,
            price: side === 'bid' ? q.yesBid : q.yesAsk,
            edgeCents: snap.edgeVsMidCents,
            inventory: snap.inventory,
            minutesLeft: snap.minutesRemaining,
            reason,
          })
          hourEvents.push(ev)
          appendJournal(ev, journalStream)
        }
      }
    }

    if (st.message !== lastMessage) {
      lastMessage = st.message
      if (/S5\.1 SLOT_EVICT/i.test(st.message)) {
        const m = /Slot released \(([^)]+)\)/.exec(st.message)
        const ev = buildS51EvictEvent({
          ticker: m?.[1] ?? null,
          reason: st.message,
        })
        hourEvents.push(ev)
        appendJournal(ev, journalStream)
      }
    }
  }

  portfolio.subscribe(() => onState(portfolio.getState()))

  async function pollMarkets(): Promise<void> {
    try {
      const result = await fetchCrypto15mMarkets()
      if (result.markets.length > 0) {
        portfolio.syncMarketUniverse(result.markets)
        portfolio.tryAutoResumeAfterSync()
        if (!portfolio.getState().running) {
          portfolio.start({ resume: true })
        }
      } else if (result.error) {
        log(`markets empty: ${result.error.slice(0, 160)}`)
      }
    } catch (e) {
      log(`market poll error: ${e instanceof Error ? e.message : e}`)
    }
  }

  await pollMarkets()
  if (!portfolio.getState().running) {
    portfolio.start()
  }
  log(
    `running books=${portfolio.getState().books.length} msg=${portfolio.getState().message.slice(0, 120)}`,
  )

  const marketTimer = setInterval(() => void pollMarkets(), MARKET_POLL_MS)
  const digestTimer = setInterval(() => {
    const nowKey = hourKeyFromMs(Date.now())
    if (nowKey !== currentHourKey) {
      writeDigestForHour(currentHourKey, hourEvents)
      const next = hourEvents.filter((e) => hourKeyFromMs(e.t) === nowKey)
      hourEvents.length = 0
      hourEvents.push(...next)
      currentHourKey = nowKey
    } else {
      writeDigestForHour(currentHourKey, hourEvents)
    }
    const st = portfolio.getState()
    fs.writeFileSync(
      HEALTH_PATH,
      JSON.stringify(
        {
          ok: true,
          paperOnly: true,
          t: Date.now(),
          iso: new Date().toISOString(),
          running: st.running,
          books: st.books.length,
          fills: st.aggregate.fillCount,
          realized: st.aggregate.realizedSpreadPnl,
          message: st.message,
        },
        null,
        2,
      ),
    )
    flushPaperMmStorage()
  }, DIGEST_CHECK_MS)

  const shutdown = (sig: string) => {
    log(`shutdown ${sig}`)
    clearInterval(marketTimer)
    clearInterval(digestTimer)
    try {
      writeDigestForHour(currentHourKey, hourEvents)
    } catch {
      /* ignore */
    }
    try {
      portfolio.stop()
    } catch {
      /* ignore */
    }
    flushPaperMmStorage()
    journalStream.end()
    if (proxyChild && !proxyChild.killed) proxyChild.kill('SIGTERM')
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  writeDigestForHour(currentHourKey, hourEvents)
  // immediate health so ops can verify without waiting a full digest interval
  {
    const st = portfolio.getState()
    fs.writeFileSync(
      HEALTH_PATH,
      JSON.stringify(
        {
          ok: true,
          paperOnly: true,
          t: Date.now(),
          iso: new Date().toISOString(),
          running: st.running,
          books: st.books.length,
          fills: st.aggregate.fillCount,
          realized: st.aggregate.realizedSpreadPnl,
          message: st.message,
        },
        null,
        2,
      ),
    )
  }
  log('headless paper MM loop armed — Ctrl+C / SIGTERM to stop')

  await new Promise(() => {})
}

runPaperMmLoop().catch((e) => {
  console.error('[paper-mm] fatal', e)
  try {
    flushPaperMmStorage()
  } catch {
    /* ignore */
  }
  process.exit(1)
})

/**
 * U3.2.2 — Local paper UI disk journal helpers for mm-proxy.
 * Append-only JSONL under data/paper-mm/ — NEVER touches Kalshi orders.
 * PAPER ONLY.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')

export const UI_JOURNAL_DIR =
  process.env.PAPER_MM_DATA_DIR || path.join(REPO, 'data', 'paper-mm')
export const UI_JOURNAL_PATH = path.join(UI_JOURNAL_DIR, 'ui-journal.jsonl')
export const UI_RUN_META_PATH = path.join(UI_JOURNAL_DIR, 'ui-run-meta.json')

/** Max body bytes for a single POST (fills batch + snapshot). */
export const UI_JOURNAL_MAX_BODY_BYTES = 512_000

/** Allowed local paper-mm POST routes (never forwarded upstream). */
export function isPaperMmLocalWritePath(pathname) {
  const p = String(pathname || '').split('?')[0].toLowerCase()
  return (
    p === '/local-api/paper-mm/journal' ||
    p === '/local-api/paper-mm/run-meta'
  )
}

/**
 * Safe local API gate: Kalshi stays GET-only; paper-mm journal POSTs allowed.
 * Throws on anything else that is not a safe GET or local paper write.
 */
export function assertSafeLocalApi(method, urlPath) {
  const m = String(method || '').toUpperCase()
  const p = String(urlPath || '').split('?')[0].toLowerCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return
  if (m === 'POST' && isPaperMmLocalWritePath(p)) return
  throw new Error(
    `Local API: refusing ${m} ${p} — only GET + POST /local-api/paper-mm/* journal`,
  )
}

/** Normalize one journal event; returns null if unusable. */
export function normalizeJournalEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = raw
  const type = typeof o.type === 'string' ? o.type : null
  if (!type) return null
  const t =
    typeof o.t === 'number' && Number.isFinite(o.t) ? o.t : Date.now()
  const iso =
    typeof o.iso === 'string' && o.iso.length > 0
      ? o.iso
      : new Date(t).toISOString()
  // Cap string lengths — fail-loud size, not silent truncate of numbers.
  const clip = (v, n = 240) =>
    typeof v === 'string' ? v.slice(0, n) : v === undefined ? undefined : v
  return {
    ...o,
    type,
    t,
    iso,
    source: o.source === 'ui' || o.source == null ? 'ui' : clip(String(o.source), 32),
    ticker: clip(o.ticker),
    asset: clip(o.asset),
    side: clip(o.side, 32),
    reason: clip(o.reason),
    scenarioId: clip(o.scenarioId, 64),
  }
}

export function ensureJournalDir(dir = UI_JOURNAL_DIR) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * Append one or more events as JSONL. Returns { appended, path, fillsOnDisk }.
 * Fail-loud: throws on I/O / empty batch after normalize.
 */
export function appendUiJournalEvents(events, opts = {}) {
  const journalPath = opts.journalPath || UI_JOURNAL_PATH
  const dir = path.dirname(journalPath)
  ensureJournalDir(dir)
  const list = Array.isArray(events) ? events : [events]
  const lines = []
  for (const ev of list) {
    const n = normalizeJournalEvent(ev)
    if (n) lines.push(JSON.stringify(n))
  }
  if (lines.length === 0) {
    throw new Error('U3.2.2: no valid journal events to append')
  }
  fs.appendFileSync(journalPath, lines.join('\n') + '\n', 'utf8')
  return {
    appended: lines.length,
    path: journalPath,
    fillsOnDisk: countUiJournalFills(journalPath),
  }
}

/** Count fill-typed lines in the UI journal (cheap scan). */
export function countUiJournalFills(journalPath = UI_JOURNAL_PATH) {
  if (!fs.existsSync(journalPath)) return 0
  const raw = fs.readFileSync(journalPath, 'utf8')
  let n = 0
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t.includes('"type":"fill"') || t.includes('"type": "fill"')) n += 1
  }
  return n
}

/** Last N JSONL events (newest last). */
export function readUiJournalTail(n = 50, journalPath = UI_JOURNAL_PATH) {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(n) || 50)))
  if (!fs.existsSync(journalPath)) return []
  const raw = fs.readFileSync(journalPath, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim())
  const slice = lines.slice(-limit)
  const out = []
  for (const line of slice) {
    try {
      out.push(JSON.parse(line))
    } catch {
      /* skip corrupt */
    }
  }
  return out
}

/** Write ui-run-meta.json for a new browser UI session. */
export function writeUiRunMeta(meta, opts = {}) {
  const metaPath = opts.metaPath || UI_RUN_META_PATH
  ensureJournalDir(path.dirname(metaPath))
  const startedAt =
    typeof meta?.startedAt === 'number' && Number.isFinite(meta.startedAt)
      ? meta.startedAt
      : Date.now()
  const body = {
    paperOnly: true,
    source: 'ui',
    startedAt,
    startedAtIso: new Date(startedAt).toISOString(),
    sha: typeof meta?.sha === 'string' ? meta.sha.slice(0, 64) : null,
    note: typeof meta?.note === 'string' ? meta.note.slice(0, 240) : undefined,
    writtenAt: new Date().toISOString(),
  }
  fs.writeFileSync(metaPath, JSON.stringify(body, null, 2) + '\n', 'utf8')
  return { path: metaPath, meta: body }
}

/** Read request body with size cap. */
export function readRequestBody(req, maxBytes = UI_JOURNAL_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error(`U3.2.2: body too large (>${maxBytes} bytes)`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

/**
 * Read-only Kalshi local proxy for paper MM.
 * Holds API secrets server-side. NEVER places, amends, or cancels real orders.
 *
 * Safe local routes only:
 *   GET /local-api/health
 *   GET /local-api/status
 *   GET /local-api/exchange-status
 *   GET /local-api/orderbook?ticker=
 *   GET /local-api/market?ticker=
 *   GET /local-api/crypto15m
 *   GET /local-api/markets?series_ticker=
 */
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { URL } from 'node:url'

const PORT = Number(process.env.MM_PROXY_PORT || 8787)
const BASES = [
  'https://api.elections.kalshi.com/trade-api/v2',
  'https://external-api.kalshi.com/trade-api/v2',
]

const CRYPTO_15M_SERIES = [
  'KXBTC15M',
  'KXETH15M',
  'KXSOL15M',
  'KXDOGE15M',
  'KXADA15M',
  'KXBNB15M',
  'KXXRP15M',
  'KXBCH15M',
  'KXTON15M',
  'KXNEAR15M',
  'KXZEC15M',
  'KXHYPE15M',
  'KXCRYPTOCOMP15M',
  'KXCRYPTOLEAD15M',
]

/** Hard read-only gate — throws if method/path could create or mutate orders. */
export function assertReadOnly(method, path) {
  const m = String(method || '').toUpperCase()
  if (m !== 'GET') {
    throw new Error(`Read-only API: refusing non-GET method ${m}`)
  }
  const p = String(path || '').split('?')[0].toLowerCase()
  const blocked =
    p.includes('/portfolio/orders') ||
    p.includes('/portfolio/order_groups') ||
    p.includes('/order_groups') ||
    /(^|\/)orders(\/|$)/.test(p) ||
    p.includes('/batch_create') ||
    p.includes('/batch_cancel') ||
    p.endsWith('/create') ||
    p.includes('/amend') ||
    p.includes('/cancel')
  if (blocked) {
    throw new Error(`Read-only API: refusing order-related path ${p}`)
  }
}

function loadDotEnvLocal() {
  try {
    const envPath = new URL('../.env.local', import.meta.url)
    const raw = fs.readFileSync(envPath, 'utf8')
    for (const line of raw.split(/\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 1) continue
      const k = t.slice(0, eq).trim()
      let v = t.slice(eq + 1).trim()
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      v = v.replace(/\\n/g, '\n')
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    /* optional */
  }
}

loadDotEnvLocal()

function loadSecrets() {
  let keyId = process.env.KALSHI_KEY_ID || ''
  let privateKeyRaw = process.env.KALSHI_PRIVATE_KEY || ''

  if (!keyId || !privateKeyRaw) {
    const secretsPath =
      process.env.KALSHI_SECRETS_PATH || '/home/box/agent-data/box-secrets.json'
    try {
      const raw = fs.readFileSync(secretsPath, 'utf8')
      const data = JSON.parse(raw)
      const card = data.card && typeof data.card === 'object' ? data.card : data
      keyId = keyId || card.KALSHI_KEY_ID || ''
      privateKeyRaw = privateKeyRaw || card.KALSHI_PRIVATE_KEY || ''
    } catch {
      /* optional on machines without box secrets */
    }
  }

  if (!keyId || !privateKeyRaw) {
    return { keyId: null, privateKey: null, source: 'none' }
  }

  try {
    const privateKey = createPrivateKeySafe(privateKeyRaw)
    return { keyId, privateKey, source: process.env.KALSHI_KEY_ID ? 'env' : 'file' }
  } catch (e) {
    console.error('[mm-proxy] failed to load private key (continuing unsigned public GETs):', e instanceof Error ? e.message : 'error')
    return { keyId: null, privateKey: null, source: 'invalid' }
  }
}

function createPrivateKeySafe(raw) {
  const s = String(raw).trim()
  if (s.includes('BEGIN')) {
    return crypto.createPrivateKey(s.replace(/\\n/g, '\n'))
  }
  // Base64 DER — try PKCS#1 RSA then PKCS#8 (JSON often stores single-line keys)
  const der = Buffer.from(s.replace(/\s+/g, ''), 'base64')
  try {
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs1' })
  } catch {
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  }
}

function signRequest(privateKey, timestamp, method, fullPath) {
  const pathWithoutQuery = fullPath.split('?')[0]
  const message = `${timestamp}${method.toUpperCase()}${pathWithoutQuery}`
  const sig = crypto.sign('sha256', Buffer.from(message, 'utf8'), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  })
  return sig.toString('base64')
}

const secrets = loadSecrets()
// Never log secret values — only presence / source.
console.log(
  `[mm-proxy] read-only · credentials: ${secrets.keyId ? 'loaded' : 'MISSING'} (${secrets.source}) · port ${PORT}`,
)

async function kalshiGet(apiPathWithQuery) {
  assertReadOnly('GET', apiPathWithQuery)
  const pathOnly = apiPathWithQuery.startsWith('/')
    ? apiPathWithQuery
    : `/${apiPathWithQuery}`
  // Allowlist upstream paths
  const bare = pathOnly.split('?')[0]
  const allowed =
    bare === '/exchange/status' ||
    bare === '/markets' ||
    /^\/markets\/[^/]+$/.test(bare) ||
    /^\/markets\/[^/]+\/orderbook$/.test(bare)
  if (!allowed) {
    throw new Error(`Read-only allowlist: refusing upstream path ${bare}`)
  }

  let lastErr = null
  for (const base of BASES) {
    const url = `${base}${pathOnly}`
    const signPath = new URL(url).pathname
    const headers = { Accept: 'application/json' }
    if (secrets.keyId && secrets.privateKey) {
      const ts = String(Date.now())
      headers['KALSHI-ACCESS-KEY'] = secrets.keyId
      headers['KALSHI-ACCESS-TIMESTAMP'] = ts
      headers['KALSHI-ACCESS-SIGNATURE'] = signRequest(
        secrets.privateKey,
        ts,
        'GET',
        signPath,
      )
    }
    try {
      const res = await fetch(url, { headers })
      const text = await res.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        json = { raw: text.slice(0, 200) }
      }
      if (!res.ok) {
        lastErr = new Error(`Kalshi ${res.status} on ${bare}`)
        continue
      }
      return { ok: true, status: res.status, json, authenticated: Boolean(secrets.keyId) }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastErr || new Error('Kalshi GET failed')
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(payload)
}

function isCrypto15m(m) {
  const series = String(m.event_ticker || m.ticker || '')
    .split('-')[0]
    .toUpperCase()
  if (CRYPTO_15M_SERIES.includes(series)) return true
  return /15M$/i.test(series) && /BTC|ETH|SOL|DOGE|ADA|BNB|XRP|BCH|CRYPTO|TON|NEAR|ZEC|HYPE/i.test(series)
}

async function handleLocal(req, res, url) {
  const route = url.pathname

  if (route === '/local-api/health') {
    return sendJson(res, 200, {
      ok: true,
      readOnly: true,
      banner: 'Read-only API · never places trades',
      credentialsLoaded: Boolean(secrets.keyId),
      credentialsSource: secrets.source,
    })
  }

  if (route === '/local-api/status') {
    return sendJson(res, 200, {
      ok: true,
      readOnly: true,
      liveBook: Boolean(secrets.keyId),
      banner: 'Read-only API · never places trades',
      credentialsLoaded: Boolean(secrets.keyId),
    })
  }

  if (route === '/local-api/exchange-status') {
    const data = await kalshiGet('/exchange/status')
    return sendJson(res, 200, { ...data.json, _meta: { readOnly: true, authenticated: data.authenticated } })
  }

  if (route === '/local-api/orderbook') {
    const ticker = url.searchParams.get('ticker')
    if (!ticker) return sendJson(res, 400, { error: 'ticker required' })
    if (!/^[A-Z0-9\-]+$/i.test(ticker)) {
      return sendJson(res, 400, { error: 'invalid ticker' })
    }
    const depth = url.searchParams.get('depth') || '25'
    const data = await kalshiGet(
      `/markets/${encodeURIComponent(ticker)}/orderbook?depth=${encodeURIComponent(depth)}`,
    )
    return sendJson(res, 200, {
      ticker,
      fetchedAt: new Date().toISOString(),
      readOnly: true,
      authenticated: data.authenticated,
      ...data.json,
    })
  }

  if (route === '/local-api/market') {
    const ticker = url.searchParams.get('ticker')
    if (!ticker) return sendJson(res, 400, { error: 'ticker required' })
    if (!/^[A-Z0-9\-]+$/i.test(ticker)) {
      return sendJson(res, 400, { error: 'invalid ticker' })
    }
    const data = await kalshiGet(`/markets/${encodeURIComponent(ticker)}`)
    return sendJson(res, 200, {
      readOnly: true,
      authenticated: data.authenticated,
      ...data.json,
    })
  }

  if (route === '/local-api/markets') {
    const series = url.searchParams.get('series_ticker')
    if (!series) return sendJson(res, 400, { error: 'series_ticker required' })
    const q = new URLSearchParams({
      series_ticker: series,
      status: url.searchParams.get('status') || 'open',
      limit: url.searchParams.get('limit') || '20',
      mve_filter: 'exclude',
    })
    const data = await kalshiGet(`/markets?${q}`)
    return sendJson(res, 200, {
      readOnly: true,
      authenticated: data.authenticated,
      ...data.json,
    })
  }

  if (route === '/local-api/crypto15m') {
    const byTicker = new Map()
    const errors = []
    for (const series of CRYPTO_15M_SERIES) {
      try {
        const q = new URLSearchParams({
          series_ticker: series,
          status: 'open',
          limit: '20',
          mve_filter: 'exclude',
        })
        const data = await kalshiGet(`/markets?${q}`)
        for (const m of data.json.markets || []) {
          if (isCrypto15m(m)) byTicker.set(m.ticker, m)
        }
      } catch (e) {
        errors.push(`${series}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return sendJson(res, 200, {
      readOnly: true,
      authenticated: Boolean(secrets.keyId),
      markets: [...byTicker.values()],
      errors: errors.slice(0, 5),
      fetchedAt: new Date().toISOString(),
      banner: 'Read-only API · never places trades',
    })
  }

  return sendJson(res, 404, {
    error: 'Not found — read-only allowlist only',
    banner: 'Read-only API · never places trades',
  })
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
    })
    return res.end()
  }

  try {
    assertReadOnly(req.method, req.url || '/')
  } catch (e) {
    return sendJson(res, 403, {
      error: e instanceof Error ? e.message : String(e),
      banner: 'Read-only API · never places trades',
    })
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
  if (!url.pathname.startsWith('/local-api/')) {
    return sendJson(res, 404, { error: 'Only /local-api/* is exposed' })
  }

  handleLocal(req, res, url).catch((e) => {
    sendJson(res, 502, {
      error: e instanceof Error ? e.message : String(e),
      readOnly: true,
    })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[mm-proxy] listening http://127.0.0.1:${PORT} · Read-only API · never places trades`,
  )
})

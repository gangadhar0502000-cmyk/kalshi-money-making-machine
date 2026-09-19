export function parseDollars(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

export function parseCount(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

export function formatCents(dollars: number): string {
  return `${Math.round(dollars * 100)}¢`
}

export function formatDollars(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}

export function formatPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`
}

export function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h ago`
  return new Date(iso).toLocaleString()
}

export function hoursUntil(iso: string): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (t - Date.now()) / 3_600_000)
}

export function inferCategory(m: {
  category?: string
  event_ticker?: string
  ticker?: string
  title?: string
}): string {
  if (m.category && m.category.trim()) return m.category.trim()
  const blob = `${m.event_ticker ?? ''} ${m.ticker ?? ''} ${m.title ?? ''}`.toUpperCase()
  if (/BTC|ETH|CRYPTO|BITCOIN|SOL/.test(blob)) return 'Crypto'
  if (/FED|CPI|UNEMP|INFL|GDP|JOBS|RATE/.test(blob)) return 'Economics'
  if (/SPX|NASDAQ|DOW|STOCK|IPO/.test(blob)) return 'Finance'
  if (/HOUSE|SENATE|PRES|ELECTION|DEM|GOP|CONGRESS/.test(blob)) return 'Politics'
  if (/NFL|NBA|MLB|NHL|SOCCER|UFC|SPORT|SUPER.?BOWL/.test(blob)) return 'Sports'
  if (/WEATHER|CLIMATE|TEMP|HURRICANE/.test(blob)) return 'Climate'
  if (/OSCAR|EMMY|GRAMMY|MOVIE|FILM/.test(blob)) return 'Entertainment'
  if (/OIL|GOLD|WTI|COMMOD/.test(blob)) return 'Commodities'
  if (/AI|TECH|TESLA|OPENAI|SPACE|NASA/.test(blob)) return 'Technology'
  return 'Other'
}

export function kalshiMarketUrl(ticker: string, eventTicker?: string): string {
  const series = (eventTicker || ticker).split('-')[0]?.toLowerCase() || 'markets'
  return `https://kalshi.com/markets/${series}/${ticker.toLowerCase()}`
}

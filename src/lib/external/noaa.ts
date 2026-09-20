/**
 * Free NOAA / NWS forecast path (no API key).
 * api.weather.gov requires a descriptive User-Agent — set via Vite proxy.
 */

export interface WeatherMarketHint {
  cityKey: string
  lat: number
  lon: number
  /** Fahrenheit threshold mentioned in title, if any */
  thresholdF?: number
  direction: 'above' | 'below' | 'unknown'
}

export interface NoaaFairEstimate {
  fairProb: number
  detail: string
  cityKey: string
  forecastHighF?: number
}

const CITY_COORDS: Record<string, { lat: number; lon: number; label: string }> = {
  nyc: { lat: 40.7829, lon: -73.9654, label: 'NYC Central Park' },
  'new york': { lat: 40.7829, lon: -73.9654, label: 'NYC Central Park' },
  chicago: { lat: 41.8781, lon: -87.6298, label: 'Chicago' },
  miami: { lat: 25.7617, lon: -80.1918, label: 'Miami' },
  denver: { lat: 39.7392, lon: -104.9903, label: 'Denver' },
  seattle: { lat: 47.6062, lon: -122.3321, label: 'Seattle' },
  boston: { lat: 42.3601, lon: -71.0589, label: 'Boston' },
  'los angeles': { lat: 34.0522, lon: -118.2437, label: 'Los Angeles' },
  la: { lat: 34.0522, lon: -118.2437, label: 'Los Angeles' },
  houston: { lat: 29.7604, lon: -95.3698, label: 'Houston' },
  dallas: { lat: 32.7767, lon: -96.797, label: 'Dallas' },
  atlanta: { lat: 33.749, lon: -84.388, label: 'Atlanta' },
  phoenix: { lat: 33.4484, lon: -112.074, label: 'Phoenix' },
}

/** Detect weather-tagged Kalshi markets from title/ticker. */
export function detectWeatherMarket(title: string, ticker: string): WeatherMarketHint | null {
  const blob = `${title} ${ticker}`.toLowerCase()
  if (!/weather|temp|°f|°c|\bf\b|heat|cold|rain|snow|hurricane|climate/.test(blob) &&
      !/kxweather|kxclimate|kxheat|kxcold/.test(blob)) {
    // Still allow explicit city + temperature pattern
    if (!/\d+\s*°?\s*f/.test(blob) && !/\d+\s*degrees/.test(blob)) return null
  }

  let cityKey: string | null = null
  for (const key of Object.keys(CITY_COORDS)) {
    if (blob.includes(key) || blob.includes(key.replace(/\s+/g, ''))) {
      cityKey = key
      break
    }
  }
  if (!cityKey && /central\s*park|nyc|new\s*york/.test(blob)) cityKey = 'nyc'
  if (!cityKey) return null

  const coords = CITY_COORDS[cityKey]
  if (!coords) return null

  const threshMatch =
    blob.match(/(?:hit|reach|above|over|≥|>=|at\s+least)\s*(\d{2,3})\s*°?\s*f/) ||
    blob.match(/(\d{2,3})\s*°?\s*f\+/) ||
    blob.match(/(\d{2,3})\s*°?\s*f/)
  const thresholdF = threshMatch ? Number(threshMatch[1]) : undefined

  let direction: WeatherMarketHint['direction'] = 'unknown'
  if (/above|over|≥|>=|at\s+least|hit|reach|\+/.test(blob)) direction = 'above'
  else if (/below|under|≤|<=|under/.test(blob)) direction = 'below'

  return {
    cityKey,
    lat: coords.lat,
    lon: coords.lon,
    thresholdF,
    direction: direction === 'unknown' && thresholdF !== undefined ? 'above' : direction,
  }
}

/**
 * Logistic-ish mapping from (forecastHigh − threshold) → P(hit threshold).
 * Rough research heuristic — not a calibrated weather model.
 */
export function fairFromForecastHigh(
  forecastHighF: number,
  thresholdF: number,
  direction: 'above' | 'below' | 'unknown',
): number {
  const delta = forecastHighF - thresholdF
  // ~7°F scale: clearly above → high yes for "above" markets
  const pAbove = 1 / (1 + Math.exp(-delta / 3.5))
  if (direction === 'below') return clamp(1 - pAbove, 0.02, 0.98)
  return clamp(pAbove, 0.02, 0.98)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

interface PointsResponse {
  properties?: {
    forecast?: string
  }
}

interface ForecastResponse {
  properties?: {
    periods?: Array<{
      name?: string
      isDaytime?: boolean
      temperature?: number
      temperatureUnit?: string
      shortForecast?: string
    }>
  }
}

/**
 * Fetch NWS forecast via Vite proxy `/api/noaa/...`.
 * Returns null on network / parse failure (caller degrades gracefully).
 */
export async function fetchNoaaFair(
  hint: WeatherMarketHint,
  signal?: AbortSignal,
): Promise<NoaaFairEstimate | null> {
  if (hint.thresholdF === undefined) return null

  try {
    const pointsUrl = `/api/noaa/points/${hint.lat.toFixed(4)},${hint.lon.toFixed(4)}`
    const pointsRes = await fetch(pointsUrl, {
      signal,
      headers: { Accept: 'application/geo+json' },
    })
    if (!pointsRes.ok) throw new Error(`points HTTP ${pointsRes.status}`)
    const points = (await pointsRes.json()) as PointsResponse
    const forecastUrl = points.properties?.forecast
    if (!forecastUrl) throw new Error('No forecast URL')

    // Rewrite absolute NWS URL through our proxy
    const proxiedForecast = forecastUrl.replace(
      'https://api.weather.gov',
      '/api/noaa',
    )
    const forecastRes = await fetch(proxiedForecast, {
      signal,
      headers: { Accept: 'application/geo+json' },
    })
    if (!forecastRes.ok) throw new Error(`forecast HTTP ${forecastRes.status}`)
    const forecast = (await forecastRes.json()) as ForecastResponse
    const periods = forecast.properties?.periods ?? []
    const daytime = periods.filter((p) => p.isDaytime && typeof p.temperature === 'number')
    const highs = daytime.map((p) => {
      const t = p.temperature as number
      return p.temperatureUnit === 'C' ? (t * 9) / 5 + 32 : t
    })
    if (highs.length === 0) throw new Error('No daytime highs')

    const maxHigh = Math.max(...highs)
    const fairProb = fairFromForecastHigh(
      maxHigh,
      hint.thresholdF,
      hint.direction === 'unknown' ? 'above' : hint.direction,
    )
    const city = CITY_COORDS[hint.cityKey]?.label ?? hint.cityKey

    return {
      fairProb,
      cityKey: hint.cityKey,
      forecastHighF: maxHigh,
      detail: `NWS ${city}: next highs max ${maxHigh.toFixed(0)}°F vs threshold ${hint.thresholdF}°F → P≈${(fairProb * 100).toFixed(0)}%`,
    }
  } catch {
    return null
  }
}

/** Offline / demo climatology prior when live NOAA is unavailable. */
export function demoClimatologyFair(hint: WeatherMarketHint, monthHint?: number): NoaaFairEstimate | null {
  if (hint.thresholdF === undefined) return null
  const month = monthHint ?? new Date().getMonth() + 1
  // Very rough seasonal typical highs (°F) by city
  const typical: Record<string, number[]> = {
    nyc: [38, 40, 48, 60, 70, 79, 84, 82, 75, 64, 53, 43],
    chicago: [30, 34, 46, 58, 70, 80, 84, 82, 75, 62, 48, 35],
    miami: [76, 78, 80, 83, 86, 89, 90, 90, 88, 85, 81, 77],
    denver: [44, 46, 54, 61, 71, 82, 88, 86, 78, 65, 52, 45],
    seattle: [46, 49, 53, 58, 64, 70, 75, 75, 69, 59, 50, 45],
    boston: [36, 38, 45, 56, 66, 76, 81, 79, 72, 61, 51, 41],
    'los angeles': [68, 68, 70, 72, 74, 78, 83, 84, 82, 78, 72, 68],
    la: [68, 68, 70, 72, 74, 78, 83, 84, 82, 78, 72, 68],
    houston: [62, 66, 72, 78, 85, 90, 93, 93, 88, 81, 71, 64],
    dallas: [56, 61, 68, 76, 83, 91, 95, 95, 88, 78, 66, 57],
    atlanta: [52, 56, 64, 72, 79, 86, 89, 88, 82, 73, 63, 54],
    phoenix: [67, 71, 77, 85, 94, 103, 105, 103, 98, 88, 75, 66],
    'new york': [38, 40, 48, 60, 70, 79, 84, 82, 75, 64, 53, 43],
  }
  const series = typical[hint.cityKey] ?? typical.nyc
  const expected = series[clamp(month, 1, 12) - 1] ?? 70
  const fairProb = fairFromForecastHigh(
    expected,
    hint.thresholdF,
    hint.direction === 'unknown' ? 'above' : hint.direction,
  )
  return {
    fairProb,
    cityKey: hint.cityKey,
    forecastHighF: expected,
    detail: `Climatology prior (${hint.cityKey} month ${month}): typical high ~${expected}°F vs ${hint.thresholdF}°F → P≈${(fairProb * 100).toFixed(0)}% (weak if not live NWS)`,
  }
}

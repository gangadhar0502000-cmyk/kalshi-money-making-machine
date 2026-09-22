import { useMemo } from 'react'
import { V1App } from './v1/V1App'
import { LegacyApp } from './v1/LegacyApp'

function wantsLegacy(): boolean {
  if (typeof window === 'undefined') return false
  const q = new URLSearchParams(window.location.search)
  if (q.get('legacy') === '1') return true
  if (window.location.hash.replace(/^#/, '') === 'legacy') return true
  return false
}

/** Default: clean v1 feed. Legacy Lab only via ?legacy=1 or #legacy. */
export default function App() {
  const legacy = useMemo(() => wantsLegacy(), [])
  return legacy ? <LegacyApp /> : <V1App />
}

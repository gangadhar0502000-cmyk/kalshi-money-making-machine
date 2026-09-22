/**
 * Quoting park badge labels for paper MM scan table.
 * Sanity always beats mid fb when FV exists with |edge| > maxSane.
 */

export function parkStatusLabel(opts: {
  bidReason?: string
  askReason?: string
  centerMode?: 'fv' | 'mid' | null
  edgeCents?: number | null
  fairValue?: number | null
  maxSaneEdgeCents?: number
}): string {
  const br = (opts.bidReason ?? '').toLowerCase()
  const ar = (opts.askReason ?? '').toLowerCase()
  const both = `${br} ${ar}`
  const maxSane = opts.maxSaneEdgeCents ?? 25
  const edge = opts.edgeCents
  const fv = opts.fairValue
  if (
    both.includes('edge sanity') ||
    (fv != null && edge != null && Math.abs(edge) > maxSane)
  ) {
    return 'sanity'
  }
  if (both.includes('max inventory')) return 'max inv'
  if (both.includes('unwind-only')) return 'unwind hold'
  if (both.includes('no edge')) return 'no edge'
  if (both.includes('toxic')) return 'toxic'
  if (both.includes('expiry')) return 'expiry'
  if (both.includes('no fv')) return 'no FV'
  // Mid fb only when FV genuinely unavailable — never for insane FV edge.
  if (opts.centerMode === 'mid' && fv == null) return 'mid fb'
  const frag =
    (!br.includes('on:') && (opts.bidReason ?? '')) ||
    (!ar.includes('on:') && (opts.askReason ?? '')) ||
    'parked'
  return frag.length > 18 ? frag.slice(0, 16) + '…' : frag
}

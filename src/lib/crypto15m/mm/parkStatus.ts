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
  if (both.includes('close blocked')) return 'close blk'
  if (both.includes('hard flat')) return 'hard flat'
  if (both.includes('no edge')) return 'no edge'
  if (both.includes('edge flicker') || both.includes('flicker')) return 'flicker'
  if (both.includes('clamp killed edge')) return 'clamp killed'
  if (both.includes('one-sided')) return 'one-sided'
  if (both.includes('extreme mid') || both.includes('u3.1.1') || both.includes('no new long') || both.includes('no new short')) return 'extreme mid'
  if (both.includes('blackout flatten') || both.includes('u3.1.2')) return 'bo flatten'
  if (both.includes('flatten') && (both.includes('exit only') || both.includes('reduce'))) return 'flatten'
  if (both.includes('blackout') || both.includes('settlement blackout')) return 'blackout'
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

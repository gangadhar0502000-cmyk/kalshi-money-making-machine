/**
 * U2.7 — pure helpers for the open-markets rail (MM highlight / sort).
 * Paper-only · Apple-clean · no quoting logic here.
 */
import type { Crypto15mMarket } from '../types/crypto15m'

/**
 * When MM is quoting, float quoted books to the top.
 * Stable within each group (preserves existing feed order).
 * Empty quoted set → return markets unchanged.
 */
export function sortMarketsForRail<T extends { ticker: string }>(
  markets: readonly T[],
  quotedTickers: ReadonlySet<string>,
): T[] {
  if (quotedTickers.size === 0 || markets.length === 0) {
    return markets.slice()
  }
  const quoted: T[] = []
  const rest: T[] = []
  for (const m of markets) {
    if (quotedTickers.has(m.ticker)) quoted.push(m)
    else rest.push(m)
  }
  return quoted.length === 0 ? markets.slice() : [...quoted, ...rest]
}

/** Signed inventory label for a quiet tertiary MM hint (`Inv +2` / `Inv −1` / `Inv 0`). */
export function fmtMmInvHint(inventory: number): string {
  if (!Number.isFinite(inventory)) return 'Inv —'
  if (inventory > 0) return `Inv +${inventory}`
  if (inventory < 0) return `Inv ${inventory}`
  return 'Inv 0'
}

export type RailMarket = Pick<Crypto15mMarket, 'ticker'>

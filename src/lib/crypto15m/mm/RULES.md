# Paper 15m MM playbook (RULES)

**PAPER ONLY.** Read-only research sim — never places live Kalshi orders. Green paper P&L ≠ live edge.

## U3.2 — House rules v1 (primary)

**Mid-centered maker** — quote around **book mid**, not digital FV. Not Family E FV opens, not S1–S5, not complete-set yet. User rejected FV–mid mismatch / gap trading as the target.

- **Center:** reservation `r = mid − skew(q,τ)`; posts `r ± halfSpread` with inventory skew (same skew helpers as before). Maker-only BBO join when L2 present.
- **FV:** may still be computed for UI/telemetry — **must not** center `yesBid`/`yesAsk` or rank/select by `|FV−mid|`.
- **Hard τ:**
  - **Blackout (flat):** `minutesRemaining ≤ blackoutMinutes` (default **0.75**) and `q === 0` → both OFF, `U3.1: settlement blackout`.
  - **Blackout flatten (U3.1.2):** same τ window but `q ≠ 0` → flatten-only (long → ask; short → bid), tag `blackout_flatten`, strip `U3.1.2: blackout flatten — exit only`.
  - **Flatten:** `minutesRemaining ≤ hardFlatMinutes` (default **2**) and `q ≠ 0` → only reducing side ON.
- **Hard Q:** `|q| ≥ maxInventory` → withdraw the adding side.
- **Fills:** U2.13 L2 queue fills only when live book; no soft fills when L2 off.
- **Invalid mid:** park fail-loud `U3.2: no mid — needs two-sided book`.
- **Tags:** `house_mid` / `flatten` / `blackout` / `blackout_flatten` / `extreme_mid` — **not** S1–S5.
- **Strip:** `U3.2: house mid quotes` when mid-centered opens are armed.
- **Ranking (U3.2):** prefer L2 / mid quality / tighter spread — **not** larger `|FV−mid|` (`U3.2: rank by L2 / mid quality — not |FV−mid|`).

Config: `quotingEnabled: true` (default for new sessions / v1 Start). Headless may stay stopped with `quotingEnabled: false` — when re-enabled, house mid applies. Set `false` to restore U3.0 pause strip.

## U3.1.1 — refuse opens at extreme mid (retained)

Pinned books near **0¢ / 100¢** must not open new risk.

- **No new longs** (`buy_yes`) when `mid ≥ toxicMidHigh` (default 0.95).
- **No new shorts** (`sell_yes`) when `mid ≤ toxicMidLow` (default 0.05).
- Same gate on quote arms (`decideQuoteSides`) and fill accept (`isToxicExtremeMid` / `applyFill`).
- **Flatten/reduce** still allowed when inventory ≠ 0 and the side reduces.
- Flat + extreme mid → park both with `U3.1.1: extreme mid — no new opens`.

## U3.1.2 — blackout flatten when inventory (retained)

Settlement blackout must not trap open inventory. In the last `blackoutMinutes`:

- **Flat** → park both (unchanged).
- **Long / short** → flatten-only via side arms; U3.1.1 extreme-mid still refuses *opens*; reduce side stays allowed.
- Settled / `mins ≤ 0` settlement path unchanged.

## Slot ops (not quote scenarios)

- **SLOT_EVICT** — legacy sanity+|FV−mid| eviction is **off** under U3.2 (FV gap is telemetry only).
- **L2_OFF_EVICT (U2.14 / U2.14.1)** — `useLiveBook && !liveBook` for `l2OffDropTicks` consecutive syncs + flat → drop & refill; open inventory holds with `U2.14: L2 off — holding inv until flat`.

## Scarcity / caps (unchanged intent)

- Per-ticker + portfolio rolling fill caps.
- Maker-only under strict; `fillMidFallback: false` under strict.

## Journal / digests

Optional `scenarioId` on fills may be plain house tags or historical S* digests — **never** drives quotes via S1–S5 gates.

## Retired (not primary)

- **Family E** digital-FV-centered opens (U3.1) — superseded by U3.2 house mid.
- FV–mid mismatch / gap trading — explicitly rejected as product target.
- Complete-set complementary bids — not in this slice.

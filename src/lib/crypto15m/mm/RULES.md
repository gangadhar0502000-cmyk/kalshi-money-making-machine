# Paper 15m MM playbook (RULES)

**PAPER ONLY.** Read-only research sim — never places live Kalshi orders. Green paper P&L ≠ live edge.

## U3.1 — Family E quote logic

**Family E — Digital FV + inventory skew + hard τ-flatten** (research brief `docs/research/U3_QUOTE_LOGIC_RESEARCH.md` §9 Family E; LAS [0,1] clamp insight).

- **FV:** risk-neutral ITM ≈ `N(d₂)` digital/cash-or-nothing from spot `S`, strike `K`, τ, vol `σ` (`annualVol` default **0.70** ≈ 70% annualized crypto prior). Fail-loud without spot/strike/τ: `U3.1: … — needs …`.
- **Reservation:** `r = FV − skew(q,τ)` with AS-style skew that grows with inventory and as τ→0 (`tauSkewAccel`).
- **Quotes:** bid/ask around `r` with config half-spread; clamp to `(ε, 1−ε)` (`quoteClampEpsilon` default 0.01); maker-only join when L2 BBO present.
- **Hard τ:**
  - **Blackout:** `minutesRemaining ≤ blackoutMinutes` (default **0.75**) → both OFF, `U3.1: settlement blackout`.
  - **Flatten:** `minutesRemaining ≤ hardFlatMinutes` (default **2**) and `q ≠ 0` → only reducing side ON.
- **Hard Q:** `|q| ≥ maxInventory` → withdraw the adding side (Guéant-style).
- **Fills:** U2.13 L2 queue fills only when live book; no soft fills when L2 off.
- **Tags:** optional `open` / `flatten` / `blackout` — **not** S1–S5.

Config: `quotingEnabled: true` (default for new sessions / v1 Start / headless). Set `false` to restore U3.0 pause strip. Do **not** resurrect S1–S5.

## Slot ops (not quote scenarios)

- **SLOT_EVICT** — sanity-parked + flat inventory → free an active slot for the next candidate.
- **L2_OFF_EVICT (U2.14 / U2.14.1)** — `useLiveBook && !liveBook` for `l2OffDropTicks` consecutive syncs + flat → drop & refill; open inventory holds with `U2.14: L2 off — holding inv until flat`.

## Scarcity / caps (unchanged intent)

- Per-ticker + portfolio rolling fill caps.
- Maker-only under strict; `fillMidFallback: false` under strict.

## Journal / digests

Optional `scenarioId` on fills may be plain Family E tags or historical S* digests — **never** drives quotes via S1–S5 gates.

# Paper 15m MM playbook (RULES)

**PAPER ONLY.** Read-only research sim — never places live Kalshi orders. Green paper P&L ≠ live edge.

## U3.0 — quoting paused

**Quoting is paused (U3.0).** The S1–S5 scenario playbook (and S4.1 / S4.2 / S5.1 *scenario naming* as the quote decision system) has been **removed**. Engines may still Run for feed / L2 / inventory observability, but **no paper quotes arm** and **no quote-matching fills** until the user defines new quote logic (`quotingEnabled` + replacement path).

Config: `quotingEnabled: false` (default). Do not resurrect S1–S5.

## Slot ops (not quote scenarios)

- **SLOT_EVICT** — sanity-parked + flat inventory → free an active slot for the next candidate.
- **L2_OFF_EVICT (U2.14 / U2.14.1)** — `useLiveBook && !liveBook` for `l2OffDropTicks` consecutive syncs + flat → drop & refill; open inventory holds with `U2.14: L2 off — holding inv until flat`.

## Scarcity / caps (unchanged intent)

- Per-ticker + portfolio rolling fill caps.
- Maker-only under strict; `fillMidFallback: false` under strict.
- Fail-loud strip while paused: `U3.0: paper quoting paused — needs new quote logic`.

## Journal / digests

Optional `scenarioId` on old journal fills may remain for historical digests — **never** drives quotes.

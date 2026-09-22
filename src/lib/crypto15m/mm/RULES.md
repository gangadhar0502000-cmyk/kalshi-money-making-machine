# Paper 15m MM playbook (RULES)

**PAPER ONLY.** Read-only research sim — never places live Kalshi orders. Green paper P&L ≠ live edge. Scarce fills, churn filter, and portfolio caps stay on.

Default stance: **S5 NO_TRADE** (both sides OFF). A side turns ON only under a named scenario below.

## Scenario table

| ID | Name | Action | When (machine knobs) |
|----|------|--------|----------------------|
| **S1** | `OPEN_BID` | Quote **bid only** | `FV − mid ≥ openMinEdgeCents` (4¢); after maker clamp `FV − bid ≥ minCaptureCents` (1.5¢); edge persisted `edgePersistTicks`; `minutesRemaining ≥ hardFlatMinutes` (2); inventory allows add; sanity OK (`\|edge\| ≤ maxSaneEdgeCents`). |
| **S2** | `OPEN_ASK` | Quote **ask only** | `mid − FV ≥ openMinEdgeCents`; after clamp `ask − FV ≥ minCaptureCents`; same persist / hard-flat / inventory / sanity guards. |
| **S3** | `CLOSE_PROFIT` | Reducing quote/fill | Capture vs `avgEntry` ≥ `minCloseProfitCents` (**1.0¢**). Main fix for −0.88¢/fill unwind churn. Reason: `ask ON: S3 CLOSE_PROFIT +1.2¢`. |
| **S4** | `CLOSE_RISK` | Forced flatten | May close **without** profit only if: `minutesRemaining < hardFlatMinutes` **OR** `\|inventory\| ≥ maxInventory` **OR** spot-guard cancel / extreme widen **OR** toxic mid on holding side. Reason **must** include `risk flat`. |
| **S4.1** | `STUCK_UNWIND` | Break-even reduce | After `stuckUnwindTicks` (default **30**, ~45–60s) consecutive S3 profit-bar blocks, allow reduce at capture **≥ 0¢** vs avgEntry. Reason **must** include `S4.1 STUCK_UNWIND`. Never voluntary −¢. Risk-flat family for UI. |
| **S5** | `NO_TRADE` | Both OFF | Everything else. Includes `CLOSE blocked: capture 0.3¢ < 1¢`. |
| **S5.1** | `SLOT_EVICT` | Free active slot | Sanity-parked (`|FV−mid| > maxSaneEdgeCents` or reason has edge sanity) **and** flat inventory → **evict** from `maxActiveMarkets` set so next |FV−mid| candidate can enter. Do **not** evict if inventory ≠ 0 (needs unwind). |

## Explicitly NOT profitable (must refuse)

1. **Open then unwind at ≤0 capture** — churn loss (screenshot-style −0.88¢/fill). Blocked unless S4. S4.1 may allow **exactly ≥0¢** after stuck ticks — still blocks −¢.
2. **Quote both sides into a one-sided edge** — one-sided discipline; favored side only.
3. **Mid-fallback when FV insane** — park on edge sanity; never spam mid-centered opens.
4. **Open with edge < openMin after clamp** — `clamp killed edge` / open min gate.

## Scarcity / caps (unchanged intent)

- Per-ticker + portfolio rolling fill caps (`maxFillsPerMarketPer15m`, `maxFillsPerMinute`, portfolio 15m cap).
- Maker-only (no taker_cross under strict).
- `fillMidFallback: false` under strict — empty slots beat no-FV books.

## Reason string examples

- `bid ON: S1 OPEN_BID +4.2¢`
- `ask OFF: S5 NO_TRADE`
- `CLOSE blocked: capture 0.3¢ < 1¢`
- `ask ON: S4 CLOSE_RISK risk flat`
- `ask ON: S4.1 STUCK_UNWIND +0.0¢`
- `Slot released (BNB) — S5.1 SLOT_EVICT sanity+flat; …`

## Config defaults (strict paper)

| Knob | Default |
|------|---------|
| `openMinEdgeCents` | 4 |
| `minCaptureCents` | 1.5 |
| `minCloseProfitCents` / `minChurnCaptureCents` | 1.0 |
| `hardFlatMinutes` | 2 |
| `edgePersistTicks` | 3 |
| `maxSaneEdgeCents` | 25 |
| `stuckUnwindTicks` | 30 |

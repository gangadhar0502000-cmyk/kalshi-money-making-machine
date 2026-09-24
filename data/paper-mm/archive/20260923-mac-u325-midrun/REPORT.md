# Mac U3.2.5 mid-run forensic (2026-09-23 ~20:52 CT)

**HEAD on Mac:** `1db2adf` (U3.2.5 — raise `longOpenMinMid` 0.40→0.50)  
**Session window CT:** 20:14:36 → ~20:47:21 (meta `startedAt` 2026-09-24T01:14:36.184Z)  
**Source:** Mac disk `ui-journal.jsonl` + `ui-run-meta.json` (paper only; no browser).  
**Do not push / do not ship from this dig.**

## Headline

| Field | Value |
|-------|-------|
| Fills | **28** (matches UI) |
| Realized | **−$1.26** (sum fill `realizedDelta`) |
| UI cash / mark | ~$98.67 / MARK ≈ −$1.24 |
| Closed RTs | 12 (6W +$1.17 / 6L −$2.43) |
| Still open | SHORT HYPE@31¢, SHORT SOL@34¢, **LONG ETH** (open mid **43.5¢**), **LONG BTC** (open mid **47.5¢**) |

## Verdict: curb NOT at 0.50 at runtime

Source default is 0.50 and `applyFill` / `decisionPolicy` gates exist. **Runtime still behaved like `longOpenMinMid=0.40`.**

Evidence:

- **4 NEW long YES opens with mid ≤ 0.50** (should be ZERO under U3.2.5): ETH 0.485, XRP 0.405, ETH 0.435, BTC 0.475 — all `taker_cross` / `house_mid`.
- **0 opens with mid ≤ 0.40** → the **0.40 curb was live**; the **0.50 raise was not**.
- All four sit in **(0.40, 0.50]** — exactly the band U3.2.5 was meant to close after U3.2.4’s ZEC/BTC mid>40¢ bleed.

Root cause (config path, not mid-drop-at-open for these four):

1. **`migratePersistedScarcityConfig` only fills `longOpenMinMid` when missing** — does **not** `Math.max` lift a persisted **0.40** to STRICT **0.50**.
2. **Start/Resume can omit forcing the new floor**, so localStorage from U3.2.3/4 keeps 0.40 after the U3.2.5 commit (session started ~2.5m after commit 20:11 CT).

Current UI LONG ETH@~25¢ / BTC@~34¢ = opened at 43.5¢/47.5¢ under stale 0.40 curb, **then mid dropped** (mark bleed). Not “opened already at 25/34.”

## Top losses (completed)

| Asset | Open mid/px | Exit mid/px | $ | Why |
|-------|-------------|-------------|---|-----|
| SOL | 0.565 / 0.57 | 0.017 / 0.01 | −0.556 | late τ flatten |
| SOL | 0.545 / 0.55 | 0.011 / 0.01 | −0.537 | late τ flatten |
| XRP | 0.585 / 0.59 | 0.076 / 0.07 | −0.517 | late τ flatten |
| XRP | 0.405 / 0.41 | 0.009 / 0.01 | −0.400 | low-mid long + flatten |
| NEAR | 0.72 / 0.72 short | 0.973 / 0.98 | −0.260 | cover cold @ flatten |

## Top wins

| Asset | Kind | Open mid | Exit | $ |
|-------|------|----------|------|---|
| ZEC | short cover | 0.555 | 0.075 | +0.520 |
| BNB | short cover | 0.921 | 0.695 | +0.240 |
| ETH | long flatten | 0.485 | 0.695 | +0.200 |
| HYPE | short cover | 0.580 | 0.435 | +0.140 |
| HYPE | long cover | 0.520 | 0.560 | +0.050 |

## Dollar attribution

| Bucket | n | $ |
|--------|---|---|
| late τ flatten bleed (long open mid>0.50) | 4 | **−$1.770** |
| low-mid long flatten bleed (open mid≤0.50) | 1 | −$0.400 |
| cover cold / short loss | 1 | −$0.260 |
| short wins | 4 | +$0.920 |
| long wins | 2 | +$0.250 |
| **Net** | | **−$1.260** |

Dominant closed bleed this hour: **hardFlat dump on longs that went to ~1¢**, not only the 40–50¢ opens. Shorts still paid (+$0.92).

## vs prior archives (brief)

| Dig | Realized | Note |
|-----|----------|------|
| u322 | +$5.67 | pre-curb; many low-mid longs |
| u323 | ~+$3 | curb 0.40 working; 0 low-mid |
| u324 | ~+$0.01 | mid>40¢ long flatten bleed → motivated U3.2.5 |
| **u325** | **−$1.26** | intended 0.50 curb **not applied** (persist 0.40) + same flatten-long family |

## One U3.2.6 recommendation (do not implement here)

1. **Must-fix (bug):** In `migratePersistedScarcityConfig`, lift `longOpenMinMid` with `Math.max(stored, STRICT 0.50)` (same pattern as `openMinEdgeCents`); ensure Start applies STRICT floor even if Start payload omits the key. Clears the 40–50¢ long opens.
2. **Tape-dominant bleed:** Add **soft-exit / early reduce before hardFlat** on underwater longs (e.g. markBleed or mid falling) so SOL/XRP-style −50¢ flatten dumps shrink. Soft-exit is the larger $ lever this session (−$1.77 late flatten vs −$0.40 low-mid).

Prefer (1) first so U3.2.5 intent is actually live; then (2) as the next small slice.

## Artifacts

- `data/paper-mm/archive/20260923-mac-u325-midrun/ui-journal.jsonl`
- `data/paper-mm/archive/20260923-mac-u325-midrun/ui-run-meta.json`
- `data/paper-mm/archive/20260923-mac-u325-midrun/REPORT.md`
- Working copy: `data/paper-mm/audit-u325-now/`
- INDEX: `data/paper-mm/archive/INDEX.md` (append-only note)

PAPER ONLY. No push. No code shipped.

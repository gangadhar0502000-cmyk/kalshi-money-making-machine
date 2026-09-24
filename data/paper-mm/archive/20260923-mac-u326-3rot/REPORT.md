# U3.2.6 Mac paper session — three rotations

- **HEAD:** `23543f1` U3.2.6
- **Session:** ~44.4 min / 3×15m rotations
- **Results:** 36 fills, realized **+$5.202**, 17W/1L
- **Long-open curb:** 0 new longs with mid≤0.50 (curb OK)
- **House soft exit:** 1 — BTC long 0.56→0.14 (−$0.42) at τ~7m

## Fill reasons

| Reason | Fills |
|---|---:|
| book_depth | 16 |
| taker_cross | 16 |
| mid_walk | 4 |
| random | 0 |

## Realism flag

Several cover/flatten buys at px≈0 with mid≈0.98–0.99 (HYPE/SOL/NEAR/DOGE) indicate a realism hole under loose `allowMidWalk`/`fillMidFallback`. User wants no fake fills; this behavior needs to be closed before relying on these paper results.

## Comparison

Vs U3.2.5 midrun: 28 fills, −$1.26.

**PAPER ONLY.**

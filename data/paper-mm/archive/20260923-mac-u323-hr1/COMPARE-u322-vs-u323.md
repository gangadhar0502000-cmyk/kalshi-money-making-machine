# COMPARE — U3.2.1/2 hour vs U3.2.3 hour (Mac paper MM)

**Written:** 2026-09-23 19:33:04 CT
**Source:** disk-only forensic (no browser, no code changes).
**Archives:**
- Prior (U3.2.1/2): `data/paper-mm/archive/20260923-mac-u322-dig/` — ~4:58–6:01 CT, 50 fills, +$5.672
- This (U3.2.3): `data/paper-mm/archive/20260923-mac-u323-hr1/` — ~6:26–7:28 CT, 52 fills, +$2.981

Caveat: hour1 rules ≠ hour2 rules. Path-dependent markets; do not treat Δrealized as pure A/B of the rule change.

---

## This hour (U3.2.3)

- **Window:** 2026-09-23 18:26:48.108 CT → 2026-09-23 19:28:00.992 CT (first fill 2026-09-23 18:26:54.323 CT)
- **Fills:** 52
- **Realized (UI / FIFO RT):** **$2.981** (matches ui_session_snapshot fills=52 cash flat)
- **Sum fill.realizedDelta:** $3.460 — inflated by settlement quirk (DOGE settlement fill#12 stamped rd=0 while FIFO close = −$0.479)
- **Closed RTs:** 19W / 6L / 1F
- **Win $ / Loss $:** $4.990 / $-2.009
- **Flatten-closed loss $:** $-1.530 (flatten fill Σrd $-0.090)
- **Cover/close wins:** 16 for $3.550 (`house_cover`)
- **Tag mix:** `{'house_mid': 27, 'flatten': 8, 'house_cover': 17}`
- **Fill reasons:** `{'mid_walk': 9, 'taker_cross': 23, 'book_depth': 19, 'settlement': 1}`
- **Late opens (ml≤hardFlat=2, |inv|↑):** 0
- **Late opens (ml<5 def, for vs prior report):** 4
- **Low-mid long opens (mid≤0.40 NEW long):** 0
- **Leftover S3 tags:** 0
- **Blackout fills:** 0
- **Open lots at end:** 0 (fully flat; end inv all 0)

### Top why-win
- ETH short 0.76→0 **$+0.760** close=`house_cover` open=`house_mid`
- BTC short 0.74→0.05 **$+0.690** close=`flatten` open=`house_mid`
- ZEC short 0.53→0.01 **$+0.520** close=`house_cover` open=`house_mid`
- NEAR short 0.61→0.09 **$+0.520** close=`house_cover` open=`house_mid`
- DOGE short 0.57→0.08 **$+0.490** close=`flatten` open=`house_mid`

### Top why-lose
- DOGE long 0.48→0.001 **$-0.479** close=`house_mid` open=`house_mid` open_mid=0.48
- HYPE short 0.14→0.56 **$-0.420** close=`flatten` open=`house_mid` open_mid=0.15500000000000003
- HYPE long 0.84→0.42 **$-0.420** close=`flatten` open=`house_mid` open_mid=0.84
- ETH long 0.67→0.32 **$-0.350** close=`flatten` open=`house_mid` open_mid=0.665
- HYPE short 0.58→0.75 **$-0.170** close=`flatten` open=`house_mid` open_mid=0.585

---

## Prior hour (U3.2.1/2)

- **Window:** ~4:58–6:01 CT Sep 23 2026
- **Fills:** 50
- **Realized:** **+$5.672** (UI matched)
- **Closed RTs:** 16W / 7L / 0F
- **Win $ / Loss $:** $7.270 / $-1.598
- **Flatten-closed loss $:** $-1.598
- **Cover/close wins:** 15 for $7.190 (`S3`)
- **Tag mix:** `house_mid` 27 / `S3` 15 / `flatten` 8
- **Late opens (ml≤2):** 1; **(ml<5):** 2
- **Low-mid long opens (mid≤0.40):** 10
- **Open lots at end of prior dig:** 4 (BTC/SOL/BNB/DOGE) — not carried into this-hour filter

---

## Diff (this − prior)

| Metric | Prior U3.2.1/2 | This U3.2.3 | Δ |
|---|---:|---:|---:|
| Fills | 50 | 52 | +2 |
| Realized $ | 5.672 | 2.981 | -2.691 |
| RT wins | 16 | 19 | +3 |
| RT losses | 7 | 6 | -1 |
| Win $ | 7.270 | 4.990 | -2.280 |
| Loss $ | -1.598 | -2.009 | -0.411 |
| Flatten loss $ | -1.598 | -1.530 | +0.068 |
| Cover/win engine $ | 7.190 (15) | 3.550 (16) | -3.640 |
| Late opens ml≤2 | 1 | 0 | -1 |
| Late opens ml<5 | 2 | 4 | +2 |
| Low-mid long opens | 10 | 0 | -10 |
| S3 tags | 15 | 0 | -15 |
| house_cover tags | 0 | 17 | +17 |

### Diff bullets

1. **Did U3.2.3 reduce loser longs / late opens?** **YES on both primary gates.** Low-mid NEW longs: **10 → 0**. Late opens ml≤hardFlat(2): **1 → 0**. (Note: ml<5 |inv|↑ opens rose 2→4 — activity still happens in the 2–5m band; the U3.2.3 hardFlat park only bites ≤2m when flat.)
2. **Did it keep short→cover edge?** **YES, count-wise.** Cover/close wins 15→16; tag rename S3→`house_cover` clean (0 leftover S3). Dollar cover edge smaller this hour ($7.19→$3.55) — market path (fewer near-0/1 jackpots), not a missing cover path.
3. **Fewer fills = better or worse?** Fill count **not fewer** (50→52). Realized **worse** (+$5.67→+$2.98). So “fewer fills” is **not** the story; **composition** improved (no low-mid long bleed, no ≤2m late opens) while cover $ ran colder and flatten still ate ~$1.5.
4. **Flatten sink unchanged:** flatten-closed losses $-1.598→$-1.530. U3.2.3 did not fix flatten dump economics.
5. **Tag hygiene:** house_mid 27→27; flatten 8→8; S3 15→0 replaced by house_cover 17.

---

## Combined 2hr

**Headline:** Across ~2 paper hours (different rules), **102 fills**, realized **$8.653**, closed RTs **35W / 13L**, win $ **$12.260**, loss $ **$-3.607**, net closed RT **$8.653**.

| | Hour1 U322 | Hour2 U323 | Combined |
|---|---:|---:|---:|
| Fills | 50 | 52 | 102 |
| Realized $ | 5.672 | 2.981 | 8.653 |
| Wins / Losses | 16/7 | 19/6 | 35/13 |
| Win $ | 7.270 | 4.990 | 12.260 |
| Loss $ | -1.598 | -2.009 | -3.607 |

- **Open lots at end of hour2 only:** 0 (flat). Prior hour ended with 4 open lots; those are **not** in this combined open count (separate session reset at 6:26pm CT).
- **Caveats:** Hour1 = U3.2.1/2 (S3 covers, allowed low-mid longs + some late opens). Hour2 = U3.2.3 (no ≤2m late opens when flat, no mid≤0.40 NEW longs, `house_cover` tags). Do not average into one rule verdict without the Diff section.
- Settlement quirk in hour2: one DOGE `settlement` fill closed inventory at 0.001 with `realizedDelta=0`; FIFO/UI use −$0.479 in the $2.981 figure.

---

## Evidence for next rules

1. **Keep U3.2.3 late-open park (ml≤2 flat→both OFF)** — tape shows 0 violations; prior had 1 under same def.
2. **Keep low-mid long curb (mid≤0.40)** — 10→0 NEW low-mid longs; this was the clearest structural win vs the prior hour’s flatten-long bleed.
3. **Keep `house_cover` rename** — 0 leftover S3; cover path still prints (17 house_cover fills, 16 cover wins).
4. **Flatten still the PnL sink (~−$1.5 both hours)** — next lever is flatten timing/price (avoid 1¢ dumps when capture ≪ −20¢), not more open curbs.
5. **2–5m band still active** — ml<5 |inv|↑ opens rose to 4; if those prove toxic, consider extending no-open park from 2→3–4m (evidence-gated), not jumping to 5 blindly.
6. **Settlement accounting** — stamp settlement closes into `realizedDelta` (or exclude from FIFO dig consistently); hour2 sum_rd $3.46 vs UI $2.981 is otherwise confusing.
7. **Do not chase fill-count reduction as a KPI** — 52 vs 50 fills with better composition still printed +$2.98; cold cover path, not overtrading, drove the Δ vs +$5.67.

---

PAPER ONLY. Prior archive `20260923-mac-u322-dig/` untouched.

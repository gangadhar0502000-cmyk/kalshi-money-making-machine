# Paper MM tape archive (append-only)

Durable copies of digests / dig sessions. **Never delete** without an explicit user ask.
Live runtime journals under `data/paper-mm/` (ui-journal.jsonl, journal.jsonl) may be gitignored; **archive copies here are committed**.

## Sessions

| Folder | CT window (approx) | Notes |
|--------|--------------------|--------|
| `20260923-mac-u322-dig/` | ~4:58–6:01 CT Sep 23 2026 | Mac UI disk tape dig — 50 fills, +$5.67; evidence for U3.2.3 (late opens + low-mid long bleed). Copies of fills CSV, report, journal JSONL, meta. |
| `20260923-mac-u323-hr1/` | ~6:26–7:28 CT Sep 23 2026 | Mac U3.2.3 hour1 dig — 52 fills, +$2.981 UI/FIFO; 0 late≤2m, 0 low-mid longs, 0 S3 (house_cover). COMPARE-u322-vs-u323.md + fills CSV + report. |
| `20260923-mac-u324-midrun/` | ~7:40–8:05 CT Sep 23 2026 | Mac U3.2.4 mid-run dig — 34 fills, +$0.014 FIFO/UI; 0 late≤4m, 0 low-mid longs; cover still on; red feel = flatten-long bleed mid>40¢ (ZEC/BTC) not noOpen=4. Report + fills CSV + dig-stats. |
| `20260923-mac-u325-midrun/` | ~20:14–20:47 CT Sep 23 2026 | Mac U3.2.5 midrun — 28 fills, −$1.26; runtime curb still 0.40 (migrate skip + Start omit); 4 longs mid in (0.40,0.50]; soft-exit before hardFlat next. REPORT.md + journal + meta. |
| `20260923-mac-u326-3rot/` | ~44.4 min / 3×15m rotations Sep 23 2026 | Mac U3.2.6 paper session — 36 fills, +$5.202 realized, 17W/1L; 0 new longs with mid≤0.50; realism flag on px≈0 cover/flatten buys at mid≈0.98–0.99. |
| `20260924-mac-u328-midrun/` | ~22:26 CT Sep 23 → 15:04 CT Sep 24 2026 | Mac U3.2.8 mid-run urgent archive — **83 session fills** / 319 cumulative in journal; CASH $97.44, REALIZED −$1.2675; HEAD 1b14132; live journals left intact. |

PAPER ONLY.

## 20260923-mac-u325-midrun (U3.2.5 mid-run forensic)
- Copied: 2026-09-23 ~20:52 CT from Mac machine 87ba847f
- HEAD on Mac: 1db2adf (U3.2.5 longOpenMinMid 0.40→0.50)
- sessionStart (meta): 2026-09-24T01:14:36.184Z ≈ 2026-09-23 20:14:36 CDT
- UI claim at dig: ~35m run, CASH $98.67, REALIZED -$1.26, MARK -$1.24, 28 fills
- Active books claimed: LONG ETH @ mid 25¢, LONG BTC @ mid 34¢
- Purpose: diagnose how longs opened under curb; round-trip attribution; U3.2.6 slice


## 20260924-mac-u328-midrun (U3.2.8 mid-run urgent archive)
- Copied: 2026-09-24 ~15:05 CT from Mac machine 87ba847f (read-only copy; UI NOT reset)
- HEAD on Mac: 1b14132 (U3.2.8 usable strict L2)
- sessionStart (meta): 2026-09-24T03:26:03.793Z ≈ 2026-09-23 22:26:03 CT
- UI claim at archive: fills=83; CASH $97.44; REALIZED −$1.2675; inventory=1
- Journal: 262680 bytes / 755 lines; session fills 83 vs cumulative fills 319 in file
- Purpose: urgent append-only pull — user said data being lost

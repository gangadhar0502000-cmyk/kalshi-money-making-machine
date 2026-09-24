# Paper MM tape archive (append-only)

Durable copies of digests / dig sessions. **Never delete** without an explicit user ask.
Live runtime journals under `data/paper-mm/` (ui-journal.jsonl, journal.jsonl) may be gitignored; **archive copies here are committed**.

## Sessions

| Folder | CT window (approx) | Notes |
|--------|--------------------|--------|
| `20260923-mac-u322-dig/` | ~4:58–6:01 CT Sep 23 2026 | Mac UI disk tape dig — 50 fills, +$5.67; evidence for U3.2.3 (late opens + low-mid long bleed). Copies of fills CSV, report, journal JSONL, meta. |
| `20260923-mac-u323-hr1/` | ~6:26–7:28 CT Sep 23 2026 | Mac U3.2.3 hour1 dig — 52 fills, +$2.981 UI/FIFO; 0 late≤2m, 0 low-mid longs, 0 S3 (house_cover). COMPARE-u322-vs-u323.md + fills CSV + report. |
| `20260923-mac-u324-midrun/` | ~7:40–8:05 CT Sep 23 2026 | Mac U3.2.4 mid-run dig — 34 fills, +$0.014 FIFO/UI; 0 late≤4m, 0 low-mid longs; cover still on; red feel = flatten-long bleed mid>40¢ (ZEC/BTC) not noOpen=4. Report + fills CSV + dig-stats. |

PAPER ONLY.

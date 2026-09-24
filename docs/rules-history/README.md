# Rules history (append-only)

**Never delete** snapshots in this folder. Each U3.x.y (and similar) ships a full copy of `src/lib/crypto15m/mm/RULES.md` *before* that release edits RULES, so we can recover yesterday’s playbook if today’s rules are trash.

## Convention

- Filename: `RULES-YYYYMMDD-HHMMSS-pre-U3.x.y.md` (box-local America/Chicago time).
- Also keep the live `src/lib/crypto15m/mm/RULES.md` as the current playbook.
- Paper journals / dig tapes live under `data/paper-mm/` (runtime, often gitignored) and durable copies under `data/paper-mm/archive/` (committed). **Never auto-purge** either.

## Snapshots

| File | Notes |
|------|--------|
| `RULES-20260923-182004-pre-U3.2.3.md` | Pre-U3.2.3 (post U3.2.2 UI disk journal) |
| `RULES-20260923-193727-pre-U3.2.4.md` | Pre-U3.2.4 (post U3.2.3 late-open curb) |
| `RULES-20260923-200932-pre-U3.2.5.md` | Pre-U3.2.5 (post U3.2.4 noOpen=4; longOpenMinMid still 0.40) |
| `RULES-20260923-205440-pre-U3.2.6.md` | Pre-U3.2.6 (post U3.2.5 curb 0.50; soft-exit not yet) |
| `RULES-20260923-214635-pre-U3.2.7.md` | Pre-U3.2.7 (post U3.2.6 soft-exit; Start still loose / $0 covers) |

PAPER ONLY — never places live Kalshi orders.

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

PAPER ONLY — never places live Kalshi orders.



## Fix: Block NULL `l3_avg` Picks Across All Engines

### Problem
All 5 engines currently **allow picks through when `l3_avg` is NULL**. The Mobley assists case proved this is dangerous — a player with a 37% L3 decline passed every filter because `l3_avg` was never populated.

### Current Pattern (all 5 files)
```typescript
if (l3Avg == null) → allow through  // BAD
```

### Fix — Change to Block NULL L3
Every engine that checks L3 will be updated to **skip/block** picks with NULL `l3_avg` instead of allowing them.

| File | Current Logic | Change |
|------|--------------|--------|
| `bot-generate-daily-parlays` (line 4703) | `if (l3Avg == null) return true` | `if (l3Avg == null) return false` + log |
| `bot-matchup-defense-scanner` (line 262) | `if (l3Avg !== null && ...)` only checks when present | Add `if (l3Avg === null) continue;` before the existing check |
| `bot-curated-pipeline` (line 155) | `if (l3Avg !== null && ...)` | Add `if (l3Avg === null) continue;` |
| `sharp-parlay-builder` (line 66) | `if (l3Avg !== null && ...)` | Add `if (l3Avg === null) continue;` |
| `heat-prop-engine` (line 100) | `if (l3Avg !== null && ...)` | Add `if (l3Avg === null) continue;` |

### Also: Fix `actual_line` in `sweet_spot_l3` Strategy
In the L3 candidate block of `bot-generate-daily-parlays`, use `p.actual_line ?? p.line` so the L3 score is computed against real sportsbook lines, not internal floors.

### Also: Void Bad Parlays
Void any pending parlays containing Mobley assists or Mitchell points at the wrong line.

### Deploy
Redeploy all 5 edge functions after changes.


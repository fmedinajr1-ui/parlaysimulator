

# Block Denzel Clarke + Add Daily Dedup Guard

## Problem
1. **Denzel Clarke** generated 138+ alerts on a single day with a 14.5% hit rate, tanking overall RBI accuracy
2. No per-player daily cap exists — the in-memory dedup only keeps best-per-event within a single run, not across runs

## Changes

### 1. Block Denzel Clarke — `hrb-mlb-rbi-analyzer/index.ts`
Add a `BLOCKED_PLAYERS` set at the top of the file containing `'Denzel Clarke'`. Filter out any snapshots for blocked players before analysis begins (around line 382, before alert generation).

### 2. Daily Dedup Guard — `hrb-mlb-rbi-analyzer/index.ts`
Before inserting final alerts (~line 430), query `fanduel_prediction_alerts` for existing alerts today with `prop_type = 'batter_rbis'` grouped by `player_name`. Skip any player who already has 3+ alerts today. This prevents runaway duplication across multiple scanner runs.

### 3. Same guard in `fanduel-prediction-alerts/index.ts`
Add an identical blocked-player check and daily cap (max 3 alerts per player per prop_type per day) in the main prediction alerts engine to cover all entry points.

## Technical Details

**Blocked players list** (hardcoded set — easy to extend):
```typescript
const BLOCKED_PLAYERS = new Set(['Denzel Clarke']);
```

**Daily cap query** (run once before insert):
```sql
SELECT player_name, count(*) as cnt
FROM fanduel_prediction_alerts
WHERE prop_type = 'batter_rbis'
  AND created_at >= current_date
GROUP BY player_name
HAVING count(*) >= 3
```

Players returned are skipped from insertion. Cap of 3 per player per day balances catching legitimate multi-signal scenarios while preventing 100+ alert floods.


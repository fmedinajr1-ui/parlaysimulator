

# Fix: Remove Baseball from Strategy Parlays + Regenerate & Broadcast

## What Happened
The `BLOCKED_SPORTS` list already excludes `baseball_ncaa` and `baseball_mlb` from generation. However, the parlays containing baseball legs were generated **before** the block was active. The broadcast function sent them because it queries by `strategy_name` without checking individual leg sports.

## Changes

### 1. `supabase/functions/broadcast-new-strategies/index.ts`
Add a post-fetch filter that removes any parlay containing baseball legs:
```typescript
const filtered = parlays.filter(p => {
  const legs = Array.isArray(p.legs) ? p.legs : [];
  return !legs.some(l => (l.sport || '').includes('baseball'));
});
```
Apply this filter in both the primary and broad fallback paths before broadcasting.

### 2. Void existing baseball strategy parlays via SQL
Update today's strategy parlays that contain baseball legs to `outcome: 'voided'` so they don't get re-sent.

### 3. Regenerate fresh parlays
Invoke `bot-generate-daily-parlays` with `source: 'strategy_regen_no_baseball'` to create new clean NBA-only strategy parlays.

### 4. Re-broadcast
Invoke `broadcast-new-strategies` to send the clean parlays to all customers, showing what was generated.

### Files Changed
1. **`supabase/functions/broadcast-new-strategies/index.ts`** — add baseball leg filter



## Filter Out Steals Props from Bot Parlay Generation

### Why

Steals (`player_steals`) have a **0% win rate** (0-2) across all settled parlay legs. This is a catastrophic category that should be blocked from inclusion in generated parlays until performance improves.

### What Changes

**1. `supabase/functions/bot-generate-daily-parlays/index.ts`**

Add a new `BLOCKED_PROP_TYPES` set right after the existing `BLOCKED_CATEGORIES` block (around line 429):

```
const BLOCKED_PROP_TYPES = new Set([
  'player_steals',   // 0% win rate (0-2 settled)
]);
```

Then add a filter step in the pick pipeline (where picks are enriched/filtered before parlay building) to reject any pick whose `prop_type` or `bet_type` matches a blocked prop type. This filter will be applied:
- In the main enriched sweet spots filtering pass
- In the fallback enrichment pass
- In the sweep/monster parlay candidate pools

Each rejection will be logged: `[BlockedPropType] Filtered player_steals pick for {player_name}`

**2. `supabase/functions/bot-force-fresh-parlays/index.ts`**

This function has its own independent generation pipeline. Add the same `BLOCKED_PROP_TYPES` filter after the mispriced lines are fetched (around step 3, before scoring), rejecting any pick with `prop_type` matching `player_steals`.

### Technical Details

The filter is applied at the candidate pool level (before parlay assembly) so no steals picks can enter any parlay tier -- execution, validation, sweep, or monster. This follows the same pattern as `BLOCKED_SPORTS` which filters at the pool level.

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `BLOCKED_PROP_TYPES` set; filter picks in main, fallback, and sweep passes |
| `supabase/functions/bot-force-fresh-parlays/index.ts` | Add same `BLOCKED_PROP_TYPES` filter before scoring step |

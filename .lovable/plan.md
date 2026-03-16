
# Implement the Composite Average Filter in Parlay Generation

## Problem
The Composite Average Filter described in the memory (`(L10 × 0.20) + (L5 × 0.25) + (L3 × 0.30) + (H2H × 0.25)`) is **not implemented** in `bot-generate-daily-parlays`. The `composite_score` field on legs is just the sweet spot confidence score — not a weighted performance average. This means parlays are being generated without validating that picks align with recent player form.

Additionally, only 2 parlays survived today despite 8 games and 164 pool picks. The execution tier produced 0 parlays because no picks met the 70% L10 hit rate gate.

## Plan

### 1. Add Composite Average Validation as post-generation filter
**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

After parlays are assembled but before they're inserted into `bot_daily_parlays`, add a validation step:

```
For each leg in a parlay:
  1. Look up player's l3_avg, l5_avg (from nba_player_game_logs aggregation) 
     and l10_avg (from category_sweet_spots)
  2. Compute: compositeAvg = (l10_avg × 0.20) + (l5_avg × 0.25) + (l3_avg × 0.30) + (h2h_avg × 0.25)
     - If H2H missing: (l10 × 0.25) + (l5 × 0.30) + (l3 × 0.45)
  3. For OVER picks: flag conflict if compositeAvg < line
  4. For UNDER picks: flag conflict if compositeAvg > line
  5. Attach compositeAvg to each leg object for downstream use
```

Conflicting legs get a `composite_conflict: true` flag. Parlays with >50% conflicting legs are demoted from execution to exploration tier (not removed, just downgraded).

### 2. Use l3_avg and l10_avg from category_sweet_spots (already available)
The sweet spots table already has `l3_avg` and `l10_avg` columns. The enrichment step loads these. We just need to:
- Also query `l5_avg` (compute from `nba_player_game_logs` last 5 games, or add to sweet spots)
- Pass these values through to the assembly engine

### 3. Log composite conflicts for Telegram admin report
After validation, if any conflicts found, log them. The existing `bot-slate-status-update` can include a conflict summary.

### Files to edit
- `supabase/functions/bot-generate-daily-parlays/index.ts` — add composite average computation during enrichment (~line 3700-3800 area) and validation after parlay assembly (~line 8300 area)
- `supabase/functions/category-props-analyzer/index.ts` — ensure `l5_avg` is computed and stored (check if it already is)

### Expected impact
- Catches bad picks where recent form contradicts the bet direction
- Adds `composite_avg` field to every leg for UI display and Telegram reports
- Does NOT reduce parlay count (conflicts demote, not remove) — important given thin pool

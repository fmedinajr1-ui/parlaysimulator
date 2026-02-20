

## Lower Coherence Score Thresholds

### Change
Reduce the minimum coherence score gates in `bot-generate-daily-parlays` so parlays can still generate on thin slates (1-2 games) while maintaining a baseline quality standard.

**Current thresholds:**
- Execution tier: 85
- All other tiers: 75

**New thresholds:**
- Execution tier: 70
- All other tiers: 60

### Technical Details

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Two lines change (around lines 4601-4606):

1. Line 4601: `coherence < 85` becomes `coherence < 70`
2. Line 4605: `coherence < 75` becomes `coherence < 60`

Log messages will be updated to reflect the new thresholds.

No other files or schema changes needed.


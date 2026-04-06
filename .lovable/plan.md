

# Fix Team News Shift Signal Direction

## Problem
The Team News Shift and Correlated Movement signals currently use **contrarian logic** (fade the direction) for ALL scenarios. When 5+ players on the same team are dropping with 85%+ correlation, that's real news — fading it with OVER is wrong.

## Change

**File:** `supabase/functions/fanduel-behavior-analyzer/index.ts` (lines 985-987)

Split the action logic based on signal type:

1. **`team_news_shift`** (85%+ correlation, 3+ players) — go WITH the movement:
   - Dropping → **UNDER** ("Lines dropping across X players = real news, take UNDER")
   - Rising → **OVER** ("Lines rising across X players = real news, take OVER")

2. **`correlated_movement`** (lower correlation) — keep contrarian fade:
   - Dropping → **OVER** (current behavior, trap theory applies)
   - Rising → **UNDER** (current behavior)

This means the system trusts high-correlation team-wide shifts as legitimate market moves while still fading lower-confidence correlated noise.

## Also update
- The reason text to explain WHY (news-driven vs trap fade)
- The prediction accuracy recording so we can track if this change improves hit rate

## Technical Details
- Single file change in `fanduel-behavior-analyzer/index.ts`
- Affects lines ~985-996 (the correlation/team_news_shift alert formatter)
- Also need to check where these signals get written to `fanduel_prediction_accuracy` to ensure the action direction is stored correctly there too (likely earlier in the function around line 260-280)
- Deploy via edge function update


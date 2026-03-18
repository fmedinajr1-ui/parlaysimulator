
# Stop Excessive Voiding & Tighten Sweet Spot Engine Quality

## Root Cause: Where Parlays Get Voided

There are **6 separate voiding mechanisms** currently active, and they cascade:

| Source | Trigger | Yesterday Impact |
|--------|---------|-----------------|
| `refresh-l10-and-rebuild` (line 141) | Voids ALL pending parlays before regenerating | **All 7 parlays voided** |
| `bot-quality-regen-loop` (line 206) | Voids non-best attempts after 3 regen cycles | Additional voids |
| `bot-quality-regen-loop` (line 249) | Cross-attempt dedup fingerprinting | Voids duplicates |
| `bot-quality-regen-loop` (line 312) | Exposure cap (2 per player) | Voids excess |
| `bot-quality-regen-loop` (line 340) | Daily cap of 25 parlays | Voids lowest-prob excess |
| `pre-game-leg-verifier` (line 283) | Drops injured legs, voids if < 2 remain | Pre-game cleanup |
| `bot-parlay-auto-apply` (line 95) | Smart check drops legs below 2 | Smart check voids |

**The #1 problem**: `refresh-l10-and-rebuild` blanket-voids ALL pending parlays before regenerating new ones. The 30-minute "double-run protection" only prevents voiding if parlays were generated in the last 30 min — but the cron runs at 5:30 PM ET, so any morning-generated parlays are always older than 30 min and get wiped.

## Fix Strategy

### 1. Remove blanket void from orchestrator
**File**: `supabase/functions/refresh-l10-and-rebuild/index.ts`

Remove the void step entirely (lines 126-154). The quality regen loop already handles dedup, exposure caps, and daily caps. The orchestrator should **generate additively** and let downstream filters cull. This single change would have saved all 7 parlays yesterday.

### 2. Tighten sweet spot engine — raise composite filter to HARD BLOCK
**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Currently the composite filter only **demotes** parlays from execution → exploration when >50% legs conflict. This is too soft. Changes:

- Move the composite check from post-generation (line 11100) to **per-leg** (inside the leg assembly loop ~line 8230). Block conflicting legs before they enter a parlay.
- For execution tier: hard-block any leg where composite average is on the wrong side of the line.
- For validation tier: allow legs where composite is within 0.5 of the line (marginal edge).
- This prevents bad legs from ever forming parlays, reducing volume of junk parlays that get voided downstream.

### 3. Add FG efficiency gate to sweet spot scoring
**File**: `supabase/functions/category-props-analyzer/index.ts`

The sweet spot engine currently uses `L10 Median (45%) + Regression (25%) + H2H (22%) + Pace (8%)`. Add a **shooting efficiency adjustment** for scoring props:

- For `points` and `threes` categories: fetch L10 FG% from game logs
- If player's L10 FG% deviates >5% from season average, apply regression factor to the projection
- This prevents recommending OVER on a player shooting unsustainably hot (or UNDER on someone in a cold streak that's likely to revert)

### 4. Raise minimum edge thresholds in sweet spot engine  
**File**: `supabase/functions/category-props-analyzer/index.ts`

Current thresholds (already "tripled" in v6.0) still produce too many marginal picks. Raise by ~30%:
- Points: 4.5 → 5.5
- Rebounds: 2.5 → 3.0
- Assists: 2.0 → 2.5
- Threes: 1.0 → 1.2

### 5. Reduce daily parlay cap and tighten exposure
**File**: `supabase/functions/bot-quality-regen-loop/index.ts`

- Daily cap: 25 → 15 (fewer, higher-quality parlays)
- Exposure cap: 2 per player → 1 per player (force diversity)
- This concentrates bankroll on the best picks instead of spreading across marginal ones

## Files to Change
| File | Change |
|------|--------|
| `supabase/functions/refresh-l10-and-rebuild/index.ts` | Remove blanket void step |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Move composite filter to per-leg hard block |
| `supabase/functions/category-props-analyzer/index.ts` | Add FG efficiency adjustment, raise edge thresholds |
| `supabase/functions/bot-quality-regen-loop/index.ts` | Reduce daily cap to 15, exposure cap to 1 |



# Remove Lottery Tier — Stop Burning Money

## What Gets Removed

The lottery tier has **0 wins** and is pure loss. We need to disable it across the generation pipeline, orchestration schedule, UI display, and stake configuration.

## Changes

### 1. `supabase/functions/bot-generate-daily-parlays/index.ts`
- The `bankroll_doubler` mega-parlay builder (~lines 8600-8750) and round-robin sub-parlays are already partially disabled (master parlay commented out at line 10393). We'll **skip** any remaining `bankroll_doubler` strategy insertions by wrapping the mega-parlay + round-robin block in a disabled guard (or commenting it out like master parlay).

### 2. `supabase/functions/nba-mega-parlay-scanner/index.ts`
- This is the dedicated lottery scanner function. **Disable it** by returning early with a "lottery tier disabled" message, preserving the code for potential future use.

### 3. `supabase/functions/refresh-l10-and-rebuild/index.ts`
- Remove the `"Scanning lottery parlays", "nba-mega-parlay-scanner"` step from the rebuild pipeline.

### 4. `supabase/functions/data-pipeline-orchestrator/index.ts`
- Remove the `nba-mega-parlay-scanner` call from the orchestrator.

### 5. `src/components/market/SlateRefreshControls.tsx`
- Remove the "Scanning lottery parlays" step from the manual rebuild UI.

### 6. `src/components/bot/StakeCalculator.tsx`
- Remove the "Bankroll Doubler" row from the `TIERS` array and `BANKROLL_PLANS` lottery column.

### 7. `src/components/bot/StakeConfigPanel.tsx`
- Remove the `bankroll_doubler_stake` field from the admin config UI.

### 8. `src/components/bot/DailyProfitProjector.tsx`
- Already only has 3 tiers (Execution/Validation/Exploration) — no change needed.

### 9. `src/hooks/useDailyParlays.ts`
- Remove `LOTTERY` from the type union and filter out lottery parlays from display, or keep them visible as historical data but stop generating new ones.

### 10. `src/components/parlays/UnifiedParlayCard.tsx`
- Remove the `LOTTERY` style config (gold ticket styling).

## Result
- No more lottery parlays generated or broadcast
- Stake capital redirected to profitable tiers (Execution/Validation/Exploration)
- Historical lottery data remains in the database for reference
- UI no longer shows lottery tier options




# Light-Slate Volume Throttle

## Problem
On light game days (Wednesdays, Tuesdays, etc.), the bot generates the same high volume of Execution-tier parlays ($250+ stakes) despite fewer games. This leads to:
- `grind_stack` and `shootout_stack` going 0-14 on recent Wednesdays
- Low-quality picks filling profiles because the pool is thin
- The system currently *relaxes* constraints on light slates (opposite of what it should do)

## Solution
Add a light-slate throttle in `bot-generate-daily-parlays/index.ts` that **reduces** Execution and Validation tier volume and stakes when the slate is thin, rather than relaxing quality gates.

### Changes to `supabase/functions/bot-generate-daily-parlays/index.ts`

**1. After light-slate detection (~line 9924), add stake and profile throttling:**

When `isLightSlateMode` is true:
- **Cut Execution tier profiles by 50%**: Filter to only high-conviction strategies (`double_confirmed_conviction`, `triple_confirmed_conviction`, `multi_engine_consensus`, `optimal_combo`, `floor_lock`). Remove `grind_under_core`, `matchup_exploit`, `matchup_team_stack`, and other volume-filler strategies from Execution.
- **Cap Execution stake at 50%** of configured value (e.g., $300 → $150)
- **Cap Validation stake at 50%** as well
- **Cap max Execution parlays** from 50 → 15 (the `count` field)
- **Cap max Validation parlays** from 50 → 10
- **Skip cluster parlays entirely** on light slates (the shootout/grind stack builder at line 10051 — add `&& !isLightSlateMode` guard)
- **Skip Monster parlays** on light slates (line 10187)

**2. Tighten quality gates on light slates (opposite of current behavior):**

Currently the code *lowers* floors on light slates. Reverse this:
- Keep `minHitRate` at tier defaults (don't relax)
- Raise Execution L10 hit rate gate from 80% → 85% on light slates
- Keep the thin-slate max-legs cap at 3

**3. Log the throttle clearly:**

```typescript
if (isLightSlateMode) {
  const origExecCount = TIER_CONFIG.execution.count;
  TIER_CONFIG.execution.count = Math.min(TIER_CONFIG.execution.count, 15);
  TIER_CONFIG.execution.stake = Math.round(TIER_CONFIG.execution.stake * 0.5);
  TIER_CONFIG.validation.count = Math.min(TIER_CONFIG.validation.count, 10);
  TIER_CONFIG.validation.stake = Math.round(TIER_CONFIG.validation.stake * 0.5);
  
  // Filter execution profiles to high-conviction only
  const HIGH_CONVICTION_STRATEGIES = new Set([
    'double_confirmed_conviction', 'triple_confirmed_conviction',
    'multi_engine_consensus', 'optimal_combo', 'floor_lock',
    'cross_sport_4', 'grind_under_core'
  ]);
  TIER_CONFIG.execution.profiles = TIER_CONFIG.execution.profiles.filter(
    p => HIGH_CONVICTION_STRATEGIES.has(p.strategy)
  );
  
  console.log(`[Bot v2] 🚦 LIGHT-SLATE THROTTLE: exec ${origExecCount}→${TIER_CONFIG.execution.count} parlays, stake halved to $${TIER_CONFIG.execution.stake}, ${TIER_CONFIG.execution.profiles.length} profiles kept`);
}
```

**4. Guard cluster and monster parlays:**

- Line ~10051: Change `if (tiersToGenerate.includes('execution'))` to `if (tiersToGenerate.includes('execution') && !isLightSlateMode)`
- Line ~10187: Wrap monster parlay generation with `if (!isLightSlateMode)`

## Summary

| Setting | Normal Slate | Light Slate |
|---|---|---|
| Execution max parlays | 50 | 15 |
| Execution stake | $300 | $150 |
| Validation max parlays | 50 | 10 |
| Validation stake | $100 | $50 |
| Cluster stacks (shootout/grind) | Enabled | Disabled |
| Monster parlays | Enabled | Disabled |
| Execution profiles | All (~50) | High-conviction only (~12) |


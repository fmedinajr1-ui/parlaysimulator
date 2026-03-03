

## Plan: Enable Alt Lines on Matchup-First Exploration Profiles + Fix Generation Blockers

### Two Issues Found

**1. Alt lines are NOT enabled on any matchup profile.**
All 20 matchup exploration profiles (`matchup_exploit`, `matchup_team_stack`, `matchup_mispriced`) have no `useAltLines` property — they default to `false`. Meanwhile, other strategies like `double_confirmed_conviction`, `mispriced_edge`, and `boosted_cash` already use `useAltLines: true` with `boostLegs: 1` and `minBufferMultiplier: 1.5`.

**2. Zero exploration parlays generated on thin slates.**
The last run produced 0 exploration parlays because the matchup-boosted pick pool was too small after diversity caps and dedup filtering. The `minHitRate` floors (48-55%) combined with fingerprint dedup and team/player caps choke the output when only 14 matchup-boosted picks exist.

### Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

#### A. Add alt lines to matchup profiles (~lines 789-810)
Update all 20 matchup exploration profiles to include alt line shopping:
- `matchup_exploit` profiles: add `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`
- `matchup_team_stack` profiles: add `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.3` (slightly lower buffer since same-team correlation provides natural edge)
- `matchup_mispriced` profiles: add `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`

This means the system will fetch safer alternate lines for the strongest candidate leg in each parlay — dropping a line by 0.5-1.0 to boost hit probability while keeping odds above -200.

#### B. Lower hit rate floors for thin-slate resilience (~lines 789-810)
Reduce `minHitRate` on matchup profiles to prevent zero-output on small slates:
- 3-leg `matchup_exploit`: lower from 50-55% → 45-50%
- 4-leg `matchup_exploit`: lower from 48-50% → 42-45%
- `matchup_team_stack`: lower from 48-50% → 42-48%
- `matchup_mispriced`: keep at 50% (already filtered by mispriced edge)

The matchup boost itself (+18/+22 composite) already filters for quality — the hit rate floor is redundant gatekeeping.

#### C. Relax diversity constraints for matchup exploration (~line 6560-6604)
In the `matchup_exploit` routing branch, set `maxPlayerUsage` to 4 (from 3) and skip the golden gate check for exploration-tier matchup profiles. This allows the same high-value player to appear in multiple matchup parlays when they have an elite defensive matchup.

### Technical Details

- Alt line fetching already works — the engine calls `fetch-alternate-lines` for top 15 candidates when any profile has `useAltLines: true`
- The `boostLegs: 1` cap ensures only one leg per parlay gets an alt line substitution
- The `minBufferMultiplier: 1.5` requires the player's projection to be 1.5x above the line before alt line activation (safety gate)
- No new edge functions or database changes needed

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Enable `useAltLines` on all 20 matchup profiles, lower minHitRate floors, relax diversity caps for matchup strategies |


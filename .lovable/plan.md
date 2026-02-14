

# Reduce Void Rate: NCAA Baseball Gate + Settlement Guardrails

## Root Cause
17 of 21 parlays voided on Feb 13th. **12 of those 17 contain NCAA baseball legs** with `no_data` outcomes. Early-season college baseball (mid-February) has extremely limited score coverage on ESPN, making these parlays unsettleable.

The remaining 5 voids are from NCAAB games that also returned `no_data`, likely minor conference games with sparse coverage.

## Current State
The bot has **8 dedicated baseball profiles** across all 3 tiers:
- Exploration: 5 profiles (totals x2, spreads, mixed, cross-sport)
- Validation: 2 profiles (totals, spreads)
- Execution: 1 profile (totals)

These generate ~12-15 parlays daily that almost all void, wasting pick slots and inflating the void count.

## Proposed Changes

### 1. Add a Baseball Season Gate
Add a date-based gate in the generation engine that only enables NCAA baseball profiles after **March 1st** (when the season is fully underway and ESPN coverage is reliable). Before that date, baseball profiles are skipped entirely.

```text
Feb 14 -> baseball profiles SKIPPED (too early)
Mar 1  -> baseball profiles ACTIVE (season in full swing)
```

### 2. Reduce Baseball Profile Count
Even after March 1st, 8 profiles is excessive for a sport with less data coverage. Reduce to:
- Exploration: 2 profiles (totals, spreads)
- Validation: 1 profile (totals)
- Execution: 1 profile (totals)
Total: 4 profiles (down from 8)

### 3. Add a "Settleable Score Source" Pre-check for Team Legs
Before including any team leg in a parlay, verify that the sport+league combination has a working score source. Add a simple allowlist check:
- `basketball_nba` -- always settleable (ESPN + game logs)
- `basketball_ncaab` -- settleable for Top 200 teams only (via ESPN Scoreboard)
- `icehockey_nhl` -- always settleable
- `baseball_ncaa` -- only after March 1st, and only for D1 conferences

### 4. Tighten NCAAB Minor Conference Filter
The 5 non-baseball voids were likely from obscure NCAAB matchups (Iona vs Canisius, etc.) where scores weren't found. Add a filter to block NCAAB games where **both teams are outside the Top 200 KenPom rankings** from execution and validation tiers.

## Technical Details

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Season gate** (near the profile loop, around line 2230):
- Before iterating baseball profiles, check if the current Eastern date is >= March 1st
- If not, skip all profiles where `sports` includes `baseball_ncaa`

**Profile reduction** (lines 88-93, 149-151, 207-208):
- Remove 3 exploration baseball profiles (keep totals + spreads only)
- Remove 1 validation baseball profile (keep totals only)
- Keep 1 execution baseball profile as-is

**NCAAB quality gate** (in the team pick filtering logic):
- For validation and execution tiers, require at least one team in an NCAAB matchup to be in the Top 200 KenPom
- For exploration, allow all NCAAB but apply a 0.7x weight penalty to games where both teams are unranked

### Expected Impact
- Eliminates ~12-15 unsettleable baseball parlays per day until March
- Reduces NCAAB voids from minor conference games
- Void rate should drop from ~80% to under 15%
- More pick slots available for NBA/NCAAB/NHL parlays that can actually be graded


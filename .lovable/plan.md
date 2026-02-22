

## Problem: Bot Isn't Cloning Your Winning DNA

### The Data Tells the Story

Your **winning parlays this month** have a very clear pattern:

```text
WINNING ARCHETYPE (Feb 20-21, 13 winners):
- 3-leg NBA OVERS: THREE_POINT_SHOOTER + VOLUME_SCORER + BIG_REBOUNDER
- Categories: 3PT (28 hits), Points (20 hits), Rebounds (12 hits), Assists (8 hits)
- Side: Almost ALL overs
- Sport: Almost ALL basketball_nba
- Strategy: mispriced_edge and explore_safe dominate wins
```

But the bot is wasting volume on things that DON'T win:

```text
TODAY'S GENERATION (22 parlays):
- 10 PITCHER_STRIKEOUTS legs (MLB) -- MLB has 0 settled wins
- 6 master_parlay legs (6-leggers) -- 0-15 lifetime record
- Only 8 VOLUME_SCORER legs vs 16 THREE_POINT_SHOOTER legs
- Missing the winning combo pattern entirely
```

### Root Causes

1. **MLB contamination** -- `baseball_mlb` is NOT in `BLOCKED_SPORTS`, so MLB picks (especially PITCHER_STRIKEOUTS) get mixed into multi-leg parlays. Your winning 4-legger from Feb 21 had 2 MLB legs that were voided (not actually won).

2. **No "winning archetype replication"** -- The bot generates from a static list of ~75 profiles but has NO mechanism to detect "this exact category combo has been winning" and generate MORE of that pattern.

3. **Volume spread too thin** -- 50 exploration + 15 validation + 10 execution = 75 profiles, but the winning combo (3PT + SCORER + REBOUNDER in 3-legs) only gets maybe 2-3 profiles by accident.

4. **Master parlays still generating** -- 6-leg `master_parlay_max_boost` is producing parlays today despite being "DISABLED" in comments. The code comment says disabled but the profile was re-enabled under a different boost name.

### Solution: Two Changes

**Change 1: Block MLB from generation** (as discussed)
- Add `baseball_mlb` to `BLOCKED_SPORTS`
- Remove/comment MLB-specific profiles (8 profiles across all tiers)
- Remove `mlbBoost` from composite scoring

**Change 2: Add "Winning Archetype Replication" profiles**

Inject new profiles across all 3 tiers that specifically target the winning combo patterns from this month's data:

**Exploration tier (add 6 profiles):**
- 3x `winning_archetype_3pt_scorer` -- THREE_POINT_SHOOTER + VOLUME_SCORER combo, NBA only, 3-legs
- 3x `winning_archetype_reb_ast` -- BIG_REBOUNDER + ASSISTS combo, NBA only, 3-legs

**Validation tier (add 4 profiles):**
- 2x `winning_archetype_3pt_scorer` -- Same pattern, higher hit rate floor (60%)
- 2x `winning_archetype_reb_ast` -- Same pattern, higher floor

**Execution tier (add 4 profiles):**
- 2x `winning_archetype_3pt_scorer` -- Tightest filters (65% hit rate, composite sort)
- 2x `winning_archetype_reb_ast` -- Tightest filters

Then in the candidate selection logic, add a `winningArchetypeBonus` (+15 composite score) when a candidate's category matches the proven winning categories: `THREE_POINT_SHOOTER`, `VOLUME_SCORER`, `BIG_REBOUNDER`, `HIGH_ASSIST`.

### Technical Details

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Change 1 -- Block MLB** (~30 lines):
- Line 264: Add `'baseball_mlb'` to `BLOCKED_SPORTS`
- Lines 73, 80, 139, 140, 144: Comment out MLB exploration profiles
- Lines 173, 181: Comment out MLB validation profiles  
- Line 244: Comment out MLB execution profile
- Lines ~4146-4236: Remove `mlb_engine_picks` fetch and `mlbBoost` from composite score

**Change 2 -- Winning Archetype Profiles** (~40 lines):
- Add new profile entries with `strategy: 'winning_archetype_*'` to each tier
- Add `preferCategories` field to these profiles: `['THREE_POINT_SHOOTER', 'VOLUME_SCORER', 'BIG_REBOUNDER']`
- In candidate filtering (~line 3800+), when a profile has `preferCategories`, apply +15 composite bonus to matching candidates and sort them first
- This ensures the bot concentrates on the exact category combos that have been winning

### Expected Result
- Zero MLB legs in generated parlays
- 14 new archetype-specific profiles targeting the proven winning patterns
- Higher concentration of THREE_POINT_SHOOTER + VOLUME_SCORER + BIG_REBOUNDER combos
- Winning archetype candidates get priority scoring (+15 composite boost)


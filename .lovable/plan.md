

# Fix Voided Parlays: Root Cause and Prevention

## Investigation Findings

**Void Rate**: Extremely high -- 62 out of 162 total parlays (38%) ended as void.

| Date | Total | Voided | Void % |
|------|-------|--------|--------|
| Feb 14 | 16 | 12 | 75% |
| Feb 13 | 21 | 17 | 81% |
| Feb 12 | 22 | 4 | 18% |
| Feb 10 | 7 | 3 | 43% |
| Feb 9 | 45 | 25 | 56% |

### Root Causes

**1. NCAA Baseball has NO settlement path (critical)**
- The settlement function routes NCAAB to ESPN and Tennis to Odds API, but `baseball_ncaa` falls through to the NBA player logs path
- NBA logs return zero results for baseball games, so every baseball leg returns `no_data`
- Every parlay containing baseball legs is guaranteed to void
- This affected ALL `baseball_totals`, `baseball_spreads`, and `baseball_mixed` profiles

**2. Small-conference NCAAB teams fail ESPN fuzzy matching**
- Teams like "Bucknell Bison" vs "Boston Univ. Terriers" either do not appear in ESPN's 200-game scoreboard window or fail name normalization
- The existing Top 200 KenPom gate only blocks when BOTH teams are outside Top 200 -- a single obscure team can still slip through

**3. >50% void threshold voids entire parlays**
- If 2 of 3 legs return `no_data`, the whole parlay is voided even if the 3rd leg hit

### Today's Parlays (Feb 15): Risk Assessment

All 6 parlays are NCAAB only (no baseball -- good). Unique matchups:
- Indiana vs Illinois -- safe (Big Ten, will settle)
- South Florida vs Florida Atlantic -- safe (AAC, will settle)
- Utah vs Cincinnati -- safe (Big 12, will settle)
- Bradley vs Southern Illinois -- moderate risk (Missouri Valley Conference, smaller but ESPN covers MVC)
- Iona vs Niagara -- higher risk (MAAC conference, may fail ESPN matching)

## Plan: Two-Part Fix

### Part 1: Add NCAA Baseball settlement via ESPN (prevents future voids)

**File: `supabase/functions/bot-settle-and-learn/index.ts`**

1. Add ESPN NCAA Baseball scoreboard URL constant:
   ```
   https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard
   ```

2. Create `settleNcaaBaseballViaESPN` function mirroring the existing `settleNcaabTeamLegViaESPN`:
   - 3-day search window
   - Same fuzzy matching logic
   - Checks `STATUS_FINAL` or `completed: true`

3. Update `settleTeamLeg` routing to check for `baseball_ncaa` sport key:
   ```
   if sport includes 'baseball_ncaa' -> settleNcaaBaseballViaESPN
   ```

### Part 2: Tighten NCAAB quality gate to prevent unsettleable games

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

Currently the KenPom gate only blocks when BOTH teams are outside Top 200. Tighten it:

1. In the exploration tier, block games where EITHER team is outside Top 200 KenPom (not just both)
2. In validation and execution tiers, keep the existing "both outside Top 200" rule but add: block if either team has no KenPom data at all (rank defaults to 999)
3. Add a specific `baseball_ncaa` quality gate: only include games where both teams appear in `ncaa_baseball_team_stats` (ensures data exists for settlement)

### Files to Edit

1. `supabase/functions/bot-settle-and-learn/index.ts` -- add NCAA baseball ESPN settlement path
2. `supabase/functions/bot-generate-daily-parlays/index.ts` -- tighten quality gates for obscure matchups

### Expected Impact

- Eliminates 100% of baseball voids (currently guaranteed to void)
- Reduces NCAAB voids from fuzzy match failures by filtering out obscure teams at generation time
- Today's parlays should settle cleanly (all are NCAAB with recognizable teams)


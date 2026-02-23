

## Unified Environment Score Engine — Two-Phase Plan

### Overview

Replace the fragmented environment adjustments scattered across `bot-generate-daily-parlays` and `prop-engine-v2` with a single **Environment Score** function using:

```text
Environment Score = (Pace Factor x 0.3) + (Positional Defense x 0.3) + (Reb/Ast Environment x 0.2) + (Blowout Risk x -0.2)
```

Each component outputs a **0-to-1 normalized value**, so the final Environment Score ranges from **-0.2 to 0.8**, then scaled to a usable confidence adjustment (e.g., -20 to +20 points).

---

### Phase 1 — Unified Engine with Existing Data

Uses pace, overall defense rank, and blowout probability already available in the pipeline.

#### 1a. Database Migration

Add 4 columns to `team_defense_rankings`:

| Column | Type | Purpose |
|--------|------|---------|
| `opp_rebounds_allowed_pg` | NUMERIC | Opponent rebounds allowed/game |
| `opp_assists_allowed_pg` | NUMERIC | Opponent assists allowed/game |
| `opp_rebounds_rank` | INTEGER | Rank 1-30 (1 = fewest allowed) |
| `opp_assists_rank` | INTEGER | Rank 1-30 |

These columns will be NULL in Phase 1 and populated in Phase 2.

#### 1b. Create shared `calculateEnvironmentScore` function

Add this function near the top of `bot-generate-daily-parlays/index.ts` (and mirror in `prop-engine-v2/index.ts`):

```text
Inputs: paceRating, oppDefenseRank, blowoutProbability, propType, side (over/under), oppRebRank?, oppAstRank?

Logic:
  1. Pace Factor (0-1):
     - For OVER: normalize (pace - 94) / 12, clamped 0-1 (pace 94=0, 106=1)
     - For UNDER: invert (1 - paceFactor)

  2. Positional Defense (0-1):
     Phase 1: use overall_rank normalized as (30 - rank) / 29
     - For OVER: high value = soft defense = good
     - For UNDER: invert

  3. Reb/Ast Environment (0-1):
     Phase 1: defaults to 0.5 (neutral) when columns are NULL
     Phase 2: uses oppRebRank/oppAstRank based on prop_type

  4. Blowout Risk (0-1):
     - blowoutProbability directly (already 0-1 from game_environment)

  Output: (pace * 0.3) + (defense * 0.3) + (rebAst * 0.2) + (blowout * -0.2)
  Scaled to confidence adjustment: Math.round((envScore - 0.3) * 50)
  Clamped to -20 to +20
```

#### 1c. Update `bot-generate-daily-parlays/index.ts`

**In team bet scoring (lines ~1190-1300):**
- Replace the separate pace, defense, and blowout adjustments with a single `calculateEnvironmentScore()` call
- Store result as `breakdown.environment_score`
- Remove: `breakdown.pace_fast`, `breakdown.pace_slow`, `breakdown.pace_mismatch`, `breakdown.defense_edge`, `breakdown.blowout` individual entries
- Add: single `breakdown.environment_score` entry

**In the defense/pace data fetch (line ~3141):**
- Expand the `team_defense_rankings` select to include the new columns (will be NULL in Phase 1)

#### 1d. Update `prop-engine-v2/index.ts`

**In SES calculation (lines ~292-346):**
- Replace the `blowout_pace_score` component with the unified Environment Score
- Rename the SES component from `blowout_pace_score` to `environment_score`
- Keep the same 10% weight within SES but use the normalized formula
- Pass pace data (requires adding pace lookup — currently missing from prop-engine-v2)

**New data dependency for prop-engine-v2:**
- Add a fetch to `nba_team_pace_projections` to get pace data (currently only in the parlay generator)
- Map player's team to pace rating using existing `bdl_player_cache` team info

---

### Phase 2 — Add Positional Defense and Reb/Ast Environment Data

#### 2a. Seed Rebound/Assist Data

Use database insert tool to populate the 4 new columns for all 30 NBA teams with current season data:

```text
Example values:
OKC: opp_reb=41.2, opp_ast=23.1, reb_rank=2, ast_rank=3
WAS: opp_reb=47.8, opp_ast=27.5, reb_rank=29, ast_rank=30
```

#### 2b. Update Environment Score Logic

Replace the Phase 1 neutral fallback (0.5) with actual data:

```text
Reb/Ast Environment (0-1):
  - If prop_type contains "reb": use (30 - oppRebRank) / 29
  - If prop_type contains "ast": use (30 - oppAstRank) / 29
  - If prop_type contains "pra"/"pts+reb"/"pts+ast": blend both
  - For OVER: high value = opponent allows lots = good
  - For UNDER: invert
```

#### 2c. Update `bot-review-and-optimize/index.ts`

Expand the `team_defense_rankings` select to include the new columns so the review engine can cross-validate REB/AST picks.

---

### Files Changed

| File | Phase | Change |
|------|-------|--------|
| Database migration | 1 | Add 4 columns to `team_defense_rankings` |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | 1 | Add `calculateEnvironmentScore()`, replace fragmented adjustments |
| `supabase/functions/prop-engine-v2/index.ts` | 1 | Replace `blowout_pace_score` with environment score, add pace data fetch |
| Database insert | 2 | Seed reb/ast data for 30 teams |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | 2 | Update environment score to use real reb/ast data |
| `supabase/functions/bot-review-and-optimize/index.ts` | 2 | Expand select to include new columns |

### Risk Mitigation

- Phase 1 uses **neutral defaults (0.5)** for the missing reb/ast component, so no picks are degraded before real data arrives
- The environment score is **logged in the breakdown** so accuracy impact can be tracked immediately
- Existing NCAAB PAE logic in prop-engine-v2 is preserved (environment score only applies to NBA)


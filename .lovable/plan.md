

# Cross-Reference 0-RBI Unders with Opposing Pitcher Data

## Problem
We have 12+ players with 0 RBIs in their L10, but no opposing pitcher data in the database to cross-reference against. The `pp_snapshot` matchup field is null, and there's no MLB schedule table with probable starters.

## What We'll Build

### 1. Edge Function: `mlb-rbi-under-analyzer`
Fetches today's MLB schedule + probable pitchers, then cross-references with our 0-RBI Under candidates.

**Data flow:**
1. Query `pp_snapshot` for active `batter_rbis` props at 0.5 line
2. Query `mlb_player_game_logs` to compute L10 RBI stats per player
3. Filter to players with 0-2 RBIs in L10 (strong Under candidates)
4. Fetch today's MLB schedule from a free API (MLB Stats API: `statsapi.mlb.com/api/v1/schedule`) to get opposing team + probable pitchers
5. Cross-reference opposing pitcher's season ERA, K rate, and WHIP from `mlb_player_game_logs`
6. Score each Under candidate: players facing high-K, low-ERA pitchers get the strongest "Under Lock" rating
7. Send results to Telegram with a ranked list

**Scoring formula:**
- Base score = 100 - (L10 hit rate * 100)
- Pitcher K bonus: +10 if opposing pitcher avg Ks >= 7, +5 if >= 5
- Pitcher ERA bonus: +10 if ERA < 2.50, +5 if ERA < 3.50
- Output tiers: LOCK (score >= 90), STRONG (>= 75), LEAN (>= 60)

### 2. Database Table: `mlb_rbi_under_analysis` (optional)
Store daily analysis results for historical tracking.

**Columns:** player_name, team, opponent, opposing_pitcher, pitcher_era, pitcher_k_rate, l10_rbis, l10_hit_rate, score, tier, analysis_date

### 3. Telegram Alert Format
```
⚾ RBI UNDER LOCKS — Apr 9
━━━━━━━━━━━━━━━━━━━━
🔒 LOCKS:
• Francisco Lindor U 0.5 RBI
  L10: 0 RBIs | vs Wheeler (2.79 ERA, 8.1 K/g)
  
💪 STRONG:
• Austin Wells U 0.5 RBI  
  L10: 0 RBIs | vs Skubal (2.24 ERA, 7.8 K/g)
```

## Technical Details
- Uses MLB Stats API (`statsapi.mlb.com`) — free, no API key needed — to get today's schedule and probable pitchers
- Maps team abbreviations (NYM, NYY, etc.) to MLB team IDs for schedule lookup
- Falls back to season-level pitcher stats from `mlb_player_game_logs` when probable starter data is unavailable
- Can be scheduled daily at 10am ET via pg_cron

## Files Changed
1. **New:** `supabase/functions/mlb-rbi-under-analyzer/index.ts` — main edge function
2. **Migration:** Create `mlb_rbi_under_analysis` table for historical tracking


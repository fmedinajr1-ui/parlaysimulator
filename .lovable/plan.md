

# Fix Bidirectional Scanner: Dedup + L3-Aware Side Logic + Individual Leg Tracking

## Problems Found

### 1. Duplicate Leg Bug (Johnny Furphy)
In `nba-matchup-daily-broadcast/index.ts` (lines 226-248), `strongUnders` collects player targets from ALL `benchUnders` matchup entries. A player can appear multiple times if they show up in multiple matchup recommendations (e.g., same player under "points" from two different game matchups, or same player under both "points" and "rebounds"). The `usedPlayers` set only prevents cross-parlay duplication, NOT within the `strongUnders` array itself. So `available.slice(0, 3)` can pick the same player twice.

**Fix**: Deduplicate `strongUnders` by `player_name + prop_type` before parlay assembly, keeping the entry with the highest `l10_hit_rate`.

### 2. Desmond Bane UNDER Despite Recent OVER Performance
The scanner uses `category_sweet_spots.recommended_side` which is based on **L10 data**. If Bane's L10 average is below the line, it says UNDER. But his **L3** (last 3 games) may show him going OVER consistently. The scanner computes L3 risk tags (`L3_ABOVE_LINE`, `L3_SURGE`) but they are informational only — they never block or flip the recommendation.

**Fix**: In `bot-matchup-defense-scanner`, when the L3 average **directly contradicts** the recommended side (e.g., UNDER recommended but L3 avg > line by 15%+), skip the player from parlay assembly. Keep them in the broadcast for visibility but tag them as `L3_CONTRADICTS`.

### 3. Individual Leg Win/Loss Visibility
The `daily_elite_leg_outcomes` table already tracks per-leg results from `verify-elite-parlay-outcomes`. But there's no easy way for you to query "show me all individual leg wins and losses for yesterday." 

**Fix**: Add a `/legresults` Telegram command that queries `daily_elite_leg_outcomes` for a given date and returns a formatted list of individual hits/misses with actual values.

## Changes

### A. `supabase/functions/nba-matchup-daily-broadcast/index.ts`
- After collecting `strongUnders` (line 248), deduplicate by `player_name + prop_type`:
  ```
  const dedupKey = (u) => `${u.player_name}::${u.prop_type}`;
  const dedupMap = new Map();
  for (const u of strongUnders) {
    const key = dedupKey(u);
    if (!dedupMap.has(key) || u.l10_hit_rate > dedupMap.get(key).l10_hit_rate) {
      dedupMap.set(key, u);
    }
  }
  const dedupedUnders = [...dedupMap.values()];
  ```
- Use `dedupedUnders` instead of `strongUnders` for parlay assembly
- Also add a **same-player guard** within each parlay: ensure all 3 selected legs have unique player names

### B. `supabase/functions/bot-matchup-defense-scanner/index.ts`
- In `findPlayerTargets()` (around line 348-377), add an L3 contradiction filter:
  - If `side === 'under'` and `l3Avg !== null` and `l3Avg > line * 1.10` → skip (L3 says OVER strongly)
  - If `side === 'over'` and `l3Avg !== null` and `l3Avg < line * 0.90` → skip (L3 says UNDER strongly)
  - Add `L3_CONTRADICTS` tag for skipped players in the broadcast message (but exclude from parlay targets)

### C. `supabase/functions/telegram-webhook/index.ts`
- Add `/legresults` command handler that:
  - Queries `daily_elite_leg_outcomes` for yesterday (or specified date)
  - Groups by outcome (hit/miss/push)
  - Formats: `✅ Desmond Bane Points O22.5 → 28pts (HIT)` / `❌ Johnny Furphy Rebounds U4.5 → 6reb (MISS)`
  - Shows summary: `12/18 legs hit (67%)`


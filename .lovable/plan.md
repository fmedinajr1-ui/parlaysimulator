

# Daily L10 Refresh + Parlay Regeneration

## Problem
L10 hit rate data (`nba_player_game_logs`) can go stale because it's only refreshed when specific functions run. The `category-props-analyzer` computes L10 stats inline from game logs, but if logs are outdated, every downstream engine (risk engine, sharp builder, heat engine, ladder challenge, curated pipeline) uses bad data.

## Plan

### 1. New Edge Function: `refresh-l10-and-rebuild/index.ts`
A single orchestrator that:
1. **Syncs fresh game logs** — calls `nba-stats-fetcher` with `{ mode: 'sync', daysBack: 5, useESPN: true, includeParlayPlayers: true }` to update `nba_player_game_logs` for all active players
2. **Runs category-props-analyzer** — recomputes all L10 hit rates, averages, medians, mins, maxes in `category_sweet_spots` from the fresh game logs
3. **Regenerates parlays** — triggers the full Clean & Rebuild pipeline (void stale pending, run risk engine, build sharp/heat/ladder/mega parlays, diversity rebalance, send status update)

This replaces ad-hoc refreshes scattered across individual functions with one reliable daily entry point.

### 2. Add to `SlateRefreshControls.tsx`
Add a new "Refresh L10 & Rebuild" button that invokes this function. This gives you a one-click way to force fresh data + full regeneration from the UI.

### 3. Add to Clean & Rebuild step list
Insert the `nba-stats-fetcher` sync as **Step 1** in the existing `CLEAN_REBUILD_STEPS` array in `SlateRefreshControls.tsx`, before "Cleaning stale props". This ensures every Clean & Rebuild always starts with fresh game log data.

### Files Changed
1. `supabase/functions/refresh-l10-and-rebuild/index.ts` — new orchestrator function
2. `src/components/market/SlateRefreshControls.tsx` — add stats-fetcher sync as first step in Clean & Rebuild pipeline


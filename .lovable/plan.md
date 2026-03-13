

# Fix Bidirectional Scanner: Source-Level Dedup + L3 Backfill

## Bugs Found

### Bug 1: Duplicate Player Targets at Source
`findPlayerTargets()` iterates through `STAT_TO_PROP_TYPES` aliases (e.g., points → `['points', 'pts', 'player_points']`). But `category_sweet_spots` itself has **multiple rows per player per prop_type** (Isaac Okoro has 5 "points" rows with different lines/avgs). The current `findPlayerTargets` adds ALL matching rows, then takes top 5 by margin. So the same player appears multiple times with different lines.

The broadcast dedup (line 250-258) only collapses by `player_name::prop_type`, keeping the highest hit rate — but the **raw recommendations stored in bot_research_findings** still show duplicates (Isaac Okoro ×4 in bench_under). The Telegram broadcast message displays these duplicates.

**Impact**: Inflated player counts, misleading broadcast, and the bench_under parlay pool is polluted with near-identical entries.

### Bug 2: L3 Data Missing for Bench Players  
All bench/role players (Cam Spencer, Isaac Okoro, Donovan Clingan, etc.) have `l3_avg = NULL` in `category_sweet_spots`. The L3 contradiction filter is **completely ineffective** for the exact players it was designed to protect (bench unders). Only star players have L3 data populated.

This means the Desmond Bane-type issue (L10 says UNDER but recent games say OVER) is still unguarded for most bench players.

### Bug 3: Donovan Clingan appears 2x in bench_under with identical line
Clingan has 2 identical `points` rows in sweet_spots (both: line 12.5, side under, l10_avg 11.5). The `findPlayerTargets` top-5 slice keeps both since they have the same margin.

## Plan

### A. Deduplicate inside `findPlayerTargets()` (`bot-matchup-defense-scanner/index.ts`)
After collecting all matching targets from all prop_type aliases, deduplicate by `player_name` before the sort+slice. Keep the entry with the highest `l10_hit_rate`, and if tied, highest margin. This fixes the root cause — no more duplicate players in a single recommendation.

```
// After the inner loop, before sort:
const dedupTargets = new Map<string, PlayerTarget>();
for (const t of targets) {
  const existing = dedupTargets.get(t.player_name);
  if (!existing || t.l10_hit_rate > existing.l10_hit_rate || 
      (t.l10_hit_rate === existing.l10_hit_rate && t.margin > existing.margin)) {
    dedupTargets.set(t.player_name, t);
  }
}
const uniqueTargets = [...dedupTargets.values()];
uniqueTargets.sort((a, b) => b.margin - a.margin);
return uniqueTargets.slice(0, 5);
```

### B. Compute L3 inline when missing (`bot-matchup-defense-scanner/index.ts`)
When `l3_avg` is null from sweet_spots, query `nba_player_game_logs` for the player's last 3 games and compute the L3 average on the fly. This ensures the L3 contradiction filter works for bench players too.

- Before the main game loop, batch-fetch L3 data for all players on today's teams from `nba_player_game_logs` (last 3 games per player)
- Build an `l3Cache: Map<string, Record<string, number>>` mapping `player_name → { points: avg, rebounds: avg, ... }`  
- In `findPlayerTargets`, if `ss.l3_avg` is null, look up from `l3Cache`

### C. No changes needed in broadcast dedup
The broadcast dedup (lines 250-258) is correct and will work better once source duplicates are eliminated. The same-player guard (lines 273-280) is also correct.

## Files to Edit
- `supabase/functions/bot-matchup-defense-scanner/index.ts` — dedup in `findPlayerTargets` + L3 inline computation


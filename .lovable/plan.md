

# Fix Tennis Data Pipeline — PrizePicks Blocked, Need Alternative Sources

## Problem

The tennis pipeline has **zero data flowing** because:

1. **PrizePicks API returns 403** on every call from edge functions (Cloudflare blocks server-side requests). This has been failing consistently — it's not a transient issue.
2. **whale-odds-scraper** fetches tennis from The Odds API but only writes H2H/spreads/totals to `game_bets` — no player-level props (total games, games won, sets, fantasy scores).
3. **tennis-props-sync** reads `unified_props` looking for tennis data that never gets written there.

## Solution — 3-Part Fix

### Part 1: Tennis Props via The Odds API (replace PrizePicks dependency)

The Odds API supports tennis player prop markets. Rewrite `tennis-props-sync` to **scrape tennis props directly from The Odds API** for today's ATP/WTA events, same pattern as the NRFI scanner:

1. `GET /v4/sports/tennis_atp/events` and `GET /v4/sports/tennis_wta/events` — get today's matches
2. For each event, fetch odds with markets: `player_total_games`, `player_games_won`, `player_sets`, `player_total_sets`, `alternate_total_games` (try multiple market keys since naming varies by book)
3. Write results directly into `unified_props` with proper columns (`sport`, `player_name`, `prop_type`, `current_line`, `over_price`, `under_price`, `bookmaker`, `event_id`, `game_description`, `commence_time`)
4. Fallback: also sync any tennis totals already in `game_bets` (existing logic, kept as secondary source)

### Part 2: Fix tennis-games-analyzer column references

The analyzer still references columns that don't exist in `unified_props`:
- `stat_type` → doesn't exist (use `prop_type`)
- `line` → doesn't exist (use `current_line`)
- `fanduel_line` → doesn't exist
- `event_description` → doesn't exist (use `game_description`)
- `opponent` → doesn't exist

Fix all column references to match the actual schema.

### Part 3: Cross-reference and H2H integration

The analyzer already has H2H logic via `tennis_player_stats` lookups. The key props to target:
- **Total games** — primary market, highest liquidity
- **Games won** (per player) — cross-ref with opponent's games-lost averages
- **Total sets** — structural indicator (2-set vs 3-set match)
- **Fantasy scores** — PrizePicks-specific, skip for now since PP is blocked

For each prop, the analyzer cross-references:
- Player's L10 average from `tennis_player_stats`
- H2H history from the same table
- Surface + gender modifiers (already implemented)

## Files

| File | Action |
|------|--------|
| `supabase/functions/tennis-props-sync/index.ts` | **Rewrite** — scrape The Odds API directly for tennis props, fallback to game_bets |
| `supabase/functions/tennis-games-analyzer/index.ts` | **Fix** — correct all column references to match unified_props schema |

## Pipeline Flow After Fix

```text
morning-prep-pipeline
  └─ whale-odds-scraper (full)     ← writes tennis H2H/totals to game_bets
  └─ tennis-props-sync (NEW)       ← fetches tennis props from Odds API → unified_props
  │                                   also syncs game_bets tennis totals → unified_props
  └─ tennis-games-analyzer         ← reads unified_props, cross-refs tennis_player_stats
                                      writes picks to category_sweet_spots + tennis_match_model
```

## What This Unlocks

- Tennis picks will flow automatically whenever ATP/WTA matches are on the board
- No dependency on PrizePicks (which is permanently blocked)
- Total games, games won, and total sets all analyzed with H2H cross-reference
- Self-healing stats loop (settled results update `tennis_player_stats`) already works


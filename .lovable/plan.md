

## Pitcher Strikeout Props from PrizePicks + Historical Cross-Reference

### Current Gaps

1. **PrizePicks scraper excludes MLB** -- the default sports array is `['NBA', 'NHL', 'WNBA', 'ATP', 'WTA']`, so no MLB props (including pitcher Ks) are ever scraped
2. **Stat type mapping is wrong** -- PrizePicks "Strikeouts" maps to `player_strikeouts` (batter stat), not `pitcher_strikeouts` (the prop market key used everywhere else)
3. **No pitcher game log data** -- the `mlb_player_game_logs` table has 24K rows but zero pitcher strikeout data (backfill only pulled batters)
4. **No cross-reference logic** -- nothing compares PrizePicks pitcher K lines against historical L10/L20 averages

### What We'll Build

**Phase 1: Add MLB to PrizePicks Scraper**
- Add `'MLB'` to the default sports array in `pp-props-scraper`
- Add pitcher-specific stat mappings: `'Pitcher Strikeouts' -> 'pitcher_strikeouts'`, `'Strikeouts (Pitching)' -> 'pitcher_strikeouts'`, `'Ks' -> 'pitcher_strikeouts'`
- Context-aware mapping: when league is MLB and stat is "Strikeouts", check if player position contains "P" or "SP" to route to `pitcher_strikeouts` vs `batter_strikeouts`

**Phase 2: Backfill Pitcher Strikeout Data**
- Update `mlb-data-ingestion` to accept a `pitchers_only` mode that specifically targets the pitching box score section
- Run a 2024/2025 season backfill to populate `pitcher_strikeouts` for starting pitchers (~30 teams x 5 starters x 30 starts = ~4,500 pitcher game logs)

**Phase 3: Cross-Reference Engine**
- Create a new edge function `mlb-pitcher-k-analyzer` that:
  1. Fetches today's pitcher K props from `pp_snapshot` (where `stat_type = 'pitcher_strikeouts'` and `sport = 'baseball_mlb'`)
  2. Looks up each pitcher's L10 and L20 strikeout averages from `mlb_player_game_logs`
  3. Computes edge percentage: `(l10_avg - pp_line) / pp_line * 100`
  4. Writes results to `mispriced_lines` table with `confidence_tier` based on edge magnitude
  5. Sends a formatted report via Telegram

**Phase 4: Telegram Command**
- Add `/pitcherk` command to `telegram-webhook` that triggers the analyzer and shows paginated results like the other commands

### Technical Details

**File: `supabase/functions/pp-props-scraper/index.ts`**

- Line 186: Change default sports from `['NBA', 'NHL', 'WNBA', 'ATP', 'WTA']` to `['NBA', 'NHL', 'WNBA', 'ATP', 'WTA', 'MLB']`
- Lines 98-124: Add to `STAT_TYPE_MAP`:
```
'Pitcher Strikeouts': 'pitcher_strikeouts',
'Strikeouts (Pitching)': 'pitcher_strikeouts', 
'Ks': 'pitcher_strikeouts',
'Pitching Strikeouts': 'pitcher_strikeouts',
'Earned Runs Allowed': 'pitcher_earned_runs',
'Hits Allowed': 'pitcher_hits_allowed',
'Outs': 'pitcher_outs',
'Total Bases': 'batter_total_bases',
'Home Runs': 'batter_home_runs',
'Stolen Bases': 'batter_stolen_bases',
```
- In `processExtractedProjections`, add logic: if league is `'MLB'` and stat is `'Strikeouts'` (unmapped generic), default to `'pitcher_strikeouts'` since PrizePicks pitcher K props are the dominant strikeout market

**File: `supabase/functions/mlb-data-ingestion/index.ts`**

- Add `pitchers_only` flag to request body parsing
- When `pitchers_only` is true, only parse the pitching section of ESPN box scores and skip batting lines
- This allows targeted backfill without re-processing all 24K batter rows

**New File: `supabase/functions/mlb-pitcher-k-analyzer/index.ts`**

Core logic:
1. Query `pp_snapshot` for today's `pitcher_strikeouts` props
2. For each pitcher, query `mlb_player_game_logs` for their last 10 and 20 games where `pitcher_strikeouts IS NOT NULL`
3. Calculate L10 avg, L20 avg, median, max, min, hit rate (games over the line)
4. Compute edge: `((l10_avg - pp_line) / pp_line) * 100`
5. Assign confidence tier:
   - ELITE: abs(edge) >= 25% AND hit rate >= 70% (or <= 30% for unders)
   - HIGH: abs(edge) >= 15% AND hit rate >= 60%
   - MEDIUM: abs(edge) >= 8%
6. Upsert into `mispriced_lines` with `sport = 'baseball_mlb'` and `prop_type = 'pitcher_strikeouts'`
7. Send Telegram report with top plays grouped by tier

**File: `supabase/functions/telegram-webhook/index.ts`**

- Add `/pitcherk` command that calls `handlePitcherK(chatId, page)` 
- The handler queries `mispriced_lines` for today's `pitcher_strikeouts` entries
- Paginated display (5 per page) showing: pitcher name, team, line, L10 avg, edge%, hit rate, tier
- Prev/Next inline buttons with `pitcherk_page:N` callback data

**File: `supabase/functions/data-pipeline-orchestrator/index.ts`**

- Add `mlb-pitcher-k-analyzer` to Phase 2 (Analysis) after `high-conviction-analyzer`
- Only runs during MLB season (April-October)

### Execution Order

1. Modify `pp-props-scraper` (add MLB + pitcher stat mappings)
2. Modify `mlb-data-ingestion` (add pitchers_only backfill mode)
3. Create `mlb-pitcher-k-analyzer` (cross-reference engine)
4. Modify `telegram-webhook` (add /pitcherk command)
5. Modify `data-pipeline-orchestrator` (add to Phase 2)
6. Deploy all functions
7. Run pitcher backfill: invoke `mlb-data-ingestion` with `{ "pitchers_only": true, "days_back": 365 }`

### Files Changed

| Action | File |
|--------|------|
| Modify | `supabase/functions/pp-props-scraper/index.ts` |
| Modify | `supabase/functions/mlb-data-ingestion/index.ts` |
| Create | `supabase/functions/mlb-pitcher-k-analyzer/index.ts` |
| Modify | `supabase/functions/telegram-webhook/index.ts` |
| Modify | `supabase/functions/data-pipeline-orchestrator/index.ts` |


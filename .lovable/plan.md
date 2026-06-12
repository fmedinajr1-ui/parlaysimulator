## Why it's broken

Logs from today's run show the root cause clearly:

```
tennis_wta_queens_club_champ: 4/4 events today
Kamilla Rakhimova vs Emma Raducanu: odds 422 — {"message":"Invalid markets: alternate_total_games, player_games_won, player_total_..."}
Odds API scraped: 0 prop lines across 1 sports
```

The Odds API does **not** support player-prop markets for tennis (`player_total_games`, `player_games_won`, `player_total_sets`, `alternate_total_games`). When the function asks for them, Odds API rejects the **entire** request with a 422 — so even the match-level `totals` market that *is* supported gets thrown away. Result: 0 props, 0 prop types, Telegram shows "none".

`pp_snapshot` and `game_bets` are also empty for tennis right now, so neither fallback has anything to add.

## Fix

Update `supabase/functions/tennis-props-sync/index.ts`:

1. **Split market requests into two calls per event** so a bad market never tanks the good one:
   - Call A: player markets (`player_total_games,player_games_won,player_total_sets`)
   - Call B: match totals (`totals` only — drop `total`, `total_games`, they're not valid Odds API keys)
   - Treat a 422 on call A as "player props unavailable for this sport" and silently skip; only call B is required.

2. **Discover supported markets per event** using the `/events/{id}/markets` Odds API endpoint when it's available, and intersect the wanted list with what's offered. Fallback to (1) if discovery fails.

3. **Tighten the WTA/ATP sport classifier** so tournament keys like `tennis_wta_queens_club_champ` map to `tennis_wta` and `tennis_atp_*` to `tennis_atp` (current `.includes("wta")` already works, just verifying).

4. **Improve Telegram message** so when player props are unavailable but totals synced, it reports that explicitly (e.g. `Sources: Odds API totals only — player props unsupported for tennis`) instead of an empty "none".

5. **Log per-market HTTP status** so future failures are obvious in one line.

No DB or schema changes needed. No new secrets.

## Verification (per project rule: 5 independent checks)

After the fix, redeploy and re-run via `supabase--curl_edge_functions`, then confirm:

1. HTTP 200 + JSON `synced > 0` for today's WTA Queen's Club slate.
2. `unified_props` has new rows where `sport='tennis_wta'` and `prop_type='total_games'` with today's timestamp.
3. Edge function logs show `totals` market succeeded for each event (no 422 on totals).
4. Telegram message shows non-empty `Prop types` and `Sports`.
5. A second invocation is idempotent (upsert by `event_id,player_name,prop_type,bookmaker` doesn't duplicate rows).

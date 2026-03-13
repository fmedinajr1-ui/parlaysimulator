

# Fix: Game Markets Missing + Add Odds Display to Scanlines

## Two issues identified

### Issue 1: Game markets (moneylines/totals) not showing in `/scanlines`
**Root cause**: `mispriced_lines` has a unique constraint `(player_name, prop_type, analysis_date)`. The `scanlines-game-markets` function does `DELETE` then `INSERT`, but the insert is silently failing. The logs show "38 actionable signals" with no error, yet the DB has 0 `game_total`/`game_moneyline` rows ever inserted.

**Fix**: Switch from `delete` + `insert` to `upsert` with `onConflict: 'player_name,prop_type,analysis_date'` in `scanlines-game-markets/index.ts`. Also add explicit error logging after the upsert.

### Issue 2: Player props only show line, not odds/juice
**Root cause**: The `/scanlines` handler (lines 1960-2001) displays `book_line` and `edge_pct` but never fetches the FanDuel over/under prices from `unified_props`. The snapshot trail only shows line numbers, not odds movement.

**Fix**: In `handleScanLines`, after fetching mispriced player props, also query `unified_props` for matching FanDuel entries to get `over_price`/`under_price`. Display them inline (e.g., `O 10.5 (-110/-130)`). Also add odds to the snapshot trail display from `game_market_snapshots` for game markets.

## Implementation

### File 1: `supabase/functions/scanlines-game-markets/index.ts`
- Replace the `delete` + `insert` pattern (~lines 338-347) with `upsert` using `onConflict`
- Add verbose error logging if upsert fails

### File 2: `supabase/functions/telegram-webhook/index.ts` — `handleScanLines`
**Player props section (~line 1924-2001):**
- After fetching mispriced lines, query `unified_props` for matching `player_name`, `prop_type` where `bookmaker ILIKE '%fanduel%'` to get `over_price`/`under_price`
- Display odds alongside the line: `PTS O 10.5 (O:-110 / U:+105)`

**Game markets section (~line 1852-1921):**
- For moneylines: display FanDuel home/away odds from `game_market_snapshots` (already fetched as `gmSnapshots`)
- For totals: display over/under odds
- Show odds drift trail where multiple snapshots exist (e.g., `-110 → -130`)

### Total scope
~40 lines changed across 2 files + redeploy both functions.


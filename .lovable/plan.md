## Why `book_id` is NULL

The chain that's supposed to populate it:

```
The Odds API (live MLB h2h)
  → market_snapshot (market_type='live_ml', sportsbook=<book>)
    → scout-live-edge pulls latest snapshot for the game
      → mlb_fair_price_events.book_id = <book>
```

What I found in the DB:
- `market_snapshot` has zero rows with `market_type='live_ml'` (only `player_pts` and `player_ast`).
- `team_moneyline_odds` and `odds_snapshots` also have zero MLB rows in the last 24h.
- All 38 fair-price events in the last 24h were logged with `gate_decision='skip'`, `skip_reason='no_book_or_suspended'`. That's `scout-live-edge` saying "I have no book line for this game," so it writes the event with `book_id=null`.

So the NULLs are honest — there is literally no live MLB moneyline being ingested anywhere in the system today. The existing `fetch-team-moneylines` function knows how to hit The Odds API for `baseball_mlb` h2h but writes to `team_moneyline_odds` (pre-game only, different table, different `game_id` format), so the fair-price evaluator never sees it.

## Fix

### 1. New edge function: `mlb-live-ml-bridge`
- Hits `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?regions=us&markets=h2h&oddsFormat=american` every 30s.
- Joins each event to today's MLB Stats API schedule by home/away team name to resolve `gamePk`.
- For each `(event, bookmaker)`, inserts two rows into `market_snapshot`:
  - `game_id='mlb_<gamePk>'`, `market_type='live_ml'`, `sportsbook=<bookmaker.key>`, `player_name=<home_team>`, `odds=<home_price>`, `captured_at=<bookmaker.last_update>`
  - same for the away outcome.
- This is the exact shape `scout-live-edge` already reads (lines 89–115 of that file): it sorts by `captured_at desc`, takes the top two rows for the same sportsbook, de-vigs the two prices, and sets `book.bookId = top.sportsbook`. Result: `book_id` is populated on every event going forward.

### 2. Schedule
- pg_cron job `mlb-live-ml-bridge-30s` calling the bridge every 30s during MLB hours (10:00–02:00 ET). Inserted via `supabase--insert` (not a migration), per the platform rule that cron URLs/keys aren't migrated.

### 3. Hard Rock note
The Odds API US region returns FanDuel, DraftKings, BetMGM, Caesars, ESPNBet, Fanatics, BetRivers — **not Hard Rock**. Hard Rock would need a separate scraper (Hard Rock has no public odds API). For now the bridge will fill book_id for the supported books; Hard Rock will continue to show "missing" in the pre-game alert until a Hard Rock scraper is added (separate ticket).

### 4. Verify
- Run the bridge once manually, then query `market_snapshot WHERE market_type='live_ml'` to confirm rows landed.
- Wait one event cycle and confirm `mlb_fair_price_events.book_id IS NOT NULL` for new rows.
- Pre-game Telegram alert's per-book latency table will start showing real numbers automatically.

## Requirements
- `THE_ODDS_API_KEY` secret — already exists (used by `fetch-team-moneylines`), no new secret needed.

## Out of scope
- Hard Rock ingestion (no public API).
- Backfilling historical `book_id` NULLs — past events stay null; only new events get tagged.
- Any change to the fair-price gate logic.

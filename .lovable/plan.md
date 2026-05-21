## Full Report: Stale-Game Legs in Cross-Sport Parlays

### What the user saw

Casey Mize (Detroit Tigers SP) appears in 4 of the 9 cross-sport parlays broadcast today, with picks like "Earned Runs UNDER 1.5", "Hits Allowed UNDER 5.5", "Strikeouts OVER 2.5". User says Detroit isn't playing today.

### What the data shows

`unified_props` does have rows for `Cleveland Guardians @ Detroit Tigers`, event `427339d86…`, with `commence_time = 2026-05-21 17:11:00 UTC` (1:11 PM ET). The generator ran at **19:54 UTC (3:54 PM ET)** — the game's first pitch was **2h43m before the parlay was built**. The game is either live or already final. Either way it has no business being in a pre-game parlay drop.

Scaled view of the same bug:
- **2,420** active MLB rows in `unified_props`
- **776 (32%)** have `commence_time < now()` — i.e. already started
- After sweet-spots ran, **44 of 56** active legs (79%) came from games that have already started
- Cross-sport generator has no `commence_time` filter, so it freely combined those stale legs

### Root causes

1. `unified_props.is_active` is not flipped to `false` when a game starts. The odds-feed worker keeps the row "active" because the book still lists settled props for in-progress games.
2. `cross-sport-sweet-spots` selects `is_active=true` with **no time filter**, so live + finished games leak in.
3. `cross-sport-parlay-generator` trusts the candidate pool — same gap.
4. Pitcher legs additionally need a confirmed-starter check. Today's Mize legs survived even though we have no signal he was actually the starter.
5. L10 hit rate of 1.0 on every Mize line is suspicious — pitchers with <10 starts in the log table get auto-perfect scores because the floor/median math treats small `values.length` as gospel. (Secondary issue, but worth fixing in the same pass.)

### Plan to fix

**1. Hard cutoff on `commence_time`** (the actual user-visible bug)
   - In `cross-sport-sweet-spots`: only pull props where `commence_time > now() + INTERVAL '15 minutes'` (15-min buffer so we don't include a game about to start during the run). Log dropped count per sport.
   - In `cross-sport-parlay-generator`: belt-and-suspenders — re-check `commence_time` on every leg pulled from `cross_sport_sweet_spots`, drop and warn on any stale one.

**2. Confirmed-starter gate for MLB pitcher props**
   - Add a join against `mlb_probable_pitchers` (or whatever table the existing MLB pipeline uses — confirm during implementation). If the player isn't today's listed starter for either team, drop the leg.
   - Same pattern, looser, for NHL goalie props (use `nhl_starting_goalies`).

**3. Min-sample-size gate**
   - Require `values.length >= 5` for player legs before trusting L10-derived `safety`. Below 5, fall back to de-juiced implied probability only and cap `tier` at `lean` (no locks/strongs from thin data).

**4. Stale-row hygiene at the source**
   - Add a 5-min cron job that flips `unified_props.is_active = false` when `commence_time < now() - INTERVAL '5 minutes'`. This stops every downstream engine (not just cross-sport) from inheriting the same bug.

**5. Post-broadcast audit**
   - In `cross-sport-parlay-generator`, after persisting tickets, re-query each leg's `commence_time` and write a row to `bot_audit_log` with `kind='cross_sport_stale_check'` plus counts. If any stale leg slipped through, send admin-only Telegram alert.

**6. Re-run today**
   - Mark today's 9 `cross_sport_*` rows in `bot_daily_parlays` as voided (`status='voided'`, `void_reason='stale_pregame_data'`).
   - Re-run research → sweet-spots → generator with the fixes in place, broadcast a corrected drop with a "Replaces earlier drop — stale game data filtered" header.

**7. Tests** (5, per project rule)
   - sweet-spots: rejects rows with `commence_time < now()+15m`
   - sweet-spots: rejects pitcher leg when player not in probable starters
   - sweet-spots: caps tier at `lean` when L10 sample < 5
   - generator: re-filters stale legs from candidate pool
   - cron: `is_active` flip leaves future games untouched

### Out of scope for this pass

- Fixing the upstream odds-feed worker to mark `is_active=false` proactively (the 5-min cron in step 4 is the safety net; rewiring the worker is a separate ticket).
- Reworking team-leg pool (NHL/NBA still empty because of game-log joins — already in the backlog from the previous run).
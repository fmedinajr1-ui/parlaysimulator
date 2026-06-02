
## What's wrong

Lottery is picking **two NBA games that share the same team in the same time window**:

```
basketball_nba  New York Knicks @ San Antonio Spurs       2026-06-04 00:30 UTC
basketball_nba  New York Knicks @ Oklahoma City Thunder   2026-06-04 00:40 UTC
```

Only one of these is a real game tonight (Knicks @ Spurs in the NBA Cup / postseason). The Knicks @ OKC entry is stale/duplicate junk from the odds feed but unified_props happily stores it. Lottery then ladders BOTH games, picks OKC twice (h2h + spread), and ships an impossible parlay.

This stacks on top of the same-game / odds-missing bugs from the previous message.

## Fix scope (lottery-1500-builder + broadcaster mapping only)

### A. `supabase/functions/lottery-1500-builder/index.ts`

1. **Team-uniqueness scrub at pool build (NEW — fixes the OKC ghost game).**
   For each team-market sport (NBA / WNBA / NHL / NFL), group rows by `(sport, team, calendar_day_ET)`. If a team appears in >1 distinct `game_description` on the same ET day, keep only the row whose `commence_time` is closest to the *earlier* game in that team's schedule (canonical source: `live_game_scores` if a row exists for that team+date; otherwise drop ALL ambiguous entries — fail-closed). Tag dropped rows with a `pool_drop:duplicate_team_schedule` counter returned in the response payload.

2. **Canonical game key for same-game dedupe.** `event_id` in unified_props is suffixed (`..._h2h`, `..._spread`, `..._total`), so the current per-game cap never triggers. Add `canonicalGameId(row)` = strip `_h2h|_spread|_total|_outright` suffix, fallback to `game_description`. Use it everywhere `event_id` is compared in `noConflict`, `distinctGames`, and the dup-player check. Also block ANY two non-player legs on the same canonical game (today only blocks identical market_type).

3. **Persist broadcaster-friendly fields** on the inserted leg JSON:
   - `american_odds: l.american` (broadcaster reads this, not `american`)
   - `confidence: l.safety`
   - `team` / `opponent` parsed from `game_description.split(" @ ")` (HOME → idx 1, AWAY → idx 0)
   This fixes the `(n/a)` odds + `EV +0.00u` + ugly `h2h HOME 0` rendering.

4. **Blacklist junk markets** in `buildCandidatesFromRow`:
   - Drop `prop_type ∈ { pitcher_record_a_win, batter_first_home_run, first_to_score }` and any `anytime_*_first` novelty.
   - For `market_type === "player"`: require `american >= -600` (no Trea Turner Hits 0.5 chalk).
   - For OVER 0.5 on count-stat props (hits / HR / SB / RBI / steals / blocks): require `american >= -250`.

### B. `supabase/functions/parlay-engine-v2-broadcast/index.ts`

Tiny label fix so lottery-style legs read cleanly:
- `prop_type === "h2h"` → render `"ML"`; `prop_type === "spreads"` → render `"Spread"`; `market_type === "outright"` → render `"<player_name> to win <game_description>"`.

## Verification (admin-only sandbox first)

1. Deploy both functions.
2. `POST /lottery-1500-builder?dry=true&skip_research=true` and inspect JSON:
   - `pool_drop.duplicate_team_schedule > 0` for NBA (Knicks ghost game gone).
   - No two legs share `canonical_game_id`.
   - Every leg has numeric `american_odds`.
   - No `pitcher_record_a_win` legs.
3. Trigger non-dry. Telegram drop should show real odds (no `(n/a)`), clean `Team ML / Team Spread` labels, and a single NBA game (Knicks @ Spurs only, not OKC).

## Out of scope

- Upstream odds-feed dedupe (root cause of the ghost OKC game lives in the sync, not the builder) — handled defensively here for now; can be promoted to the team-markets-sync layer in a follow-up.
- Outrights sync, parallel research, cron schedule — already in place.

# Nuke Parlay Scout — Phase 2: Rosters + Real Builder + 4-Sport Rollout

Active sports for posting this phase: **NBA (Finals), MLB, Soccer, Tennis.** Phase 1 NBA-only scorer/builder stays as the base; Phase 2 adds the missing roster lookup, swaps the placeholder builder for the full template engine, and turns on the other three sports.

Tennis is the odd one out — it has no "favorite team blowout" script. We adapt it to a tennis-native pattern (heavy ML favorite vs. dog → games-handicap + total-games + service-hold templates) rather than forcing the team-sport templates onto it. Spec'd below.

## Sanity check first (read-only)

Before writing code, planner runs:

```sql
-- NBA Finals slate
select count(*) from game_bets where sport='basketball_nba' and is_active=true and commence_time > now();
-- MLB
select count(*) from game_bets where sport='baseball_mlb' and is_active=true and commence_time > now();
-- Soccer (any league key starting with soccer_)
select sport, count(*) from game_bets where sport like 'soccer_%' and is_active=true and commence_time > now() group by sport;
-- Tennis
select sport, count(*) from game_bets where sport like 'tennis_%' and is_active=true and commence_time > now() group by sport;
-- Player props per sport
select sport, count(*) from unified_props where sport in ('basketball_nba','baseball_mlb') or sport like 'soccer_%' or sport like 'tennis_%' group by sport;
```

If any sport returns 0 we tell you before turning that sport on. Tennis specifically: existing memory `mem://logic/stats/tennis-data-sync` warns the Odds API only carries top-tier ATP/WTA — we surface that ceiling.

## Database — one new migration

Migration: `rosters` table per Phase 2 spec (cross-sport, no unique constraint, `(sport, player_name_normalized)` and `(sport, team)` indexes, RLS service-role full + admin read). MLB/Soccer/Tennis rows are populated even though tennis "team" is just the player's country/tour — we store it so the builder has a consistent contract.

For tennis we treat each player as their own "team" — the builder pivots on favorite/dog from `nuke_game_scores` instead of star/role.

## Shared module: `supabase/functions/_shared/rosters.ts`

Per your spec — `normalizeName`, `EspnRosterSource`, `RosterClient` with `sync` / `lookupTeam` / `lookupTeamsBatch` / `clearCache`, three-tier matching, 24h cache, delete-then-insert chunks of 500, throws on 0-row source.

Sport map for ESPN: `nba|wnba|ncaab|nfl|ncaaf|nhl|mlb|soccer`. Tennis has no ESPN roster equivalent — `RosterClient.sync('tennis')` short-circuits to a no-op, and the builder uses player names directly from `unified_props.player_name`.

Soccer rosters: ESPN soccer endpoint requires a league key (e.g. `eng.1`, `usa.1`). We sync the leagues we actually post — defaulted to a curated list; configurable via env `NUKE_SOCCER_LEAGUES`.

## Shared module: `supabase/functions/_shared/parlayBuilder.ts`

Exports `buildParlays(game, props, script, options)`, `combinedOdds(legOdds[])`, `fetchEspnInjuries(sport)`.

### Template matrix (Phase 2 active subset)

| sport  | STRONG                                     | MEDIUM                       |
|--------|--------------------------------------------|------------------------------|
| nba    | role_player_over_carnage, mixed_chaos      | role_player_over_carnage     |
| mlb    | ace_domination                             | —                            |
| soccer | possession_dominance                       | —                            |
| tennis | dominant_hold_squad, fav_handicap_combo    | total_games_under            |

NBA / MLB / Soccer templates implemented exactly per your Phase 2 spec. The tennis templates are new and live alongside.

### Tennis templates (new — tennis-specific, since blowout-script doesn't apply)

Inputs come from `unified_props` markets like `player_aces`, `player_double_faults`, `player_total_games_won`, plus `game_bets` rows for set/match handicap and totals.

- **`dominant_hold_squad`** (STRONG only — heavy ML favorite ≤ -350 on bo3, ≤ -500 on bo5):
  1. Favorite OVER aces (top alt with juice in [-140, -100]) — favorites serving more, finish quicker.
  2. Favorite OVER total games won (line ≥ favorite's L3 surface mean from `court-edge-prior`).
  3. Dog UNDER aces (less serving time when getting broken).
  4. Match total games UNDER (priors from `_shared/court-edge-prior.ts`).
  5. Favorite -3.5 / -4.5 game handicap OVER (whichever lands juice in [-140, -100]).
- **`fav_handicap_combo`** (STRONG): same as above but legs 1+2 swapped for two different handicap rungs (-2.5 + -4.5) when only one set of player props is available — common on Odds API tennis where player markets are thin.
- **`total_games_under`** (MEDIUM, single-parlay): five legs across two-three matches on the slate where total < surface prior by ≥ 1.5 games — pairs UNDER total games legs across matches with tight juice, so it's a cross-game build and the 5-unique-leg dedupe is by `(eventId, market)` instead of player.

Tennis uses tournament tier from `_shared/court-edge-tournament-tier.ts` to gate STRONG: ITF/Challenger never produce STRONG (`auto_quarantine`).

### Hard rules (apply across all sports)

- Reject any leg with juice worse than -140 on the picked side.
- 5 legs, unique key per template (player for team sports, `eventId|market` for tennis MEDIUM).
- Combined American odds in [+1000, +3000].
- Cross-template dedupe via leg-set signature.
- Drop snapback / live_drift signals (project core blacklist).
- `has_real_line` validated on every leg.
- Telegram property names: full English (Points, Rebounds, Total Bases, Aces, Total Games Won) — never abbreviations.

## Wiring into existing functions

### `nuke-score-games` — generalize from NBA-only to multi-sport

- Loop over a sport list: `['basketball_nba', 'baseball_mlb', 'soccer_*', 'tennis_*']`. Soccer/tennis expanded by reading distinct active `sport` values from `game_bets`.
- Per-sport scoring rubric (kept simple — same 0–100 surface, different inputs):
  - **NBA**: unchanged (spread / favML / gap / juice).
  - **MLB**: favorite ML pts (heavier weight — MLB blowouts driven by pitcher mismatch), team-total gap pts, juice from pitcher K/outs OVER and dog hitter total-bases UNDER.
  - **Soccer**: favorite ML pts, draw-no-bet handicap pts, total-goals OVER juice as gap proxy.
  - **Tennis**: ML pts (heavy bar — ≤ -350 bo3 / ≤ -500 bo5 = STRONG eligible), tournament-tier gate, surface-prior gap (book total vs prior).
- Uses `RosterClient.lookupTeam` only for NBA (team-sport role/star bucketing). Other sports score off market data only.

### `nuke-build-parlays` — swap inline loop for shared builder

- Calls `fetchEspnInjuries(sport)` once per sport (skipped for tennis — ESPN has no tennis injury feed; tennis withdrawals come from Odds API event status).
- For NBA props missing a team, calls `rosterClient.lookupTeamsBatch(...)` and drops props that still can't be team-matched (count logged to `nuke_run_log.errors.lookups_failed`).
- Calls `buildParlays(game, props, script, { injuries })` and posts via existing `bot-send-telegram` (admin chat, Markdown, dedupe via `posted_to_telegram`).

### New function: `nuke-sync-rosters`

Iterates `['nba', 'mlb', 'soccer:<league>']` (tennis short-circuits) and calls `rosterClient.sync(sport)`. Logs to `nuke_run_log` with `phase='sync_rosters'`. Errors per sport are non-fatal.

### `nuke-grade-results` — grader extensions

- NBA: unchanged (uses `nba_player_game_logs` + `live_game_scores`).
- MLB: pulls per-player batting/pitching from existing MLB stat tables; final score from `live_game_scores`.
- Soccer / Tennis: graded via Odds API event-results endpoint (cheap, single call per finished match) since we don't have detailed per-player stat tables for these sports yet. If results unavailable at grade time, leg stays `pending` and re-grades next run.

## Cron additions (via `supabase--insert`, NOT migration — per project rule)

- `nuke-sync-rosters` daily at **08:00 UTC (4:00 AM ET)**.
- Existing `nuke-score-games` 21:00 UTC stays — but now scans all 4 sports.
- Existing `nuke-grade-results` 16:00 UTC stays.
- Add a second `nuke-grade-results` pass at **04:00 UTC** to catch late soccer/tennis matches that finish after 11 AM ET (Europe-evening soccer, Asian-swing tennis).

## Acceptance verification (project's 5-test rule)

1. `nuke-sync-rosters` populates rosters for NBA (~500), MLB (~1200), 1+ soccer league (~500). Tennis short-circuits cleanly. Re-run idempotent; forced-empty source does NOT wipe.
2. NBA Finals scorer run → STRONG game produces 2 parlays (role + chaos), 5 unique players each, combined odds in band, ESPN injuries excluded.
3. MLB scorer run → STRONG ace-mismatch game produces 1 ace_domination parlay, pitcher K/outs OVER + 3 hitter total-bases UNDER, combined odds in band.
4. Soccer scorer run on a heavy fav (e.g. PSG -400) → 1 possession_dominance parlay, posts to Telegram with full English market names.
5. Tennis scorer run on a STRONG match (Sinner -500 vs qualifier) → 1 dominant_hold_squad parlay, ITF auto-quarantine path verified by injecting a fake ITF event and confirming no parlay built.

## Files to be created / edited

- new `supabase/migrations/<ts>_rosters_table.sql`
- new `supabase/functions/_shared/rosters.ts`
- new `supabase/functions/_shared/parlayBuilder.ts`
- new `supabase/functions/_shared/parlayBuilder.tennis.ts` — keeps tennis templates isolated from team-sport builder
- new `supabase/functions/nuke-sync-rosters/index.ts`
- edit `supabase/functions/nuke-score-games/index.ts` — multi-sport loop + per-sport scoring rubric
- edit `supabase/functions/nuke-build-parlays/index.ts` — call shared builder, fetch injuries, roster lookups
- edit `supabase/functions/nuke-grade-results/index.ts` — MLB / soccer / tennis grading paths
- edit `mem/logic/parlay/nuke-scout.md` — Phase 2 scope (4 sports, templates, tennis adaptation)
- edit `mem/index.md` — bump Nuke Scout entry
- `supabase--insert` — register `nuke-sync-rosters` 08:00 UTC + second grader pass 04:00 UTC

## Explicitly NOT in this build

- WNBA / NFL / NCAAF / NCAAB / NHL templates (coded but disabled — no posting).
- Paid-provider fallback for ESPN downtime.
- Official NBA injury report scrape (Phase 3).
- Per-player stat tables for soccer / tennis grading (using Odds API results endpoint instead this phase).
- Backtest engine, admin tuning UI, dedicated Telegram group.

Approve and I'll switch to build mode, starting with the 4-sport slate sanity check.

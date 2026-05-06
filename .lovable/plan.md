# Nuke Parlay Scout — NBA MVP

A new "blowout script" engine that scans NBA slates for big-spread games, scores them 0–100, builds 5-leg correlated player-prop parlays from script-specific templates, and posts them to the existing admin Telegram chat. Built on top of your existing platform — reuses `upcoming_games_cache`, `unified_props`, `team_moneyline_odds`, `bot-send-telegram`, and the cron orchestrator.

## What this is (in one line)

When the book heavily juices star UNDERS and role-player OVERS in 10+ point spread games, that's the market pricing in garbage time — Nuke bets with that signal across 5 correlated legs.

## Scope of this build (Phase 1)

- **NBA only.**
- **Live forward-test** to existing admin Telegram chat (no separate group, no shadow mode).
- **Reuses** existing odds + props ingestion. No new ingestion functions.
- Backtest engine, additional sports, dedicated Telegram group, and admin tuning UI are explicitly **out of scope** for this phase.

## Data model — one new namespace, four tables

All prefixed `nuke_` so it stays isolated from existing engines and accuracy tracking. Standard RLS: admin read, service-role write. Eastern Time everywhere (per project core rule).

- **`nuke_game_scores`** — one row per NBA game per slate date.
  Fields: `game_id` (fk to existing `upcoming_games_cache`/`game_bets`), `game_date`, `home_team`, `away_team`, `commence_time`, `home_spread`, `away_spread`, `total`, `home_ml`, `away_ml`, `favorite_team`, `dog_team`, `spread_pts`, `ml_pts`, `gap_pts`, `juice_pts`, `script_score`, `script_tier` (`strong|medium|weak|skip`), `juice_signal_count`, `computed_at`.

- **`nuke_parlays`** — one row per generated parlay.
  Fields: `game_id`, `script_tier`, `template` (`role_player_over_carnage|mixed_chaos|star_under_squad`), `legs` (jsonb: `[{player, team, prop_type, line, side, odds, juice_ok}]`), `combined_odds_american`, `combined_odds_decimal`, `posted_to_telegram` (bool), `telegram_message_id`, `created_at`.

- **`nuke_results`** — per-parlay outcome (filled by next-morning grader).
  Fields: `parlay_id`, `outcome` (`won|lost|pending|void`), `legs_hit`, `final_score_home`, `final_score_away`, `margin`, `was_blowout` (margin ≥ 10), `graded_at`.

- **`nuke_run_log`** — every cron pass: `run_at`, `phase` (`score|build|grade`), `games_scanned`, `strong_count`, `medium_count`, `parlays_built`, `parlays_posted`, `errors` jsonb. Mirrors the diagnostics pattern used elsewhere.

## Edge functions (3 new)

1. **`nuke-score-games`** — daily 4:00 PM ET.
   - Pulls today's NBA games + market lines from `upcoming_games_cache` / `team_moneyline_odds` (no Odds API quota burn — your platform already ingests these).
   - Pulls all NBA player props from `unified_props` for those games.
   - Computes `script_score` per spec (Spread 40 / ML 30 / Gap 20 / Juice 10).
   - Tier mapping: 80+ STRONG, 60–79 MEDIUM, 40–59 WEAK (logged, not posted), <40 skipped.
   - Hard floors enforced for STRONG: spread ≥ 10, fav ML ≤ -400, implied gap ≥ 12.
   - Upserts into `nuke_game_scores`, then immediately invokes `nuke-build-parlays` for any game ≥ MEDIUM.

2. **`nuke-build-parlays`** — invoked by scorer; can also run standalone.
   - For each STRONG game: build **2** parlays (Role Player OVER Carnage + Mixed Chaos).
   - For each MEDIUM game: build **1** (Role Player OVER Carnage only — highest historical confidence per spec).
   - Star UNDER Squad reserved for STRONG games where juice_signal_count ≥ 4.
   - Selection rules per template (NBA only, role-player band 17.5–28.5 PRA / points lines):
     - Skip any leg with worse than -140 juice on the picked side.
     - No duplicate player across legs in the same parlay.
     - 5 legs each, combined odds must land in **+1000 to +3000** (reject + retry with next-best leg pool, up to N attempts; if still out of band, skip the parlay and log it).
     - Cross-check existing project rules: drop any player flagged in `bot_owner_rules` poison sets, drop snapback/live_drift signals (project core rule).
   - Inserts into `nuke_parlays`, then calls Telegram sender.

3. **`nuke-grade-results`** — daily 11:00 AM ET next day.
   - For each pending parlay where the game is final, pull final scores from existing `live_game_scores` / `team_game_results` and per-player stats from `nba_player_game_logs`.
   - Mark each leg hit/miss, set parlay `outcome`, compute `margin` and `was_blowout`.
   - Writes to `nuke_results`. Pure DB — no Telegram noise.

All three are wrapped in try/catch around every Supabase call (project core rule), use ET helpers from `src/lib/dateUtils.ts` server-side equivalents, and `has_real_line` validation on every leg before inserting (project core rule).

## Cron wiring

Adds to existing `pg_cron` schedule via `supabase--insert` (not migration):

```text
nuke-score-games     →  '0 21 * * *'    (4:00 PM ET = 21:00 UTC during EST; use America/New_York handler in fn)
nuke-grade-results   →  '0 16 * * *'    (11:00 AM ET = 16:00 UTC)
```

The 8 AM "pull next 24h games" step from the spec is **not** needed — your platform already ingests this via existing pipeline. Nuke just reads.

## Telegram output

Posts via existing `bot-send-telegram` (admin_only, Markdown). One message per game, both parlays in the same message. Format per spec, with project standards applied:

- Full property names ("Points", "Rebounds", "Pts+Reb+Ast"), never abbreviations (project core rule).
- Bold player names, code blocks for the 5-leg list.
- Footer: "Sizing: 1 unit max per parlay. Script bet, not a lock. ~5–8% historical hit rate at these prices."
- A pinned-message-style group rules block is **not** auto-posted (you can pin manually).

## What is explicitly NOT in this build

- No new ingestion from The Odds API (your platform already covers it).
- No backtest engine, no historical replay over 90 days.
- No admin tuning dashboard, sport toggles UI, or threshold sliders.
- No new Telegram group / chat ID.
- No injury feed integration, no line-movement alerting.
- No additional sports (NFL/NCAA/NHL/MLB/Soccer/WNBA) — Phase 2.
- Combined parlays auto-graded only; no manual override UI.

## Technical notes section

- **Reusing inputs**: scorer reads from `upcoming_games_cache` (games + spreads/totals), `team_moneyline_odds` (MLs), `unified_props` (player lines + over/under odds). If any of these are empty for the slate, scorer logs `no_data` to `nuke_run_log` and exits clean — no false alerts.
- **Juice signal computation**: "star" = top 2 lines per team in the game's prop pool; "role player" = lines 17.5–28.5 in points or PRA. Signal counted when star UNDER ≤ -120 OR role OVER ≤ -120.
- **Implied gap**: `(total/2 + spread/2) − (total/2 − spread/2) = spread`. Spec calls it a separate signal but mathematically it's redundant with spread for a fixed total — kept as a separate component to preserve spec scoring weights, computed exactly as spec describes.
- **Combined odds calc**: convert each American → decimal, multiply, convert back to American. Reject + retry if out of [+1000, +3000].
- **Idempotency**: `nuke_game_scores` unique on `(game_id, game_date)`; `nuke_parlays` unique on `(game_id, template)` — re-running scorer/builder on the same slate updates rather than duplicates.
- **Telegram dedupe**: parlay only posts when `posted_to_telegram = false`; sender flips it on success and stores `telegram_message_id`.

## Files to be created / edited

- `supabase/migrations/<ts>_nuke_scout_schema.sql` — 4 tables + RLS + indexes.
- `supabase/functions/nuke-score-games/index.ts` — new.
- `supabase/functions/nuke-build-parlays/index.ts` — new.
- `supabase/functions/nuke-grade-results/index.ts` — new.
- `supabase/insert` (cron) — register two `pg_cron` entries.
- `mem://logic/parlay/nuke-scout.md` — new memory file documenting thresholds, templates, and odds band so future changes respect them. Index updated.

## Acceptance check (project's 5-test rule)

After deploy, manual verification before declaring shipped:
1. Score a slate with no qualifying games — no Telegram fires, run log shows `strong=0, medium=0`.
2. Score a slate with one STRONG game — exactly 2 parlays generated, both posted, both within +1000/+3000.
3. Score a slate with one MEDIUM game — exactly 1 parlay (Role Player OVER Carnage), posted.
4. Re-run scorer on same slate — no duplicate parlays, no duplicate Telegram posts.
5. Run grader on a settled slate — outcomes filled, `was_blowout` correct, no errors in run log.

Approve and I'll switch to build mode.
---
name: Nuke Parlay Scout (NBA)
description: NBA blowout-script engine — scoring weights, hard floors, templates, and odds band for nuke-score-games / nuke-build-parlays / nuke-grade-results
type: feature
---

Phase 1 scope: NBA only. Posts to admin Telegram via bot-send-telegram. Runs daily at 21:00 UTC (score+build) and 16:00 UTC (grade).

## Tables
- `nuke_game_scores` (unique on game_id+game_date)
- `nuke_parlays` (unique on game_id+template+game_date)
- `nuke_results` (unique on parlay_id)
- `nuke_run_log` (per-phase diagnostics)

## Inputs (do NOT add new ingestion)
- Spread/total/h2h: `game_bets` where sport='basketball_nba', is_active=true
- Player props: `unified_props` where sport='basketball_nba', bookmaker='fanduel', is_active=true
- Final scores: `live_game_scores` (event_id == game_id, game_status ~ /final/i)
- Player stats: `nba_player_game_logs` (player_name + game_date)

## Script score (0–100)
- Spread (40 max): 14+ → 40, 10–14 → 35, 7.5–10 → 25, 5–7.5 → 10, <5 → 0
- Favorite ML (30 max): -700+ → 30, -400/-700 → 25, -250/-400 → 20, -150/-250 → 10, weaker → 0
- Implied gap (20 max, == |spread| in NBA): 15+ → 20, 12–15 → 15, 8–12 → 10, 5–8 → 5
- Juice signal count (10 max): 4+ → 10, 2–3 → 5

## Tier hard floors
- STRONG requires score ≥ 80 AND |spread| ≥ 10 AND favML ≤ -400 AND gap ≥ 12 → fires 2 parlays
- MEDIUM requires score ≥ 60 → fires 1 parlay (Role Player OVER Carnage only)
- WEAK 40–59: logged, NOT posted
- <40: skipped

## Templates active in Phase 1
- `role_player_over_carnage` — 5 player_points / PRA OVER legs with line in 17.5–28.5
- `mixed_chaos` and `star_under_squad` are coded but disabled until reliable per-player team mapping exists

## Hard rules
- Reject any leg with juice WORSE than -140 on the picked side
- No duplicate player across legs in same parlay
- Combined American odds MUST land in [+1000, +3000] — assemble() retries with swaps; if no combo lands in band, parlay is skipped and logged
- Star/Live drift / snapback signals are not used here (project core blacklist)
- Property names in Telegram: full English ("Points", "Rebounds", "Points + Rebounds + Assists") — never abbreviations

## Telegram
- Posts via `bot-send-telegram`, parse_mode Markdown, admin_only (default), reference_key `nuke-{game_id}-{date}`
- One message per game, all parlays bundled
- `posted_to_telegram` flag prevents re-posting on idempotent re-runs

## Out of scope (Phase 2+)
- NFL / NCAAB / NCAAF / NHL / MLB / WNBA / Soccer
- Backtest engine, admin tuning UI, dedicated Telegram group, injury-feed auto-skip, line-movement alerts

## Acceptance verification (per project's 5-test rule)
1. Empty slate → no Telegram, run_log strong=0
2. STRONG game with sufficient props → 1 parlay built+posted, combined in [+1000,+3000]
3. MEDIUM game → 1 parlay (role_player_over_carnage) posted
4. Re-run scorer same slate → no duplicate parlays, no duplicate Telegram posts
5. Grader on settled slate → outcomes filled, was_blowout correct
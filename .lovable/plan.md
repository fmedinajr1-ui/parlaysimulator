## Problem

The Ladder Challenge cron (`daily-ladder-challenge`, runs 14:30 ET) is still firing, but the `nba-ladder-challenge` function only scans **NBA** sweet spots. The NBA regular season ended — last successful lock was **May 7**, and every run since hits the "no candidates" branch and exits silently. Result: no daily Lock has gone to Telegram in two weeks.

Today's data confirms the gap:
- NBA sweet spots ≥70% on 2026-05-21: **0**
- MLB sweet spots ≥70% on 2026-05-21: **3** (RBI Under), plus 70+ active MLB pitcher-K / RBI sweet spots in the all-time pool
- Active props in `unified_props`: NBA 217, **MLB 1,987**, NHL 9

The function also short-circuits hard on its 90% hit-rate + floor-above-line gates — in-season that's fine, off-season it guarantees zero output.

## Goal

Send **one Lock of the Day to Telegram every day**, sourced from whichever in-season sport has the strongest safety-scored single pick. Never silently skip — if the top tier is empty, drop to a clearly labeled lower tier rather than send nothing.

## Plan

### 1. Rename + generalize the function
Rename behavior (keep the route `nba-ladder-challenge` to avoid breaking the cron) to a **multi-sport** "Ladder Lock of the Day" engine. Internally drive off a `SPORT_ADAPTERS` list executed in priority order based on what's in season:

- **MLB** (primary right now): pull from `category_sweet_spots` where `category LIKE 'MLB_%'`, join `mlb_player_game_logs` for L10 floor/median/hit-rate, match against active `unified_props` (`sport='baseball_mlb'`) for the live line. Reuse the existing RBI-Under / Pitcher-K under/over categories already populated.
- **NBA**: existing path, only runs if NBA sweet spots return ≥1 row.
- **NHL**: pull `NHL_POINTS / NHL_GOALS_SCORER / NHL_ASSISTS` sweet spots, match against `unified_props` (`sport='icehockey_nhl'`).

Each adapter returns `LockCandidate[]` with the same shape and safety-score breakdown the current function uses.

### 2. Tiered safety gates (never return empty)
Run candidates through three tiers in order; first tier with ≥1 pick wins, and the pick is labeled accordingly in Telegram:

| Tier | Hit rate | Floor margin | Median clearance | Label |
|------|----------|--------------|------------------|-------|
| Lock | ≥90% | floor > line | median ≥ line + 1 | "🔒 Lock of the Day" |
| Strong | ≥80% | floor ≥ line | median ≥ line | "💪 Strong Play of the Day" |
| Lean | ≥70% | — | avg ≥ line | "📈 Lean of the Day" |

Always pick `candidates[0]` after sorting by safety score within the highest non-empty tier.

### 3. Pick selection across sports
Build one merged candidate list across all adapters, sort by `(tier_rank, safety_score)`. The single highest pick wins. Telegram header shows the sport (`⚾ MLB`, `🏀 NBA`, `🏒 NHL`).

### 4. Dedup + persistence
Keep the existing one-per-day dedup on `bot_daily_parlays.parlay_date + strategy_name='ladder_challenge'`. Tier name goes into `tier` column (`lock` / `strong` / `lean`). Sport recorded in `selection_rationale` and a new `sport` key inside the `legs[0]` JSON.

### 5. Telegram delivery
Always send via `bot-send-telegram` with `type: 'ladder_challenge'`. Message format keeps the current safety-score block but the header reflects tier + sport, and we add an `⚠️ Lean Tier — best available today` footer when we fall below Lock. If no candidate exists in any tier (very rare — e.g. all leagues dark), send a one-line "No Lock today — markets thin" admin-only note so we never go silent without explanation.

### 6. Backfill verification
After deploy, manually invoke `nba-ladder-challenge` once via `supabase--curl_edge_functions` and confirm:
- A row lands in `bot_daily_parlays` for 2026-05-21
- Telegram message arrives with MLB-tagged lock and proper tier label

### Technical notes

- Files touched: `supabase/functions/nba-ladder-challenge/index.ts` (refactor in place, no new function), `mem/index.md` (+ new memory `mem://logic/betting/ladder-challenge-multisport`).
- Cron and `bot-send-telegram` payload shape are unchanged — no schema migration, no frontend changes.
- `mlb_player_game_logs` already exposes `hits`, `rbis`, `total_bases`, `strikeouts` etc.; adapter maps each MLB category to the right field analogous to the existing `PROP_GAME_LOG_FIELD` map.
- The 90% / floor>line gates remain the **Lock** tier definition, preserving the existing edge-protection memory rule. Tiers Strong/Lean are explicitly labeled so the user can see when we relaxed.

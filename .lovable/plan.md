## What I found

Your PrizePicks board shows ~10+ tennis matches today (Sinner/Zverev, Andreeva, Zheng/Zhu, Carol Zhao/Plipuech, Panshina/Wong, Erjavec/Kawa, Sebov/Jakupovic, Kasatkina/Korpatsch, plus Break Points / Total Games Won / Fantasy Score markets).

Court.Edge only generated 2 picks (Andreeva/Kostyuk + Sinner/Zverev — both Madrid main draw match totals).

Root cause from `tennis-debug`:
- The Odds API only returns ONE active tennis sport key for us right now: `tennis_atp_madrid_open` (1 event total, 0 today in ET window).
- WTA Madrid, ATP/WTA qualifiers, and the WTA 125K events (where Zhao, Panshina, Erjavec, Sebov, Zheng play) are NOT being surfaced — either they're not in our sport-key filter, or The Odds API doesn't carry them and we need a secondary source.
- Player props on PrizePicks (Total Games Won, Break Points Won, Fantasy Score) are not modeled at all — Court.Edge only does match totals + h2h.

## Plan

### 1. Diagnose the sport-key gap (no code yet)
Hit The Odds API `/sports?all=true` directly to enumerate every tennis key (active + inactive). Compare against what `court-edge-fetch-odds` actually pulls. Likely missing: `tennis_wta_madrid_open`, `tennis_atp_*_qualifiers`, ITF/Challenger feeds.

### 2. Broaden Odds API coverage
Update `court-edge-fetch-odds` to:
- Use `all=true` when listing sport keys, then keep any `group === "Tennis"` regardless of `active` flag (some qualifier keys flicker).
- Add explicit allowlist fallback for known WTA/ATP keys so a single empty `/sports` response doesn't kill the slate.
- Log per-sport-key event counts in the digest footer (already partially there).

### 3. Add PrizePicks board as a secondary scan source
Today's missing matches (Zhao, Panshina, Erjavec, Sebov, Kasatkina) are on PrizePicks but not on US/EU sportsbooks via Odds API. Use `court-edge-fetch-prizepicks` output (currently ignored when `pp_blocked`) to:
- Seed the matchup list when Odds API misses a tournament.
- Project match totals using TennisAbstract L3 + surface baseline (no h2h needed — set `spread_adj=0`).
- Cap verdict to LEAN_* (per existing `tennis-data-sync` rule) since we lack market vig.

### 4. Add player-prop markets
Extend the projection engine for the PrizePicks-specific markets:
- **Total Games Won (per player)** — use `projection / 2 + spread_lean` (already half-implemented for `player_total_games`).
- **Fantasy Score** — wire PrizePicks scoring formula (games won + aces + breaks − DFs); model against L3 player averages.
- **Break Points Won** — small-sample, low priority; gate behind L5 minimum.

### 5. Re-run today's slate and re-broadcast
After deploy, manually invoke `court-edge-run`, then push a fresh simplified Telegram digest with the expanded picks (same plain-text format as last broadcast).

## Technical notes

- Files to edit: `supabase/functions/court-edge-fetch-odds/index.ts`, `supabase/functions/court-edge-run/index.ts`, `supabase/functions/_shared/court-edge-projection.ts`, plus the PrizePicks fetcher.
- Add `match_source` column to `court_edge_picks` (`odds_api` | `prizepicks_only`) so we can audit baseline-driven picks.
- Memory `mem://logic/betting/tennis-data-sync.md` already mandates LEAN_* cap for one-side-missing — reuse that gate for PrizePicks-only matchups.
- No schema change needed beyond the `match_source` enum; everything else is additive logic.

## Out of scope
- Live in-match recalibration for tennis (can come later).
- WTA/ATP fantasy scoring derivative props beyond the 3 markets above.

Approve and I'll switch to build mode and ship steps 1–5.
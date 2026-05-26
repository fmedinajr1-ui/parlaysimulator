---
name: Tennis data sync layering
description: Court.Edge tennis projection inputs flow Odds API + PrizePicks (often 403) + TennisAbstract jsfrag scrape + surface baseline fallback; one-side-missing is allowed but capped to LEAN_*.
type: feature
---

## Tennis pipeline data layering

Court.Edge orchestrator (`court-edge-run`) consumes inputs in this order:

1. **Odds API** (`court-edge-fetch-odds`) — match totals + h2h. Forward window is 7 days (was 48h). Logs sport keys with 0 events for visibility.
2. **PrizePicks** (`court-edge-fetch-prizepicks`) — frequently 403 / quota-exhausted. Returns `{ blocked: true, projections: [] }` and the orchestrator surfaces `pp_blocked=true` in the digest.
3. **TennisAbstract L3** (`court-edge-scrape-l3`) — primary URL is `https://www.tennisabstract.com/jsfrags/<Slug>.js` (the JS fragment that holds the `#recent-results` table rows). HTML page is a shell and contains no scores. Fallback URLs: classic CGI then plain CGI.
4. **Surface baseline** (`_shared/court-edge-baseline.ts`) — per-player total-games means by surface × sets-format. Used when a player has no L3 data, so projections never silently drop.

## Projection gate
- BOTH players missing L3 → skip pick.
- ONE missing → fill with `baselineL3()`, set `formula.baseline_used=true`, and **cap verdict to LEAN_*** (never STRONG_OVER/UNDER).
- BOTH have L3 → full projection, all verdicts allowed.

## Diagnostic footer
When the digest has zero actionable picks, append:
`Why empty? odds_events=N · pp_blocked=bool · l3_hits=K/N · weather=ok|miss · baseline_sides=N`
So the cause is visible without DB lookups.

## Why this matters
TennisAbstract serves recent-results from `/jsfrags/<Slug>.js`, not the HTML page. Parsing the HTML returns "no scores parsed" for every player. The scraper now hits the JS fragment first.

## Odds API coverage ceiling (2026 season)
The Odds API only carries top-tier ATP/WTA events. WTA 125Ks, ITFs, and most qualifiers are NOT priced — they appear on PrizePicks but never on `tennis_*` sport keys (sport listed but `events=[]`). Broadening sport-key filters does NOT recover them; the lines simply don't exist on US/EU sportsbooks.

For PrizePicks-only matches, project against TennisAbstract L3 + clay/grass/hard surface baseline and cap verdicts to STRONG only when both players have TA profiles. One-side missing → LEAN cap (already enforced). Insert with `source='prizepicks_seed'` so dashboard can distinguish from `odds_api` runs.

## STRONG_OVER suppressed (pass 1 model fix)

STRONG_OVER picks are tagged `suppressed=true` with `suppressed_reason='strong_over_disabled_v1'` in `court_edge_picks`. They are still persisted and graded, but never broadcast to Telegram, never get a drilldown, and are excluded from headline ROI on `/admin/court-edge-accuracy` (v2 view).

Why: bias audit showed projection − actual = +2.55 games on STRONG_OVER (n=27, 33% win) while every other verdict has a negative residual. The model systematically over-projects total games on the picks it's most confident about for the OVER side.

Parser diff (`court-edge-parser-diff`) confirmed the score parser is NOT the bug — 0/30 picks change under a candidate parser that strips `(N)` tiebreak parens and treats super-tiebreaks as 1 game. The current regex `^(\d{1,2})-(\d{1,2})` already anchors past parens.

Pass 2 (gated on ≥14 days of bias audit data): review `surface_mult` clay, `role_adj` for favorites, and `spread_adj` weight using `projection_bias_audit`. Bias view groups by surface / verdict / sets_format / role_combo / edge_band / tier with mean_residual and win_rate.
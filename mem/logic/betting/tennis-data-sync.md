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
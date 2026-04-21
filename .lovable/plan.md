

## Rebuild wins file with full leg detail

The current `Parlay Legs` sheet is missing the columns you need to actually read each leg. I'll regenerate the workbook so every leg row is fully self-describing.

### What changes

**Sheet 3 — `Parlay Legs`** rebuilt with these columns (one row per leg of every winning parlay):

| Column | Source |
|---|---|
| Parlay Date | parent parlay |
| Tier | parent parlay |
| Strategy | parent parlay |
| Leg # | index within parlay |
| Sport | leg.sport (NBA / MLB / NFL / etc.) |
| Player / Team | leg.player_name (or team name for team bets) |
| Prop / Bet Type | leg.prop_type cleaned (Points, Rebounds, Spread, Total, Moneyline…) |
| Side | OVER / UNDER / HOME / AWAY |
| Line | leg.line / selected_line |
| Odds | leg.american_odds formatted (+150 / -110) |
| Projected | leg.projected_value (model projection) |
| Actual | leg.actual_value (final stat) |
| Result | HIT / MISS / PUSH / VOID color-coded |
| Hit Rate | leg.hit_rate (historical) |
| Confidence | leg.composite_score |
| Source | leg.line_source (mispriced_edge, sharp_steam, etc.) |

The OVER/UNDER and HIT/MISS cells get colored fills (green / red / yellow / gray) so you can scan a parlay top-to-bottom and instantly see what each leg was and whether it cashed.

**Sheet 4 — `Winning Straight Props`** stays the same (already has full leg context).

**Other sheets** (Summary, Winning Parlays, By Sport · Engine) unchanged.

### Output

Replaces `/mnt/documents/parlayfarm-all-wins-since-launch.xlsx` (same path so you don't have to re-find it).

### Process

1. Re-pull all 361 winning parlays
2. Flatten the `legs` JSONB with the expanded column set above
3. Apply prop_type cleanup map (`player_points` → "Points", `batter_hits` → "Hits", `spread` → "Spread", etc. — using the existing label conventions in the codebase)
4. Format odds, color-code results, freeze headers, autofilter
5. Recalculate and verify zero formula errors
6. Spot-check a known parlay end-to-end before delivering


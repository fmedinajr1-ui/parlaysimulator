

# Build Custom 4-Leg Parlay

## The Parlay

| # | Player | Prop | Line | Projection | Edge | Best Odds | Hit Rate |
|---|--------|------|------|------------|------|-----------|----------|
| 1 | Joel Embiid | Points OVER | 27.5 | 34.0 | +6.5 | -125 | 100% L10 |
| 2 | James Harden | Assists OVER | 7.5 | 8.5 | +1.0 | -148 | 100% L10 |
| 3 | Cade Cunningham | Assists OVER | 8.5 | ~10.5* | ~+2.0 | -125 | 82%** |
| 4 | Jalen Johnson | Rebounds OVER | 9.5 | 12.5 | +3.0 | -139 | 100% L10 |

*Cunningham AST is not in today's `category_sweet_spots` pool (only his PTS O25.5 is). His assists line at 8.5 has odds between -125 and -152 across books. The projection and hit rate are estimated from prior context -- this leg has slightly less data backing than the other three.

**From earlier analysis context.

## Combined Math (using best available odds)

- Decimal odds: 1.80 x 1.68 x 1.80 x 1.72 = ~9.37
- American odds: approximately +837
- Implied probability: ~10.7%
- $10 stake wins ~$93.70

## What Will Be Done

1. **Insert one row** into `bot_daily_parlays` with:
   - `strategy_name`: `'custom_manual'`
   - `parlay_date`: `'2026-02-11'`
   - `leg_count`: 4
   - `legs`: JSONB array with all four legs including player name, prop type, line, side, odds, projection, projection buffer, hit rate, and category
   - `outcome`: `'pending'`
   - `simulated_stake`: 10
   - `simulated_payout`: ~93.70
   - `expected_odds`: +837
   - `selection_rationale`: Manual custom build -- all legs positive edge, 79%+ hit rates
   - `is_simulated`: true

2. **No code changes needed** -- this is a direct database insert of a single custom parlay record.

## Technical SQL

```sql
INSERT INTO bot_daily_parlays (
  parlay_date, legs, leg_count, expected_odds,
  strategy_name, outcome, is_simulated,
  simulated_stake, simulated_payout, selection_rationale
) VALUES (
  '2026-02-11',
  '[
    {"player_name":"Joel Embiid","prop_type":"points","side":"over","line":27.5,
     "american_odds":-125,"projected_value":34.0,"projection_buffer":6.5,
     "hit_rate":100,"category":"VOLUME_SCORER","sport":"basketball_nba","outcome":"pending"},
    {"player_name":"James Harden","prop_type":"assists","side":"over","line":7.5,
     "american_odds":-148,"projected_value":8.5,"projection_buffer":1.0,
     "hit_rate":100,"category":"HIGH_ASSIST","sport":"basketball_nba","outcome":"pending"},
    {"player_name":"Cade Cunningham","prop_type":"assists","side":"over","line":8.5,
     "american_odds":-125,"projected_value":10.5,"projection_buffer":2.0,
     "hit_rate":82,"category":"HIGH_ASSIST","sport":"basketball_nba","outcome":"pending"},
    {"player_name":"Jalen Johnson","prop_type":"rebounds","side":"over","line":9.5,
     "american_odds":-139,"projected_value":12.5,"projection_buffer":3.0,
     "hit_rate":100,"category":"BIG_REBOUNDER","sport":"basketball_nba","outcome":"pending"}
  ]'::jsonb,
  4, 837, 'custom_manual', 'pending', true, 10, 93.70,
  'Manual custom build: all 4 legs have positive projection edges and 79%+ L10 hit rates'
);
```

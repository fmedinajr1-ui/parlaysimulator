

## Plan: Build L3 Cross-Engine Parlay Finder

Create a new edge function `l3-cross-engine-parlay` that queries ALL engines with L3 data, cross-references overlaps, and assembles the strongest 3-5 leg parlay.

### What It Does

Pulls L3-confirmed picks from 3 sources:
1. **Mispriced lines** — `l3_confirms = true`, sorted by `edge_pct`
2. **Sweet spots** — `l3_avg IS NOT NULL`, sorted by `l10_hit_rate`
3. **High conviction results** — sorted by `conviction_score`

Cross-references all three, scores each pick by:
- **Overlap count** (appears in 2+ engines = bonus)
- **L3 margin** (how far L3 clears the line)
- **Edge %** from mispriced
- **Hit rate** from sweet spots

Assembles the best 3-5 leg parlay with:
- Max 1 pick per player
- Max 1 pick per game (uncorrelated)
- NBA only (today's slate)
- Sorted by composite score

Persists to `bot_daily_parlays` with strategy `l3_cross_engine` and broadcasts via Telegram.

### Files

1. **Create** `supabase/functions/l3-cross-engine-parlay/index.ts` — the new function
2. **Update** `supabase/functions/broadcast-new-strategies/index.ts` — whitelist `l3_cross_engine`

### Based on Today's Data, the Optimal Parlay Would Be:

**5-Leg L3 Cross-Engine Parlay:**

| Leg | Player | Prop | Side | Line | L3 Avg | Engines | Edge |
|-----|--------|------|------|------|--------|---------|------|
| 1 | Reed Sheppard | Threes | OVER | 2.5 | 4.0 | 5 (mispriced+sweet+3×bot) | 55.2% |
| 2 | Kel'el Ware | Points | UNDER | 13.5 | 12.7 | 6 (mispriced+sweet+4×bot) | 16.7% |
| 3 | Alex Sarr | Rebounds | OVER | 5.5 | 7.3 | mispriced HIGH | 51.5% |
| 4 | Tyler Herro | Threes | OVER | 2.5 | 4.7 | mispriced+sweet | 44.9% |
| 5 | Naji Marshall | Assists | OVER | 2.5 | 3.0 | mispriced HIGH | 37.3% |

All 5 from different games, all L3-confirmed, all NBA. Average edge: 41.1%.

### Post-Deploy
1. Deploy the function
2. Invoke it to generate and broadcast today's parlay
3. Verify Telegram output


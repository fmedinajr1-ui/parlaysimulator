

## L3 Recency Gate Audit + Bidirectional Scanner Trigger

### Scanner Trigger Result
The bidirectional scanner ran successfully just now. Results:
- **34 findings** (5 Elite, 11 Prime matchups)
- **25 player-backed targets** identified
- **2 bench-under parlays** generated
- Duration: 6.2 seconds

### L3 Gate Coverage Audit

**Engines WITH L3 gate (working correctly):**

| Engine | Location | Status |
|--------|----------|--------|
| Category Props Analyzer | `category-props-analyzer/index.ts` | Calculates and stores `l3_avg` in `category_sweet_spots` table |
| Bot Curated Pipeline | `bot-curated-pipeline/index.ts` | Reads `l3_avg`, blocks OVER if <0.75 ratio, UNDER if >1.25 |
| Bot Matchup Defense Scanner | `bot-matchup-defense-scanner/index.ts` | Same L3 filter on player-backed targets |
| Heat Prop Engine | `heat-prop-engine/index.ts` | Same L3 filter on category recommendations |
| Sharp Parlay Builder | `sharp-parlay-builder/index.ts` | Same L3 filter on category recommendations |
| Telegram Broadcasts | `bot-send-telegram/index.ts` | Shows `📉` warning on moderate declines (15-25%) |

**Engines MISSING L3 gate (gaps):**

| Engine | File | Risk |
|--------|------|------|
| **Bot Generate Daily Parlays** | `bot-generate-daily-parlays/index.ts` | No `l3_avg` reference at all. This is the **main parlay assembly engine** — it can include players the other engines correctly filtered out |
| **Double Confirmed Scanner** | `double-confirmed-scanner/index.ts` | No L3 check. Cross-references sweet spots and mispriced lines but never checks recency decline |
| **NBA Matchup Daily Broadcast** | `nba-matchup-daily-broadcast/index.ts` | Relies on `bot-matchup-defense-scanner` which HAS the gate, so indirectly covered. But the broadcast message itself doesn't show the `📉` warning tag for player-backed targets |

### Fix Plan

**1. Add L3 gate to `bot-generate-daily-parlays`**
This is the critical gap. When the main generator assembles parlays, it pulls from `category_sweet_spots` but never checks `l3_avg`. Add the same filter pattern: query `l3_avg` in the select, skip legs where OVER picks have `l3_avg / l10_avg < 0.75` or UNDER picks have ratio `> 1.25`.

**2. Add L3 gate to `double-confirmed-scanner`**
When cross-referencing sweet spots with mispriced lines, add the L3 check before promoting a pick to "double confirmed." Already has `l10_avg` from sweet spots — just need to also select `l3_avg` and apply the filter.

**3. Add `📉` warning to matchup broadcast player targets**
The broadcast builds player target text but doesn't include recency warnings. Pass `l3_avg` through to the broadcast message formatter.

### Technical Details
- All 3 fixes use the same pattern already proven in 5 other engines
- The `category_sweet_spots` table already has `l3_avg` populated by the analyzer
- No database changes needed — purely edge function code updates


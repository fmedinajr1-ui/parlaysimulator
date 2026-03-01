

## Enable Alt Lines on High-Frequency Strategies — ✅ COMPLETED

### Changes Made

#### 1. `bot-generate-daily-parlays` — Execution tier profiles updated
- `double_confirmed_conviction` (minHitRate: 70, all) → `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`
- `mispriced_edge` (NBA, minHitRate: 60, hit_rate) → `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`
- `mispriced_edge` (NBA, minHitRate: 62, composite) → `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`
- `mispriced_edge` (all, minHitRate: 60, hit_rate) → `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`
- `double_confirmed_conviction` (all, minHitRate: 65) → `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`
- `double_confirmed_conviction` (NBA, minHitRate: 65, hit_rate) → `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`

#### 2. `bot-force-fresh-parlays` — Alt line shopping added
- Step 3b: Fetches alt lines for top 10 NBA picks with 1.5x buffer
- Resolves event_ids from `mispriced_lines` table
- Step 5 leg mapping: Substitutes first leg per parlay with lower alt line if odds > -200
- Tracks `alt_line_used` and `original_line` in leg data

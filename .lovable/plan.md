

## Add Universal Recency Decline Flag Across All Engines

### Problem
Picks like Naji Marshall Over 14.5 PTS pass all filters because his L10 average (17.0) clears the line — but his last 4 games are 8, 13, 6, 4. No engine currently checks if a player's most recent 3 games sharply contradict the recommended side. The L5 cold detection in `category-props-analyzer` only applies to 3PT props, not universally.

### Solution: Two-Part Fix

**Part 1 — Add `l3_avg` column to `category_sweet_spots` table**

Add a database migration to compute and store `l3_avg` alongside existing `l10_avg`. This gives every downstream engine a pre-computed recency signal.

- New column: `l3_avg NUMERIC` (nullable, default null)

**Part 2 — Compute `l3_avg` in `category-props-analyzer`**

In the main analysis loop where L10 stats are computed, also compute L3 average from the first 3 games (already sorted by date descending) and store it.

**Part 3 — Add universal recency decline filter in `category-props-analyzer`**

After computing L3, apply a universal cold streak check for ALL prop types (not just 3PT):

```text
OVER picks: If l3_avg < l10_avg * 0.75 → BLOCK (recent 25%+ decline)
UNDER picks: If l3_avg > l10_avg * 1.25 → BLOCK (player surging recently)
```

This catches cases like Naji Marshall where L3 avg (7.75) is 45% below L10 avg (17.0).

**Part 4 — Add recency gate in downstream engines**

Add the same L3 decline check to these engines that consume `category_sweet_spots` data:

1. **`bot-matchup-defense-scanner`** (bidirectional scanner) — in `findPlayerTargets()`, fetch `l3_avg` from sweet spots and reject picks where L3 diverges sharply from L10 vs the recommended side
2. **`bot-curated-pipeline`** — add L3 filter when building curated legs
3. **`sharp-parlay-builder`** — add L3 recency gate before including a leg
4. **`heat-prop-engine`** — add L3 check in pick validation

**Part 5 — Flag recency decline in Telegram broadcasts**

When a pick has a moderate decline (L3 < L10 * 0.85 but above the block threshold), add a ⚠️ warning tag in broadcast messages so you can see it:

```text
✅ Jalen Brunson OVER 25.5 PTS (L10: 90% hit, Avg 28.3)
⚠️ Naji Marshall OVER 14.5 PTS (L10: 50% hit, Avg 17.0) ← L3: 7.8 📉
```

### Files to Edit
- **Migration**: Add `l3_avg` column to `category_sweet_spots`
- `supabase/functions/category-props-analyzer/index.ts` — compute `l3_avg`, add universal recency decline block
- `supabase/functions/bot-matchup-defense-scanner/index.ts` — filter targets using `l3_avg`
- `supabase/functions/bot-curated-pipeline/index.ts` — add L3 gate
- `supabase/functions/sharp-parlay-builder/index.ts` — add L3 gate
- `supabase/functions/heat-prop-engine/index.ts` — add L3 gate
- `supabase/functions/bot-send-telegram/index.ts` — add 📉 warning tag for declining players

### Thresholds Summary
```text
HARD BLOCK (OVER):  l3_avg < l10_avg * 0.75  (25%+ decline)
HARD BLOCK (UNDER): l3_avg > l10_avg * 1.25  (25%+ surge)
WARNING FLAG:       l3_avg < l10_avg * 0.85  (15%+ decline, shown in broadcast)
```


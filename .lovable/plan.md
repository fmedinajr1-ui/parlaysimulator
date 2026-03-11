

## Plan: Smart Warnings Instead of Hard Blocks + Fix NHL

### Philosophy Change
Instead of blocking picks that might win, add **contextual risk tags** to every player target. The user sees all recommendations but with clear parenthetical warnings — empowering them to decide.

### Changes

#### 1. Scanner: Risk Tags Instead of Blocks (`bot-matchup-defense-scanner/index.ts`)

**Expand `PlayerTarget` interface** to include risk context:
```typescript
interface PlayerTarget {
  player_name: string;
  line: number;
  l10_avg: number;
  l10_hit_rate: number;
  l10_min: number;
  margin: number;
  // NEW fields:
  l3_avg: number | null;
  risk_tags: string[];    // e.g. ['L3_DECLINE', 'BLOWOUT_RISK', 'L3_COLD']
  l3_trend: 'hot' | 'cold' | 'steady' | null;
  spread: number | null;  // Game spread for context
}
```

**Query `game_bets` spreads** at the start of the scan — build a `spreadMap` keyed by team abbreviation (positive = favored by X points).

**Replace L3 hard-block with risk tags**:
- If `l3_avg` exists and is **below the line** for an OVER pick → add tag `L3_BELOW_LINE` (don't block)
- If `l3_avg / l10_avg < 0.80` → add tag `L3_DECLINE` (don't block, was previously blocked at 0.75)
- If `l3_avg / l10_avg > 1.20` for UNDER → add tag `L3_SURGE` (don't block)
- If `l3_avg` exists and **confirms the pick** (above line for OVER, below for UNDER) → add tag `L3_CONFIRMED`
- If `l3_avg` is null → no L3 tag at all (passes through as before)

**Add blowout risk tags** (no blocking):
- If spread ≥ 10 for the favored team → add `BLOWOUT_RISK` to OVER picks for that team's starters
- If spread ≥ 7 → add `ELEVATED_SPREAD` tag
- Include the spread value in the tag: `BLOWOUT(-14.5)`

**L3 directional signal** — add to `risk_tags`:
- L3 trending down + OVER pick = `⚠️ L3 says UNDER`
- L3 trending up + UNDER pick = `⚠️ L3 says OVER`

#### 2. Broadcast: Show Risk Tags in Telegram (`nba-matchup-daily-broadcast/index.ts`)

Update `formatEntry` to render risk tags in parentheses after each player line:
```
✅ Cade Cunningham OVER 8.5 REB (L10: 9.2 avg, 80% hit)
   ⚠️ (BLOWOUT -14.5 | L3: 7.3 — says UNDER)

✅ Reed Sheppard OVER 2.5 3PT (L10: 3.1 avg, 90% hit)
   ✅ (L3: 3.8 CONFIRMED | Spread: -3)
```

This gives the user full context to make their own call.

#### 3. Fix NHL Unique Constraint (Database Migration)

The `category_sweet_spots` unique index is `(player_name, prop_type, analysis_date)` — missing `category`. NBA and NHL entries collide.

**Migration**:
```sql
DROP INDEX idx_category_sweet_spots_unique;
CREATE UNIQUE INDEX idx_category_sweet_spots_unique 
  ON category_sweet_spots (player_name, prop_type, analysis_date, category);
```

**Update `nhl-prop-sweet-spots-scanner/index.ts`**: Change `onConflict` from `'player_name,prop_type,analysis_date'` to `'player_name,prop_type,analysis_date,category'`.

#### 4. Re-invoke NHL Scanner

After deploying the fix, re-invoke the NHL scanner to verify sweet spots persist for today's date.

### Summary of Files
1. `supabase/functions/bot-matchup-defense-scanner/index.ts` — risk tags instead of blocks, spread lookup, L3 directional signals
2. `supabase/functions/nba-matchup-daily-broadcast/index.ts` — render risk tags in Telegram output
3. `supabase/functions/nhl-prop-sweet-spots-scanner/index.ts` — fix `onConflict` to include `category`
4. Database migration — fix unique index on `category_sweet_spots`


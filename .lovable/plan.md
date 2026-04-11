

# Fix Database Error + Explain Tennis Analysis Logic

## The Database Error

The screenshot shows: `Database error: there is no unique or exclusion constraint matching the ON CONFLICT specification`

**Root cause:** Both the text and screenshot `/pptennis` handlers use `.upsert(rows, { onConflict: 'market_key' })` on `pp_snapshot` and `unified_props`, but neither table has a UNIQUE constraint on `market_key`.

- `pp_snapshot`: only has a unique PK on `id` — no unique on `market_key`
- `unified_props`: unique constraint is on `(event_id, player_name, prop_type, bookmaker)` — not on `market_key`

**Fix:** Add unique constraints via migration, then the existing upsert logic will work.

### Migration

```sql
-- pp_snapshot: add unique constraint on market_key
ALTER TABLE public.pp_snapshot ADD CONSTRAINT pp_snapshot_market_key_unique UNIQUE (market_key);

-- unified_props: add unique index on market_key (it may have NULLs, so use a partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS unified_props_market_key_unique 
  ON public.unified_props (market_key) 
  WHERE market_key IS NOT NULL;
```

### Code Fix

For `unified_props`, the upsert also writes `line` instead of `current_line` (the actual column name). Need to fix the column mapping in both the text handler and screenshot handler to use `current_line` instead of `line`, and add `commence_time` set to today so the analyzer query picks them up.

### Files Changed

| File | Change |
|------|--------|
| Migration | Add unique constraints on `market_key` for both tables |
| `telegram-webhook/index.ts` | Fix `unified_props` column names (`current_line` not `line`, add `commence_time`) in both text and photo handlers |

---

## How the Tennis Analysis Actually Works

To answer your question — yes, it uses **cross-referencing, historical data, and mathematical edge calculation**. Here's the full pipeline:

### Step 1: Data Import (what just failed)
Screenshot → GPT-4o Vision extracts player names + stat types + lines → saves to `pp_snapshot` + `unified_props`

### Step 2: Tennis Games Analyzer (`/runtennis`)
The analyzer reads today's tennis props from `unified_props` and runs this model:

1. **Historical Player Stats** — Cross-references `tennis_player_stats` table for each player's L10 and L5 average games per match, broken down by surface
2. **Gender Modifier** — WTA matches get -1.5 games (shorter format, more breaks), ATP gets +0.5
3. **Surface Modifier** — Clay reduces games (WTA clay: -0.5), grass increases them (ATP grass: +0.5), hard is neutral
4. **H2H Cross-Reference** — Looks up head-to-head history between the two players, caps H2H influence at 25% weight
5. **Projected Total** = `(PlayerA_L10_avg + PlayerB_L10_avg) / 2 + gender_mod + surface_mod + h2h_mod`
6. **Edge Calculation** = `|projected_total - prizepicks_line| / prizepicks_line × 100`
7. **Minimum Thresholds** — Requires ≥3% edge AND ≥60% confidence to emit a pick
8. **Confidence Score** — Starts at 0.50, gets boosted by: edge size (+0.025 per %), having real L10 data (+0.08), H2H supporting the side (+0.06), under bias (+0.03)

### What's Missing Right Now
- `tennis_player_stats` is likely empty for these players, so the analyzer falls back to generic ATP average (38.5 games) or WTA average (20.5 games)
- Without player-specific historical data, the model can only apply gender + surface modifiers against the PrizePicks line
- The "self-healing loop" is supposed to update `tennis_player_stats` from settled outcomes, but it needs settled matches first


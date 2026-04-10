

# Tennis Total Games Analyzer — Deploy Plan

## What gets deployed

Three actions in order:

### 1. Database migration
Creates two new tables with RLS:
- **`tennis_match_model`** — per-match analysis output (projected totals, edge %, confidence, settlement fields). Unique index on `(analysis_date, player_a, player_b, tour)` for upserts. Update trigger on `updated_at`.
- **`tennis_player_stats`** — L5/L10 game averages per player/tour/surface. Unique index on `(player_name, tour, surface)`. Starts empty, fills over time.
- Both tables get RLS enabled with service_role full-access policies.

### 2. New edge function: `tennis-games-analyzer`
Creates `supabase/functions/tennis-games-analyzer/index.ts` from the uploaded file (646 lines). The function:
- Queries `unified_props` for today's ATP/WTA total-games lines
- Deduplicates matches by alphabetical player key
- Looks up `tennis_player_stats` with surface-specific fallback to `'all'`
- Applies gender modifier (WTA -1.5, ATP +0.5) + surface modifier
- Blends H2H at 25% cap when sample >= 3
- Emits picks with edge >= 3% and confidence >= 60%
- Upserts to `tennis_match_model` and inserts to `category_sweet_spots`
- Sends Telegram summary with per-match narratives

### 3. Patch `morning-prep-pipeline`
Insert Step 4.5 between the MLB RBI analyzer (Step 4) and Settlement (Step 5):
- Invokes `tennis-games-analyzer` wrapped in the existing `invokeStep` pattern (non-fatal — logged but won't block pipeline)
- Appears in the Telegram summary alongside all other steps

## Files

| File | Action |
|------|--------|
| Migration SQL | Create `tennis_match_model` + `tennis_player_stats` tables |
| `supabase/functions/tennis-games-analyzer/index.ts` | Create (from uploaded `index_8.ts`) |
| `supabase/functions/morning-prep-pipeline/index.ts` | Edit — add Step 4.5 between lines 69-70 |

## Notes
- No changes to parlay generators or broadcast — tennis picks flow through `category_sweet_spots` automatically
- Day 1 works without player stats (ATP 38.5 / WTA 20.5 fallbacks)
- The `category_sweet_spots` delete-then-insert for tennis categories is intentional — tennis re-runs should replace, not accumulate


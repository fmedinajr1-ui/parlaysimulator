

## Rebalance tonight's pick pool so the engine has more games to draw from

### What you're asking for

Don't wait until tomorrow's 10 AM ET morning pipeline — rebuild `bot_daily_pick_pool` for `pick_date = today` right now so all 20 games with fresh FanDuel/DraftKings lines have player-prop coverage. Then re-run the broadcast and ship parlays that span multiple games tonight.

### Plan

**1. Identify the pool builder**

The morning pipeline (`mem://infrastructure/pipeline/morning-prep-pipeline-unified`) populates `bot_daily_pick_pool`. I'll locate the exact edge function (likely `morning-prep-pipeline`, `build-daily-pick-pool`, or a step inside the unified runner) by searching `supabase/functions/` for writes to `bot_daily_pick_pool`. I'll invoke just that step — not the full 10 AM pipeline — so we don't re-trigger PVS enrichment or other heavy upstream jobs unnecessarily.

**2. Invoke a one-off rebuild for today**

```ts
supabase.functions.invoke('<pool-builder-fn>', {
  body: { pick_date: 'today_ET', force_rebuild: true }
});
```

If the function doesn't accept a `force_rebuild` flag, I'll first DELETE today's rows from `bot_daily_pick_pool` (via insert tool / migration) then invoke. The builder uses `unified_props` as its source, which is already fresh from earlier tonight.

**3. Verify coverage expanded**

```sql
SELECT game_description, COUNT(*) AS legs
FROM bot_daily_pick_pool
WHERE pick_date = (now() AT TIME ZONE 'America/New_York')::date
GROUP BY game_description
ORDER BY legs DESC;
```

Pass = 8+ games represented (was 2: 76ers@Celtics, Rockets@Lakers).

**4. Re-broadcast**

```ts
supabase.functions.invoke('parlay-engine-v2-broadcast', {
  body: { generate_first: true, preset: 'v2.3-balanced', dry_run: true }
});
```

Expected: parlays now span 3–5 distinct games, `single_game_only` and `same_game_share_*` rejections drop to near-zero, FD/DK book tags on every leg. Flip `dry_run: false` to ship.

**5. If rebuild can't find player names for all 20 games**

That means the upstream data (projections, defensive context, player matchups) is also stale and the builder is correctly skipping games with missing inputs. In that case I'll report exactly which games are missing which inputs and we decide whether to manually trigger the upstream refreshers (`refresh-l10-and-rebuild`, projection sync, etc.) or accept the partial coverage.

### What this does NOT do

- Does not re-tighten the temporary 0.75 same-game gate (we leave that until pool coverage is reliably restored across multiple days).
- Does not modify the pool builder's logic — only invokes it for today.
- Does not change the 11 AM / 3 PM / 7 PM auto-broadcast cron schedule.
- No schema changes.

### Tests

This is an operational re-run, not new code. Verification is the SQL coverage check + dry-run rejection report — both already required as gates before flipping to live broadcast.


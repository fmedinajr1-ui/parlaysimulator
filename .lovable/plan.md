

## Don't remove the gate — fix what's actually starving it

### What's really going on tonight

20 NBA games have fresh FanDuel/DraftKings lines, but `bot_daily_pick_pool` (today's date) only has player-name matches in **2 games**:

| Game | Matched legs |
|---|---|
| Philadelphia 76ers @ Boston Celtics | 954 |
| Houston Rockets @ Los Angeles Lakers | 159 |

That's why every generated parlay ends up `same_game_share = 1.00` — the engine literally cannot draw legs from a third game. Removing the same-game gate would just paper over a thinner pick pool, and you'd start shipping 3-leg tickets where all 3 legs ride on whether the Celtics' starting lineup shows up tonight. That's a correlation bomb, not an edge.

### Recommendation: keep the gate, lower it to 0.75 for tonight only, and refill the pool tomorrow

**Three changes.**

**1. Loosen `parlaySameGameConcentration` from 0.6 → 0.75 (temporary)**

In `supabase/functions/_shared/parlay-engine-v2/filters.ts`, change the default `max_share` from `0.6` to `0.75`. This lets a 4-leg parlay have 3 legs from one game (75%) but still rejects 4/4 same-game stacks. With 2 fresh games available, this unblocks tonight without going full SGP-roulette. Marked TEMP with a date comment so we revert when the pool is back to normal coverage.

**2. Add a "minimum distinct games" guard so we never silently ship a 100% same-game parlay**

New gate `parlayMinDistinctGames(p, min=2)` rejects any parlay whose legs all share one `(team|opponent)` key. Even at the looser 0.75 threshold, this is a hard floor: every parlay must touch at least 2 games. Counts as `parlay:single_game_only` in the rejection report.

**3. Don't touch the pool issue tonight — let tomorrow's morning pipeline rebuild it**

The root cause is that `bot_daily_pick_pool` for `pick_date = CURRENT_DATE` was built before tonight's full slate had names locked in. The morning prep pipeline (10 AM ET, per `mem://infrastructure/pipeline/morning-prep-pipeline-unified`) will repopulate it with all 20 games. Tonight we ship what we can off the 2 games we do have coverage for.

### Tests (3, all in `_shared/parlay-engine-v2/__tests__/`)

1. 4-leg parlay with 3 legs from `LAL/GSW` + 1 leg from `BOS/MIA` → **passes** at new 0.75 threshold (was rejected at 0.6).
2. 4-leg parlay with 4 legs from `LAL/GSW` → still **rejected** as `same_game_share_1.00`.
3. 3-leg parlay with all 3 legs from `LAL/GSW` → **rejected** by new `parlayMinDistinctGames` gate as `single_game_only` (would have passed the share check at 1.00 ≤ 0.75 is false anyway, but this gate makes the intent explicit and survives future threshold changes).

### Then re-broadcast

```ts
supabase.functions.invoke('parlay-engine-v2-broadcast', {
  body: { generate_first: true, preset: 'v2.3-balanced', dry_run: true }
});
```

Expected: parlays ship with mixed Celtics/76ers + Rockets/Lakers legs, FD tags, no `single_game_only` rejections dominating the report. Flip `dry_run: false` to send.

### Memory updates after ship

- New memory `mem://logic/parlay/same-game-concentration`: documents the 0.75 cap + min-2-games hard floor, with TEMP note pointing to the 0.6 revert target once pool coverage is restored.

### What this does NOT do

- Does not remove the same-game gate (correlation protection stays).
- Does not patch the pick-pool refresh — tomorrow's pipeline handles it.
- Does not change scoring, sizing, freshness, or drift gates.
- No schema changes.


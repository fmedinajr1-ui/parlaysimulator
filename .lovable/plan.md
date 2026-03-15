

# Fix Three Live Quarter Issues

## Issue 1: Add steals & blocks columns + mapping

The `quarter_player_snapshots` table **lacks `steals` and `blocks` columns** entirely. Need:

**Database migration**: Add two columns:
```sql
ALTER TABLE public.quarter_player_snapshots ADD COLUMN steals INT DEFAULT 0;
ALTER TABLE public.quarter_player_snapshots ADD COLUMN blocks INT DEFAULT 0;
```

**Edge function** (`auto-quarter-snapshots/index.ts`): 
- Add `steals` and `blocks` to the `PlayerStats` interface and ESPN parsing (ESPN labels: `stl`, `blk`)
- Include them in the upsert rows

**WarRoomLayout.tsx** (line 146): 
- Add `steals, blocks` to the select query
- Add to propKeys map: `steals: 'steals', blocks: 'blocks'`

## Issue 2: Game matching — already fixed

Line 270 already matches by `gameContext.eventId`, `homeTeam`, or `awayTeam` before falling back to first in-progress game. **No change needed.**

## Issue 3: Snapshot capture — already running

The cron job `auto-quarter-snapshots` is active (job #104, `*/2 * * * *`). The edge function exists and fetches ESPN box scores. Only gap is missing steals/blocks (covered in Issue 1). **No additional change needed** beyond adding the two new stat columns.

## Summary

| Change | File |
|--------|------|
| Add `steals` and `blocks` columns | DB migration |
| Parse `stl`/`blk` from ESPN, include in upsert | `auto-quarter-snapshots/index.ts` |
| Add steals/blocks to select + propKeys | `WarRoomLayout.tsx` |


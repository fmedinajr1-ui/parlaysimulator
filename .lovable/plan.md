

# Filter War Room Props to FanDuel + Always Show Quarter Breakdown

## Current State

All Q1 FanDuel infrastructure is already built and deployed. Two gaps remain:

1. **Props aren't FanDuel-only** — `useDeepSweetSpots.ts` line 424 queries `unified_props` without a `bookmaker` filter, pulling lines from all bookmakers
2. **No fallback quarter breakdown** — If the edge function returns no data for a player, `quarterAvgs` is undefined and the card shows nothing

## Changes

### 1. Filter to FanDuel in `useDeepSweetSpots.ts`
Add `.eq('bookmaker', 'fanduel')` to the `unified_props` query (line 429). This ensures every War Room card uses FanDuel lines exclusively.

### 2. Fallback quarter estimates in `WarRoomLayout.tsx`
When `quarterAvgs` is undefined for a player/prop, generate a fallback from L10 average using tier-based distribution (25/26/26/23%). Update the `propCards` builder (~line 207) to apply this fallback so every card always shows Q1–Q4 breakdown.

### 3. Add `bookmaker` to select + deduplicate
Add `bookmaker` to the select clause so we can confirm FanDuel source. Add a dedup step (keep most recent `scraped_at`) as a safety net — requires adding `scraped_at` to the select as well.

| Change | File |
|---|---|
| Add `.eq('bookmaker', 'fanduel')` + `bookmaker, scraped_at` to select, dedup | `useDeepSweetSpots.ts` |
| Fallback quarter estimates from L10 avg | `WarRoomLayout.tsx` |


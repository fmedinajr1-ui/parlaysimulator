

# Fix: Filter Tomorrow Pages to Players With Actual Games

## Problem Identified

The **Tomorrow's Assist Plays** page shows 19 picks, but only **1 player** (Alperen Sengun) actually has a game tomorrow. The same issue affects the **Tomorrow's 3PT Picks** page.

**Root Cause**: Both hooks fetch from `category_sweet_spots` without cross-referencing `unified_props` to verify players have upcoming games.

## How CategoryPropsCard Does It Right

```text
1. Fetch active players → SELECT player_name FROM unified_props WHERE commence_time >= NOW()
2. Create activePlayers Set
3. Fetch category_sweet_spots
4. Filter to only players in activePlayers set
```

## Fix Plan

### 1. Update `useTomorrowAssistProps.ts`

Add the same filtering logic used in CategoryPropsCard:

- Before fetching from `category_sweet_spots`, first query `unified_props` for the target date
- Build a Set of player names with actual games
- After fetching sweet spots, filter to only include players in that Set
- Log the before/after count for debugging

### 2. Update `useTomorrow3PTProps.ts`

Apply the same fix for consistency across all "Tomorrow" pages.

### 3. Changes Summary

```text
┌────────────────────────────────────────────────────────────────────┐
│                    BEFORE (Current - Broken)                        │
├────────────────────────────────────────────────────────────────────┤
│  category_sweet_spots  ────────────────────────►  Display          │
│  (19 picks)                                       (All 19 shown)   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                    AFTER (Fixed)                                    │
├────────────────────────────────────────────────────────────────────┤
│  unified_props (tomorrow) ───► activePlayers Set                   │
│                                      ↓                              │
│  category_sweet_spots  ───► Filter by Set ───►  Display            │
│  (19 picks)                  (only 1 player)    (1 pick)           │
└────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Code Change for `useTomorrowAssistProps.ts`

Add before the main query:

```typescript
// Step 1: Get players with games on the target date
const { data: upcomingProps } = await supabase
  .from('unified_props')
  .select('player_name')
  .gte('commence_time', `${analysisDate}T00:00:00`)
  .lt('commence_time', `${analysisDate}T23:59:59`);

const activePlayers = new Set(
  (upcomingProps || []).map(p => p.player_name?.toLowerCase())
);

console.log(`Found ${activePlayers.size} players with games on ${analysisDate}`);
```

Then after fetching sweet spots:

```typescript
// Filter to only players with actual games
const filteredPicks = picks.filter(pick => 
  activePlayers.has(pick.player_name?.toLowerCase())
);

console.log(`Filtered from ${picks.length} to ${filteredPicks.length} picks`);
```

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useTomorrowAssistProps.ts` | Add unified_props cross-reference filter |
| `src/hooks/useTomorrow3PTProps.ts` | Add unified_props cross-reference filter |

This will ensure both pages only show players with confirmed games on the target date.


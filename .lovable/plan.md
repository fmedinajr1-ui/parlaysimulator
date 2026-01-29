

# Tomorrow's Assist Plays Page

A new dedicated page at `/tomorrow-assists` to display the **BIG_ASSIST_OVER** and **HIGH_ASSIST_UNDER** categories for tomorrow's games.

## Overview

This page will mirror the successful `Tomorrow3PT` page pattern but focus on assist-based props. It will showcase:
- **BIG_ASSIST_OVER**: Big men and playmakers expected to exceed low assist lines (17 picks for Jan 29)
- **HIGH_ASSIST_UNDER**: High-volume assist players likely to miss inflated lines (2 picks for Jan 29)

## Current Data (Jan 29th)

| Category | Count | 100% L10 | Top Picks |
|----------|-------|----------|-----------|
| BIG_ASSIST_OVER | 17 | 10 | Jaylon Tyson, Draymond Green, Pascal Siakam, Nikola Vucevic |
| HIGH_ASSIST_UNDER | 2 | 2 | Keyonte George, Paul George |

## Implementation Plan

### 1. Create Data Hook: `useTomorrowAssistProps.ts`
A new React Query hook that:
- Fetches from `category_sweet_spots` for categories: `BIG_ASSIST_OVER` and `HIGH_ASSIST_UNDER`
- Uses tomorrow's Eastern Time date
- Joins with `player_reliability_scores` and `bdl_player_cache` for enrichment
- Returns picks grouped by category with summary stats

### 2. Create Page Component: `TomorrowAssists.tsx`
A new page featuring:
- **Header**: Back button, title "Tomorrow's Assist Plays", date display, refresh button
- **Summary Stats Card**: Total picks, 100% L10 count, category breakdown, average hit rate
- **Category Tabs**: Toggle between BIG_ASSIST_OVER and HIGH_ASSIST_UNDER views
- **Filter Controls**: Hit rate filters (All, 100%, 90%, 80%)
- **Pick Cards Grid**: Individual player cards with:
  - Player name and team badge
  - L10 hit rate badge (color-coded by tier)
  - Line display (OVER/UNDER based on category)
  - L10 average and confidence score
  - "Add to Builder" button

### 3. Add Route in `App.tsx`
- Register `/tomorrow-assists` route with lazy loading

### 4. Add Navigation Link
- Add to sidebar/quick actions for easy access

---

## Technical Details

### New Files
1. `src/hooks/useTomorrowAssistProps.ts` - Data fetching hook
2. `src/pages/TomorrowAssists.tsx` - Page component

### Modified Files
1. `src/App.tsx` - Add route and lazy import

### UI Components (Reused)
- Card, CardContent from shadcn/ui
- Badge for hit rate tiers and category labels
- Button for filters and actions
- Skeleton for loading states
- Tabs for category switching

### Color Scheme
- **BIG_ASSIST_OVER**: Primary blue/teal accent (playmaking theme)
- **HIGH_ASSIST_UNDER**: Amber/orange accent (fade/under theme)
- Hit rate badges: Emerald (100%), Green (97%+), Yellow (90%+), Muted (below)


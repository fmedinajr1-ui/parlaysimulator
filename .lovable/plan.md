

# Run Elite 3PT Shooters Analysis for Today's Slate

## Current State

| Item | Status |
|------|--------|
| Today's Date | January 30th, 2026 (Eastern Time) |
| Live Props Available | Yes - 30+ players with 3PT lines in `unified_props` |
| Category Sweet Spots | Missing - last analysis was Jan 29th |
| Page Status | Empty because no Jan 30th picks exist |

## Root Cause

The `category-props-analyzer` edge function hasn't run for today yet. This function:
1. Scans all players with games today
2. Calculates L10 hit rates, variance tiers, and projections
3. Saves qualifying THREE_POINT_SHOOTER picks to `category_sweet_spots`

## Solution

### Step 1: Trigger Category Props Analyzer

Call the edge function to analyze today's slate:

```typescript
POST /category-props-analyzer
{ "forceRefresh": true }
```

This will:
- Fetch all players with games on Jan 30th ET
- Calculate L10/L5 stats from `nba_player_game_logs`
- Apply v6.0 variance-edge matrix filters
- Save qualifying picks to `category_sweet_spots` with `analysis_date = '2026-01-30'`

### Step 2: Verify Results

After the analyzer runs, the `/tomorrow-3pt` page will automatically display:
- All THREE_POINT_SHOOTER category picks for today
- L10 hit rates, L5 averages, variance tiers
- Live sportsbook lines from `unified_props`

### Expected Elite 3PT Shooters

Based on the live props already in the database, potential elite candidates include:
- Derrick White (BOS) - Line: O 3.5
- Jrue Holiday (BOS) - Line: O 2.5
- Immanuel Quickley (TOR) - Line: O 2.5
- Mikal Bridges (NYK) - Line: O 2.5
- Luka Doncic (DAL) - Line: O 3.5

The analyzer will filter these based on:
- L10 hit rate (97%+ for elite tier)
- Variance tier (LOW/MEDIUM preferred)
- Floor protection (L10 Min >= 2 for tight lines)
- Hot/Cold streak detection (L5 vs L10 comparison)

### Files Involved (No Changes Required)

| File | Purpose |
|------|---------|
| `supabase/functions/category-props-analyzer/index.ts` | Edge function that runs the analysis |
| `src/hooks/useTodayProps.ts` | Frontend hook that fetches picks |
| `src/pages/Tomorrow3PT.tsx` | UI that displays the picks |

### How to Trigger

You can trigger the analysis from:
1. **SlateRefreshControls** component on the home page (runs all engines)
2. **SweetSpotPicksCard** refresh button
3. **Direct API call** via edge function invoke

## Implementation

1. Invoke `category-props-analyzer` with `forceRefresh: true`
2. Wait for processing to complete (typically 15-30 seconds)
3. Verify picks were saved to `category_sweet_spots` for Jan 30th
4. Refresh the `/tomorrow-3pt` page to see elite 3PT shooters


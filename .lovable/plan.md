

# Tighten MONITOR → HEDGE ALERT Thresholds

## Problem
78% of props labeled MONITOR yesterday ended up missing. The current `monitor` buffer thresholds are too generous — props sitting near the line are given "watch" status when they should already be flagged for action.

## Current Thresholds (buffer needed to stay in MONITOR)

| Quarter | onTrack | monitor | alert |
|---------|---------|---------|-------|
| Q1 (<25%) | 4.0 | 1.0 | -2.0 |
| Q2 (<50%) | 3.0 | 0.5 | -1.5 |
| Q3 (<75%) | 1.5 | 0.0 | -0.5 |
| Q4 (75%+) | 1.0 | -0.5 | -0.5 |

## Proposed Thresholds (raise monitor floor, tighten alert)

| Quarter | onTrack | monitor (was) | monitor (new) | alert (was) | alert (new) |
|---------|---------|---------------|---------------|-------------|-------------|
| Q1 | 4.0 | 1.0 | **2.0** | -2.0 | **-1.0** |
| Q2 | 3.0 | 0.5 | **1.5** | -1.5 | **-0.5** |
| Q3 | 1.5 | 0.0 | **0.5** | -0.5 | **0.0** |
| Q4 | 1.0 | -0.5 | **0.0** | -0.5 | **-0.25** |

This means a prop needs a larger buffer to stay in MONITOR — anything with a thin margin now escalates to HEDGE ALERT earlier.

## Files to Update (3 locations with identical thresholds)

| File | Change |
|------|--------|
| `src/lib/hedgeStatusUtils.ts` line 13-18 | Update `getBufferThresholds` monitor & alert values |
| `supabase/functions/hedge-live-telegram-tracker/index.ts` line 17-21 | Same threshold update (duplicated copy) |

No other code changes needed — all status logic flows through `getBufferThresholds`.


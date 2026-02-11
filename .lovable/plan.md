
# Add Outcome Filter Tabs to Day Parlay Detail Drawer

## Problem
When clicking a date on the P&L Calendar, the drawer shows ALL parlays including void ones (28 void on Feb 9th alone), making it hard to find the 13 winners and 10 losers.

## Solution
Add filter tabs (All / Won / Lost / Void) at the top of the `DayParlayDetail` drawer so users can quickly isolate the parlays they care about. Winners will be shown first by default, sorted by profit descending.

## Changes

### 1. `src/components/bot/DayParlayDetail.tsx`
- Add a local `filter` state with options: `all`, `won`, `lost`, `void`
- Render a row of small toggle buttons/tabs below the header showing counts (e.g., "Won (13)", "Lost (10)", "Void (28)")
- Filter the displayed parlays based on the active tab
- Default to `all` but exclude void from "All" view -- actually, keep "All" as truly all, but sort won first, then lost, then void/pending
- Sort won parlays by profit descending, lost by profit ascending (biggest losses first)

### 2. `src/components/bot/BotPnLCalendar.tsx`
- No changes needed -- clicking a calendar date already opens the `DayParlayDetail` drawer via `selectedDate` state. This flow works correctly.

## Technical Details

In `DayParlayDetail.tsx`:

```
- Add: const [filter, setFilter] = useState<'all' | 'won' | 'lost' | 'void'>('all');
- Compute filteredParlays by filtering on outcome, then sorting:
  - won: descending by profit_loss
  - lost: ascending by profit_loss
  - all: won first (desc profit), then lost (asc profit), then void/pending
- Render filter tabs using small Badge-style buttons with counts
- Update the description line to reflect filtered count vs total
```

The query already fetches all parlays for the date. We just add client-side filtering and better sorting so the 13 winners and 10 losers are easy to browse.

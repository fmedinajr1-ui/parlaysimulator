

# Add Dates to Recent Results Parlay Cards

## What's Happening Now

The "Recent Results" section shows settled parlays from the last 7 days, but there's no date shown on each card — so you can't tell which day a parlay was from.

## Change

**File**: `src/components/bot/BotParlayCard.tsx`

Add the parlay date to the card header row, displayed as a short date (e.g., "Feb 10") next to the leg count. The `parlay_date` field already exists on every parlay record, so no data changes are needed.

Specifically, after the leg count badge (`3L`, `4L`, etc.), add a small formatted date label using `date-fns` `format()`:

```
[Won] 4L  Feb 10  +8.8% $10 → +$474
```

### Technical Details

- Import `format` and `parseISO` from `date-fns` (already a project dependency)
- Format `parlay.parlay_date` as `"MMM d"` (e.g., "Feb 10")
- Render it as a small muted text span between the leg count and edge percentage
- Add a subtle dot separator for visual clarity

This is a one-file, ~5-line change.


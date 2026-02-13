

# Add Timestamps and Over/Under Labels to Bot Parlays

## What Changes

1. **Creation timestamp on each parlay card** -- shows the time the parlay was generated (e.g., "2:34 PM") next to the date
2. **Explicit OVER / UNDER label on totals legs** -- totals legs will clearly display "OVER" or "UNDER" with color coding so it's immediately obvious which side was picked

## How It Works

### Timestamp Display
Each BotParlayCard header already shows the date (e.g., "Feb 13"). It will now also show the creation time (e.g., "Feb 13 2:34 PM") pulled from the `created_at` column that already exists in the database.

### Totals Over/Under
Team total legs currently show something like `Total 220.5`. They will now show `Total OVER 220.5` or `Total UNDER 220.5` with green (over) or red (under) color styling to match the rest of the app's conventions.

---

## Technical Details

### File 1: `src/hooks/useBotEngine.ts`

Add `created_at` to the `BotParlay` interface (around line 50):

```typescript
export interface BotParlay {
  id: string;
  parlay_date: string;
  created_at?: string;  // <-- NEW
  legs: BotLeg[];
  // ...rest unchanged
}
```

### File 2: `src/components/bot/BotParlayCard.tsx`

**Timestamp in header** (around line 88-90):
- Parse `parlay.created_at` with `parseISO` and format as `'MMM d h:mm a'` (e.g., "Feb 13 2:34 PM")
- Replace the existing date-only display with this timestamp
- Falls back to date-only if `created_at` is missing

**Totals leg label** (around line 126):
- For team legs where `bet_type === 'total'`, the side value (`over`/`under`) is already being shown via `.toUpperCase()` but it's embedded in a muted color span
- Add color coding: green for OVER, red for UNDER on the side label specifically
- Ensure the format reads clearly as: `TeamA vs TeamB  Total OVER 220.5`


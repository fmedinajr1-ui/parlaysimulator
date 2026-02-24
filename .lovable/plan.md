

## Wire SlateRefreshControls into BotDashboard

### What This Does

The "Clean & Rebuild" button currently lives in `SlateRefreshControls.tsx` but that component is only used in an orphaned page. This adds it to the `/dashboard` route where it belongs.

### Change

**File: `src/pages/BotDashboard.tsx`**

1. Add import for `SlateRefreshControls` from `@/components/market/SlateRefreshControls`
2. Place `<SlateRefreshControls />` at the top of the Overview tab content (line 184), right above `<ResearchSummaryCard />`

This gives you both the "Refresh All Engines" and "Clean & Rebuild" buttons directly on the dashboard's Overview tab. No other files need to change -- all the logic (Telegram alert, voiding parlays, 10-step pipeline, progress bar) is already built into the component.


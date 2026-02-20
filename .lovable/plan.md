

## Add Per-Prop-Type Breakdown to Settlement Report

### What it does
Adds a new section to the Telegram settlement report that summarizes hit/miss rates by prop type (e.g., `3PT: 2/8 hit | REB: 4/5 hit`), making it easy to spot which stat categories are dragging down performance at a glance.

### Where it appears
In the daily settlement Telegram message, after the "TOP BUSTERS" section:

```text
--- LEG BREAKDOWN ---
Parlay #1 (Execution) - LOST
  [hit]  Jalen Brunson O24.5 PTS (actual: 28)
  [miss] Josh Hart O2.5 3PT (actual: 1)
  ...

--- TOP BUSTERS ---
Josh Hart O2.5 3PT: missed in 3 parlays (actual: 1)
...

--- PROP TYPE BREAKDOWN ---
PTS: 5/6 hit (83%)
REB: 3/4 hit (75%)
AST: 2/3 hit (67%)
3PT: 1/5 hit (20%)  <-- worst
```

### Technical Details

**File:** `supabase/functions/bot-send-telegram/index.ts`

**Change location:** Inside `formatSettlement()`, after the TOP BUSTERS block (around line 304), before the function returns.

**Logic:**
1. Iterate all legs across all `parlayDetails`
2. Aggregate hits and total counts per `prop_type` using the existing `propLabels` map
3. Sort by hit rate ascending (worst first) so problem categories jump out
4. Append a `--- PROP TYPE BREAKDOWN ---` section with one line per prop type: `{LABEL}: {hits}/{total} hit ({pct}%)`
5. Skip prop types with 0 legs

No other files need to change -- the `parlayDetails` data already contains all necessary fields (`prop_type`, `outcome`) from the settlement function.


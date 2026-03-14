

# Fix: Signal Direction + Odds Movement in Scanlines

## Two bugs found

### Bug 1: Every prop shows "UNDER"
**Root cause**: Line 1935 orders by `edge_pct` **ascending**, so the most negative edges (all UNDER signals) float to the top. With `limit(15)`, you only ever see UNDER picks.

**Fix**: Order by `ABS(edge_pct)` descending — or simpler, just remove the ascending sort and use descending order on the absolute value. Since Supabase doesn't support `ABS()` in `.order()`, we fetch more rows and sort client-side by `Math.abs(edge_pct)` descending, then take top 15. This gives a mix of OVER and UNDER based on strongest edges.

### Bug 2: Movement trail shows line but not odds
**Root cause**: The snapshot trail (lines 2002-2009) only stores/displays `book_line` values. There's no odds data in `mispriced_line_snapshots` — it only has `book_line`, `edge_pct`, and `scan_time`.

**Fix**: 
1. In the trail display, also fetch FanDuel odds history from `unified_props` or store odds in snapshots
2. Simpler approach: enrich the trail display with the FanDuel odds already fetched in `fdOddsMap` — show current odds alongside the line trail
3. Update the trail format from `10am: 22.5 → 12pm: 21.5` to `10am: 22.5 → 12pm: 21.5 (O:-110/U:-130)`

## Changes

### File: `supabase/functions/telegram-webhook/index.ts`

**Line 1935** — Fix sort to get mix of OVER and UNDER:
- Change `.order('edge_pct', { ascending: true })` to `.order('edge_pct', { ascending: false })` and increase `.limit(30)`
- After fetching, sort by `Math.abs(edge_pct)` descending and slice to 15

**Line 1984** — The side display is fine (it reads `l.signal` which is correctly OVER or UNDER from the engine). The issue is just the sort bringing only UNDER picks.

**Lines 2002-2009** — Enrich movement trail with current FanDuel odds:
- After the line trail, append the current FanDuel odds from `fdOddsMap` so user sees both line movement AND current juice


## Goal
Make the Live 2D terminal full-width and ensure live edges refresh aggressively with fresher revaluation.

## Changes

### 1. `src/pages/LiveGame.tsx` — remove side panel, go full-width
- Delete the `Multi-book prop comparison` `<aside>` (header, quota notice, `PropBookGrid`).
- Remove the `PropBookGrid` import.
- Collapse the two-column grid (`lg:grid-cols-[1fr_360px]`) to a single full-width container.
- Let `TerminalView` fill `h-[calc(100vh-180px)]` across the whole row.
- Keep the `multibook-props-sync` invoke loop (still feeds the quotes that power the edge engine), but tighten cadence from 60s → 30s and surface a small inline quota chip inside the terminal header instead of the removed aside.

### 2. `src/features/live3d/hooks.ts` — faster quote polling
- `usePropQuotes`: drop refresh from 30s → 15s.
- Subscribe to `live_prop_quotes` realtime inserts for `event_id` so new book updates push instantly instead of waiting on the interval.

### 3. `src/features/liveterminal/hooks/useTerminalFeed.ts` — fresher revaluation
- Reduce `market_signals` + `player_prop_hitrates` poll from 45s → 20s.
- Add realtime subscription to `live_prop_quotes` (in addition to `market_signals`) to retrigger edge math on new prices.
- Wrap `buildEdgeRows` + projection overlay in a `useMemo` keyed on `quotes` length + a stable hash of latest `fetched_at` so the table recomputes when quotes change but not on every render.
- Filter quotes to only the most recent snapshot per `(player_name, prop_type, bookmaker, line)` using `fetched_at` before de-vigging, so stale prices don't dilute fair %.
- Add a small `lastUpdated` timestamp returned from the hook for the UI to display.

### 4. `src/features/liveterminal/TerminalView.tsx` — header chip
- Show a "Updated 5s ago · N books" indicator using the new `lastUpdated` from `useTerminalFeed`.
- If quota exceeded prop is passed in, render an amber pill (replaces the removed aside warning).

## Out of scope
- Schema changes, edge-function changes, model-projection logic changes.
- Mobile redesign beyond the existing responsive stack.
- Removing `PropBookGrid` file (kept for other routes; just unused here).

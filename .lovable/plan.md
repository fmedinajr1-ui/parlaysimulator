

## Wire Live Pace, Real-Time Odds, and Web Worker Monte Carlo

### What This Does

Three upgrades to the Prop Intelligence Engine:

1. **Live Pace from ESPN** -- The `fetch-live-pbp` edge function already returns a `pace` value (estimated possessions per 48 min). Currently it sits unused. Wire it through `WarRoomLayout` into each prop card's `paceMult` calculation so the Pace Meter and projection formulas use real game data instead of the hardcoded `1.0`.

2. **Real-Time Odds for Edge Scores** -- `unified_props` already stores `over_price` and `under_price` (American odds). Build an odds lookup map in `WarRoomLayout` and pass it into the projection engine so every prop card displays a real Edge Score instead of `0`.

3. **Web Worker for Monte Carlo** -- Move the 10,000-iteration MC simulation off the main thread into a dedicated Web Worker. On lower-end devices the current synchronous loop blocks the UI; the worker runs it in the background and posts results back.

---

### Changes

**1. Wire Live Pace (`WarRoomLayout.tsx`)**

The `CustomerLiveGamePanel` already polls `fetch-live-pbp` every 8 seconds and gets back `pace`. Currently that pace data stays inside the panel. Changes:

- Extract the `useLivePBP` hook from `CustomerLiveGamePanel.tsx` into a shared file `src/hooks/useLivePBP.ts` so both the panel and `WarRoomLayout` can use it.
- In `WarRoomLayout`, call `useLivePBP(espnEventId, gameStatus)` to get `pbpData.pace`.
- Compute `paceMult = (pbpData?.pace ?? 100) / 100` (NBA average pace ~ 100 possessions/48min).
- Pass `paceMult` into each `WarRoomPropData` entry instead of the hardcoded `1.0`.
- The projection engine (`useLiveProjections.ts`) already uses `paceMult` in its blend formula -- this just feeds it real data.

**2. Wire Odds for Edge Scores (`WarRoomLayout.tsx`)**

- `useDeepSweetSpots` already fetches `over_price` and `under_price` from `unified_props` for every prop.
- In `WarRoomLayout`, build an `oddsMap: Map<string, { oddsOver, oddsUnder }>` keyed by `playerName-propType` from `enrichedSpots`.
- Compute `edgeScore` per prop card: `impliedProb = americanToImplied(overPrice)`, `edgeScore = (pOver - impliedProb) * 100`.
- Since `pOver` defaults to `0.5` pre-game, use the sweet spot's own hit rate and edge data to produce a meaningful pre-game edge.
- Pass `edgeScore`, `pOver`, `pUnder` into each `WarRoomPropData`.

**3. Web Worker for Monte Carlo**

New file: `src/workers/monteCarlo.worker.ts`
- Self-contained worker that receives `{ projected, sigmaRem, line, currentValue, simCount }` via `postMessage`.
- Runs the Box-Muller MC loop (same logic as `propMonteCarlo.ts`).
- Posts back `{ pOver }`.

New file: `src/hooks/useMonteCarloWorker.ts`
- Creates the worker once via `useRef`.
- Exposes `runSimulation(params): Promise<number>` that wraps the postMessage/onMessage round-trip.
- Falls back to synchronous `runPropMonteCarlo` if `Worker` is not available.

Update: `src/components/scout/warroom/WarRoomLayout.tsx`
- When `useMonteCarloMode` is ON, use the worker hook to compute `pOver` for each prop asynchronously.
- Store results in local state keyed by prop ID.
- Merge worker results into `propCards` before render.

---

### Technical Details

**Files created:**
- `src/hooks/useLivePBP.ts` -- extracted shared hook (move from `CustomerLiveGamePanel.tsx`)
- `src/workers/monteCarlo.worker.ts` -- Web Worker for MC simulation
- `src/hooks/useMonteCarloWorker.ts` -- React hook wrapping the worker

**Files modified:**
- `src/components/scout/CustomerLiveGamePanel.tsx` -- import `useLivePBP` from shared hook instead of inline
- `src/components/scout/warroom/WarRoomLayout.tsx` -- wire pace, odds, and MC worker into prop cards
- `src/hooks/useDeepSweetSpots.ts` -- ensure `over_price` and `under_price` are exposed on `DeepSweetSpot` (they're already fetched, just need to confirm they're passed through)

**No database changes required.** All data sources (`fetch-live-pbp` pace, `unified_props` odds) already exist.

### Build Order

1. Extract `useLivePBP` to shared hook
2. Create `monteCarlo.worker.ts`
3. Create `useMonteCarloWorker.ts`
4. Update `WarRoomLayout.tsx` to wire pace + odds + MC worker
5. Update `CustomerLiveGamePanel.tsx` to use shared hook


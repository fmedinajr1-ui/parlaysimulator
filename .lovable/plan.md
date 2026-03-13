

# Fix Bidirectional Scanner: L3 Cache Corruption + Environment-Only Gaps

## Critical Bug Found: L3 Cache Values Are Destroyed by Multi-Chunk Averaging

### The Problem
In `bot-matchup-defense-scanner/index.ts`, lines 332-375, the L3 cache batch-fetches game logs in chunks of 100 players. **The averaging loop (lines 364-372) runs inside the chunk loop but iterates over the ENTIRE `l3Cache` map**, not just the current chunk's players.

This means:
- Chunk 1 processes players A-100, converts their sums → averages
- Chunk 2 processes players 101-200, then re-iterates ALL of `l3Cache` and **divides the already-averaged values by `_games` again**
- After N chunks, values from chunk 1 have been divided N times

**Real example**: Amen Thompson's L3 points = `(16+23+23)/3 = 20.7`, but scanner stored `2.3` — value was divided multiple times.

**Impact**: Every L3 value in the cache is corrupted. The L3 contradiction filter (`l3 > line * 1.10`) is comparing garbage values, so it either:
- Lets through bad picks (UNDER recommended but player is actually hot)  
- Blocks good picks incorrectly

Aaron Nesmith UNDER 14.5 PTS has stored L3=15 (correct, since he's in the last chunk and only averaged once), and his L3 is above the line — the contradiction filter should have blocked him but didn't because `15 > 14.5 * 1.10 = 15.95` → false. He actually should be blocked since his last game was 29 pts. The threshold is too tight.

### Secondary Issue: "No Individual Player Data" Warnings
Many OVER matchups show "environment only" because `category_sweet_spots` doesn't have OVER-side entries for those players/teams. This is expected for non-star players but clutters the output. Not a bug per se — just noisy.

## Changes

### A. Fix L3 Cache Averaging (`bot-matchup-defense-scanner/index.ts`)
Move the averaging loop **outside** the chunk loop. Only convert sums → averages AFTER all chunks are processed.

```
Current (BROKEN):
for (let i = 0; i < players.length; i += CHUNK) {
  // fetch chunk...
  // accumulate sums per player...
  
  // BUG: This runs on ALL l3Cache entries every chunk
  for (const [name, entry] of l3Cache) {
    entry.points = entry.points / entry._games;  // re-divides previous chunks!
  }
}

Fixed:
for (let i = 0; i < players.length; i += CHUNK) {
  // fetch chunk...
  // accumulate sums per player...
}
// Average ONCE after all chunks
for (const [name, entry] of l3Cache) {
  if (entry._games > 0) {
    entry.points = Math.round((entry.points / entry._games) * 10) / 10;
    // ... same for other stats
  }
}
```

### B. Log L3 Cache Sample for Debugging
After building the cache, log 5 sample entries so we can verify values are correct in future runs.

### C. Tighten L3 Contradiction Filter Threshold (Optional)
Currently blocks UNDER if `l3 > line * 1.10`. With correct L3 values, also consider logging when L3 is between 1.0x and 1.1x of line as a warning rather than silent pass.

## Files to Edit
- `supabase/functions/bot-matchup-defense-scanner/index.ts` — move averaging loop outside chunk loop

## Expected Outcome
- L3 values will be correct (Amen Thompson → 20.7, not 2.3)
- L3 contradiction filter will properly block picks like Aaron Nesmith UNDER 14.5 (L3=15 actual avg from last 3 games)
- Bench under pool will be cleaner with proper recency-aware filtering


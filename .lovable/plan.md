

# Fix Integrity Alert: Void Button + Duplicate Threshold Mismatch

## Two Problems Identified

### 1. "Void Bad Parlays" button ignores duplicate leg violations
The integrity alert shows **6 duplicate leg combos** (OG Anunoby, Jalen Brunson, Anthony Edwards all at ×4 threes|over). But when you tap "Void Bad Parlays", it only queries for `leg_count < 3` (short parlays). Since all parlays have 3+ legs, it returns "No bad parlays found" — completely ignoring the actual violations the alert warned about.

### 2. Integrity check threshold doesn't match exposure cap
The exposure cap is set to **max 2 per player-prop-side combo** (`diversity-rebalance` enforces this). But the integrity check flags any combo appearing in **>1 parlay** (`ids.length > 1`). So a combo appearing in exactly 2 parlays (which is within cap) gets flagged as a violation. The threshold should be `> 2` to align with the cap.

## Changes

### A. Fix integrity check threshold (`bot-parlay-integrity-check/index.ts`)
- Change duplicate detection from `ids.length > 1` to `ids.length > 2` so it only flags combos exceeding the exposure cap of 2
- This stops false-positive alerts for combos that are actually within policy

### B. Fix "Void Bad Parlays" button (`telegram-webhook/index.ts`)
- Expand the `integrity_void_bad` callback to handle **both** violation types:
  1. Short parlays (`leg_count < 3`) — existing logic
  2. Excess duplicate legs — for any player-prop-side combo appearing in >2 parlays, void the lowest-probability excess parlays to bring each combo back to ≤2
- Report both actions in the response message

### C. Add exposure cap as a configurable constant
- Use `maxPlayerPropUsage = 2` as the shared threshold in both `integrity-check` and the void button handler, so they stay in sync with `diversity-rebalance`


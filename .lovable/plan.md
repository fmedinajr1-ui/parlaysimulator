

## Root Cause: NHL Parlays Voided by False Injury Match

### The Bug (Two Compounding Issues)

**1. Field name mismatch in NHL leg records**
The `nhl-floor-lock-daily` builder stores the player name as `player` (e.g., `player: "Owen Tippett"`), but the `pre-game-leg-verifier` reads `leg.player_name || leg.playerName || ''` (line 140). Since neither `player_name` nor `playerName` exists on NHL legs, every NHL player resolves to an **empty string**.

**2. Empty string matches everything in fuzzy matcher**
The `nameSimilarity` function (line 23) checks `n2.includes(n1)`. Since `"ja morant".includes("")` is **always true** in JavaScript, the empty string gets a similarity score of 0.9 — passing the 0.7 threshold. Every NHL leg falsely matches the first OUT player (Ja Morant), gets flagged for dropping, and since no swap is found, all legs are dropped and the parlay is voided.

### Changes

**1. Fix `pre-game-leg-verifier/index.ts`** (2 changes)

- **Line 140**: Add `leg.player` to the fallback chain:
  ```
  const playerName = leg.player_name || leg.playerName || leg.player || '';
  ```

- **Line 19-27** (`nameSimilarity`): Add empty string guard:
  ```
  if (!n1 || !n2 || n1.length < 2 || n2.length < 2) return 0;
  ```

**2. Fix `nhl-floor-lock-daily/index.ts`** leg builder

Locate the `buildLegRecord` helper and ensure it outputs `player_name` (matching the convention used by NBA strategies) alongside or instead of `player`. This prevents future mismatches.

### Expected Impact
NHL parlays will no longer be false-positive voided. The $650 in today's voided stakes would have been active. The empty-string guard also prevents any future field name inconsistencies from causing false matches.


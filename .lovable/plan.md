

# Remove MLB from Whale Proxy Mock Data

## Overview

Remove MLB from the mock data generator so only NBA, WNBA, NHL, and Tennis picks are shown during simulation.

---

## Current State

In `src/lib/whaleUtils.ts`, line 187, the sport selection includes MLB:

```typescript
const sport = randomChoice<Sport>(['NBA', 'WNBA', 'MLB', 'NHL', 'TENNIS']);
```

---

## Change Required

### File: `src/lib/whaleUtils.ts`

**Line 187** - Remove 'MLB' from the random selection array:

```typescript
// Before
const sport = randomChoice<Sport>(['NBA', 'WNBA', 'MLB', 'NHL', 'TENNIS']);

// After
const sport = randomChoice<Sport>(['NBA', 'WNBA', 'NHL', 'TENNIS']);
```

---

## Optional Cleanup

The MLB player data and stat types can remain in the file (they won't be used since MLB is never selected), or they can be removed for cleaner code:

- Remove MLB entries from `PLAYERS_WITH_TEAMS`
- Remove MLB entries from `TEAMS_BY_SPORT`
- Remove MLB entries from `STAT_TYPES`

---

## Clarification: Data Source

| Mode | Data Source |
|------|-------------|
| Simulate Live ON | Mock data generated in browser (fake) |
| Simulate Live OFF | Would query `whale_picks` table (currently empty) |

The current implementation is purely for UI demonstration. Real PP integration would require:
1. A backend service ingesting PP snapshots
2. Book consensus data feed
3. Signal detection logic running server-side
4. Populating the database tables


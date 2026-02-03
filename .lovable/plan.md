

# Live Hedge Recommendations - Final Stability Check

## Current System Status: READY WITH ONE FIX NEEDED

The Live Hedge Recommendations system is 95% ready. All major components are properly implemented:

| Component | Status | Details |
|-----------|--------|---------|
| HedgeRecommendation.tsx | Complete | Status badges, zone-aware probability, trend indicators, action recommendations |
| useSweetSpotLiveData.ts | Complete | 15s refresh, shot chart attachment, debug logging |
| useDeepSweetSpots.ts | Complete | Regex fix applied |
| useBatchShotChartAnalysis.ts | Needs Fix | Nickname matching not handling partial names |
| sweetSpot.ts types | Complete | All types defined |

---

## One Issue to Fix: Partial Team Name Matching

**Problem**: Console logs show opponent names like:
- "Indiana Pacer" (missing 's')
- "Philadelphia 76er" (missing 's')
- "Chicago Bull" (missing 's')

The `normalizeOpponent` function's `includes()` check should work, but it's not catching these because the check is:
```typescript
if (lower.includes(nickname)) // e.g., "indiana pacer".includes("pacers") = FALSE
```

The partial match is checking if the nickname is IN the opponent string, not if the opponent string contains a partial match OF the nickname.

**Fix**: Change the partial matching logic to also check if the nickname STARTS WITH the opponent string (minus trailing characters):

```typescript
// Also try if nickname starts with a portion of the opponent
for (const [nickname, abbrev] of Object.entries(NICKNAME_ABBREV_MAP)) {
  if (lower.includes(nickname) || nickname.startsWith(lower.slice(-6))) {
    return abbrev;
  }
}
```

Or simpler - add singular forms to the mapping:
```typescript
const NICKNAME_ABBREV_MAP: Record<string, string> = {
  // ... existing entries
  'pacer': 'IND',
  'bull': 'CHI',
  '76er': 'PHI',
  'celtic': 'BOS',
  'nugget': 'DEN',
  'hawk': 'ATL',
  'knick': 'NYK',
  // etc.
};
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useBatchShotChartAnalysis.ts` | Add singular team nickname forms to NICKNAME_ABBREV_MAP |

---

## Implementation Details

Add these singular forms to handle API responses that truncate the 's':

```typescript
// Additional singular forms for partial API matches
'hawk': 'ATL',
'celtic': 'BOS',
'net': 'BKN',
'hornet': 'CHA',
'bull': 'CHI',
'cavalier': 'CLE',
'cav': 'CLE',
'maverick': 'DAL',
'mav': 'DAL',
'nugget': 'DEN',
'piston': 'DET',
'warrior': 'GSW',
'rocket': 'HOU',
'pacer': 'IND',
'clipper': 'LAC',
'laker': 'LAL',
'grizzly': 'MEM',
'buck': 'MIL',
'timberwolf': 'MIN',
'wolf': 'MIN',
'pelican': 'NOP',
'knick': 'NYK',
'sun': 'PHX',
'blazer': 'POR',
'king': 'SAC',
'spur': 'SAS',
'raptor': 'TOR',
'wizard': 'WAS',
'76er': 'PHI',
'sixer': 'PHI',
```

---

## Expected Results After Fix

1. **All opponent names resolve correctly**:
   - "Indiana Pacer" → IND
   - "Philadelphia 76er" → PHI
   - "Chicago Bull" → CHI

2. **Shot chart matchups found for all points/threes spots**:
   - Summary will show near 100% matchup attachment rate

3. **Live hedge recommendations fully operational**:
   - Zone-aware probability adjustments
   - Context-aware messaging
   - Trend indicators
   - Actionable hedge sizing

---

## System Is Ready For Games

Once this small fix is applied, the system is fully stable and ready:

- Live data enrichment at 15-second intervals
- Shot chart analysis integrated into hedge probability
- Status-based color coding (Green → Yellow → Orange → Red → Purple)
- Trend direction indicators
- Rate analysis with "need X/min" context
- Profit lock detection for middle opportunities


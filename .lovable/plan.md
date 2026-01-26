

## Enhance Player Detection and Movement Tracking

### Overview
Upgrade the Scout vision analysis system to reliably detect player jerseys, track movement across frames, and populate the movement-related state fields that feed into Lock Mode's 4-gate validation.

---

### Current Issues Identified

1. **Zero Vision Signals on Live Play**: Console logs show `visionSignals: 0` even when scene is classified as `live_play` with 28 prop edges generated
2. **Jersey Detection Unreliable**: The AI prompt asks for jersey identification but signals often come back empty
3. **Single-Frame Analysis**: No temporal tracking of player movement between consecutive frames
4. **Movement Counters Not Populated**: `sprintCount`, `handsOnKneesCount`, `slowRecoveryCount` rarely increment from vision
5. **Quarter Snapshots Not Recording**: `quarter_player_snapshots` table is empty, so Lock Mode lacks verified first-half data

---

### Enhancement Plan

#### Phase 1: Fix Vision Signal Extraction

**Problem**: Vision analysis runs but returns empty `visionSignals` array

**Changes to `scout-agent-loop/index.ts`:**

1. **Add Fallback Signal Extraction**: When AI returns empty signals, use the existing `extractBasicSignals()` function more aggressively
2. **Lower Confidence Threshold**: Accept "low" confidence signals instead of filtering them out
3. **Add Jersey-Free Observations**: Allow team-level fatigue/energy observations even without specific player IDs
4. **Parse AI Response More Robustly**: Handle cases where AI returns signals in different formats

```typescript
// After vision analysis, if no signals detected but scene is worthy:
if (visionSignals.length === 0 && sceneClassification.isAnalysisWorthy) {
  // Try extracting from overall assessment text
  const fallbackSignals = extractBasicSignals(
    result.overallAssessment || '', 
    gameContext
  );
  visionSignals = fallbackSignals;
}
```

---

#### Phase 2: Multi-Frame Movement Tracking

**Problem**: Single frame analysis can't detect motion patterns

**New Capability**: Track position changes across consecutive frames

**Implementation:**

1. **Create Frame Buffer**: Store last 3-5 frames with timestamps
2. **Add Motion Vector Prompt**: Ask AI to compare player positions between frames
3. **Calculate Movement Deltas**: Estimate speed based on court position changes

**New Prompt Section:**
```
MOVEMENT ANALYSIS (compare to previous frame):
- Identify players who moved significantly (sprinted, cut, crashed boards)
- Identify players who are stationary or slow-moving (fatigue indicator)
- Track defensive rotations and transitions
```

**New Signal Types:**
- `sprint_detected`: Player covered significant court distance rapidly
- `stationary_warning`: Player showing minimal movement (fatigue)
- `fast_transition`: Player leading/trailing on break
- `box_out_crash`: Player aggressively positioning for rebound

---

#### Phase 3: Enhanced Jersey Detection Pipeline

**Problem**: AI frequently misses or misreads jersey numbers

**Solution**: Two-pass detection system

**Pass 1 - Team Color Detection:**
```typescript
// First identify which team jersey colors are visible
{
  "teamsVisible": ["home", "away", "both"],
  "homeJerseyColor": "white",
  "awayJerseyColor": "purple"
}
```

**Pass 2 - Number OCR with Context:**
```
JERSEY NUMBER EXTRACTION:
For each player clearly visible:
1. Identify jersey color (determines team)
2. Read number on front/back
3. Cross-reference with roster table provided
4. Only report if number is clearly readable (confidence high)

If number unclear but team is visible:
- Report as "Unknown #{team} player" with position estimate
```

---

#### Phase 4: Accumulative Counter Population

**Problem**: `sprintCount`, `handsOnKneesCount`, `slowRecoveryCount` stay at 0

**Solution**: Wire vision signals to counters with decay

**Changes to `updatePlayerStatesFromVision()`:**

```typescript
// Increment counters from vision signals
signals.forEach(signal => {
  const player = playerStates.get(signal.player);
  if (!player) return;
  
  switch (signal.signalType) {
    case 'fatigue':
      if (signal.observation?.includes('hands on knees')) {
        player.handsOnKneesCount++;
      }
      if (signal.observation?.includes('slow') || signal.value > 5) {
        player.slowRecoveryCount++;
      }
      break;
    
    case 'speed':
    case 'effort':
      if (signal.value > 3 && signal.observation?.includes('sprint')) {
        player.sprintCount++;
      }
      break;
  }
});
```

---

#### Phase 5: Quarter Snapshot Recording Fix

**Problem**: `record-quarter-snapshot` has no logs, table is empty

**Root Cause**: Quarter-ending flags (`isQ1Ending`, etc.) may not be triggering correctly

**Diagnostic Steps:**

1. Add explicit logging when quarter end conditions are checked
2. Verify `fetch-live-pbp` is returning the period and clock correctly
3. Check if `quarterSnapshotTriggered` ref is preventing valid triggers

**Fix in `fetch-live-pbp/index.ts`:**
```typescript
// More robust quarter-end detection
const clockSeconds = parseClockToSeconds(gameTime);
const isQ1Ending = period === 1 && clockSeconds !== null && clockSeconds <= 30;
const isQ2Ending = period === 2 && clockSeconds !== null && clockSeconds <= 30;

// Log when quarter boundaries are detected
if (isQ1Ending || isQ2Ending || isQ3Ending || isQ4Ending) {
  console.log(`[PBP Fetch] Quarter boundary detected: Q${period} ending at ${gameTime}`);
}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/scout-agent-loop/index.ts` | Add fallback signal extraction, multi-frame tracking, counter population |
| `supabase/functions/analyze-live-frame/index.ts` | Add team color detection, improve jersey number OCR prompt |
| `supabase/functions/fetch-live-pbp/index.ts` | Add quarter-end boundary logging and verification |
| `src/hooks/useScoutAgentState.ts` | Wire vision signals to accumulative counters, add debug logging for quarter detection |
| `src/types/scout-agent.ts` | Add new movement signal types |

---

### Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Vision signals per live play | 0 | 3-8 signals |
| Jersey identification rate | ~20% | ~60% |
| Movement counter updates | Rare | Every analysis |
| Quarter snapshots recorded | 0 | 4 per game |
| Lock Mode data readiness | ❌ | ✓ |

---

### Technical Summary

This enhancement focuses on three critical gaps:

1. **Signal Extraction**: Even when the AI describes fatigue/energy in its `overallAssessment`, we're not parsing it into structured signals

2. **Counter Population**: The state fields exist but the pipeline from vision signal to counter increment is broken

3. **Quarter Boundaries**: The snapshot trigger conditions aren't being met, likely because clock parsing or period detection has edge cases

After these fixes, Lock Mode will have:
- Real vision-derived fatigue scores (not just defaults)
- Actual sprint/fatigue gesture counts for Gate 4 validation
- Q1+Q2 snapshots with verified first-half minutes and stats


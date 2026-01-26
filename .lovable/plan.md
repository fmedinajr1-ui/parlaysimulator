

## Commercial/Timeout Auto-Refresh System

### Overview
Implement an intelligent refresh system that triggers comprehensive data updates whenever a commercial break or timeout is detected. These natural breaks in gameplay are the perfect opportunity to ensure all data is fresh and synchronized before action resumes.

---

### Current Flow Analysis

When the scene classification detects a commercial or timeout:
1. `scout-agent-loop` returns `isAnalysisWorthy: false` with `sceneType: 'commercial'` or `'timeout'`
2. Frontend increments `commercialSkipCount` but takes no other action
3. PBP continues polling every 10 seconds independently
4. **No coordinated refresh happens**

---

### Proposed Enhancement

Trigger automatic refresh of all data sources during commercial/timeout scenes:

```text
+----------------------------------------------------------+
|              Commercial/Timeout Detected                  |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|              COORDINATED REFRESH ACTIONS                  |
+----------------------------------------------------------+
| 1. Immediate PBP refresh (get latest box scores)          |
| 2. Re-run data projection (update expectedFinal values)  |
| 3. Reset frame buffer (clear stale vision data)          |
| 4. Quarter snapshot check (record if boundary detected)  |
| 5. Session auto-save (persist current state)             |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|              READY FOR NEXT LIVE ACTION                   |
+----------------------------------------------------------+
```

---

### Implementation Changes

#### 1. Frontend Response Handler (`useScoutAgentState.ts`)

**Add break-triggered refresh logic in `processAgentResponse`:**

When `sceneType` is `'commercial'` or `'timeout'`:
- Trigger immediate PBP refresh (`refreshPBPData()`)
- Trigger data projection re-run
- Force session save
- Log the refresh event

```typescript
// New: Detect commercial/timeout breaks for auto-refresh
const isBreakScene = ['commercial', 'timeout', 'dead_time'].includes(
  response.sceneClassification.sceneType
);

if (isBreakScene && !prev.lastBreakRefreshTime || 
    (Date.now() - prev.lastBreakRefreshTime > 10000)) {
  // Trigger refresh cascade (debounced to prevent spam)
  setTimeout(() => triggerBreakRefresh(), 100);
}
```

#### 2. New Break Refresh Function (`useScoutAgentState.ts`)

**Add `triggerBreakRefresh` callback:**

```typescript
const triggerBreakRefresh = useCallback(async () => {
  console.log('[Scout Agent] Break detected - triggering refresh cascade');
  
  // 1. Refresh PBP data immediately
  const pbpResult = await refreshPBPData();
  console.log('[Scout Agent] Break refresh: PBP', pbpResult.success ? '✓' : '✗');
  
  // 2. Force save session state
  await saveSession();
  console.log('[Scout Agent] Break refresh: Session saved');
  
  // 3. Update last break refresh time to debounce
  setState(prev => ({
    ...prev,
    lastBreakRefreshTime: Date.now(),
  }));
  
}, [refreshPBPData, saveSession]);
```

#### 3. Component Integration (`ScoutAutonomousAgent.tsx`)

**Expose break refresh trigger and add data projection re-run:**

```typescript
// In ScoutAutonomousAgent, after detecting a break
if (data?.sceneClassification?.sceneType === 'commercial' || 
    data?.sceneClassification?.sceneType === 'timeout') {
  console.log('[Autopilot] Break detected - running refresh cascade');
  
  // Run data projection immediately to update all edges
  await runDataOnlyProjection();
  
  // Force PBP fetch
  await fetchPBPData();
}
```

#### 4. State Schema Update (`scout-agent.ts`)

**Add tracking field:**

```typescript
interface ScoutAgentState {
  // ... existing fields ...
  lastBreakRefreshTime: number | null;  // NEW: Debounce break refreshes
}
```

#### 5. Edge Function Response Enhancement (`scout-agent-loop`)

**Return refresh hint for break scenes:**

```typescript
// When returning early for non-analysis-worthy scenes
return new Response(
  JSON.stringify({
    sceneClassification,
    gameTime: sceneClassification.gameTime || currentGameTime,
    score: sceneClassification.score,
    // NEW: Signal frontend to trigger refresh
    shouldRefresh: sceneClassification.sceneType === 'commercial' || 
                   sceneClassification.sceneType === 'timeout',
    refreshReason: sceneClassification.sceneType,
  }),
  { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
);
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useScoutAgentState.ts` | Add `lastBreakRefreshTime` state, `triggerBreakRefresh` callback, modify `processAgentResponse` to detect breaks |
| `src/types/scout-agent.ts` | Add `lastBreakRefreshTime` to `ScoutAgentState` interface |
| `src/components/scout/ScoutAutonomousAgent.tsx` | Add break detection in `runAgentLoop`, trigger refresh cascade |
| `supabase/functions/scout-agent-loop/index.ts` | Add `shouldRefresh` and `refreshReason` to break response |

---

### Refresh Actions During Breaks

| Action | Purpose | Timing |
|--------|---------|--------|
| **PBP Refresh** | Get latest box scores, substitutions, fouls | Immediate |
| **Data Projection** | Recalculate all expectedFinal values | After PBP |
| **Session Save** | Persist current state for recovery | After projection |
| **Quarter Check** | Verify if quarter boundary crossed | During PBP update |

---

### Debouncing Logic

To prevent refresh spam during extended commercial breaks:
- Track `lastBreakRefreshTime` timestamp
- Only trigger refresh if 10+ seconds since last break refresh
- This ensures we refresh at most once per 10 seconds during breaks
- Resets when live play resumes

---

### Expected Behavior

**During a timeout:**
1. Scene classified as `timeout`
2. Console logs: `[Scout Agent] Break detected - triggering refresh cascade`
3. PBP data refreshed immediately
4. Data projections recalculated
5. All prop edges updated with fresh stats
6. Session auto-saved
7. Ready for action when timeout ends

**During commercials:**
1. Scene classified as `commercial`
2. Same refresh cascade triggers
3. Multiple commercial frames use 10s debounce to prevent spam
4. Each 10s window gets one refresh

---

### Benefits

1. **Fresh Data**: Box scores are always current when action resumes
2. **Accurate Projections**: expectedFinal values use latest stats
3. **No Stale State**: Quarter boundaries don't get missed
4. **Session Safety**: State is saved during every break
5. **Smart Debouncing**: Avoids API spam during long commercial breaks


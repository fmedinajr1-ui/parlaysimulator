

## Quarter Diagnostics Recording System for Halftime Locks

### Overview
Create a quarter-end snapshot system that automatically records comprehensive player diagnostics at Q1, Q2 (halftime), Q3, and Q4 boundaries. This ensures Lock Mode has verified first-half data to generate reliable 3-leg slips.

---

### Architecture

```text
+--------------------------------------------------------------------+
|                   Quarter Snapshot Pipeline                         |
+--------------------------------------------------------------------+
|                                                                    |
|  TRIGGER: Period Transition Detection                               |
|  +----------------------------------------------------------+     |
|  | fetch-live-pbp detects:                                   |     |
|  | - isQ1Ending (period=1, clock<=30s)                       |     |
|  | - isQ2Ending (period=2, clock<=30s) -> HALFTIME          |     |
|  | - isQ3Ending (period=3, clock<=30s)                       |     |
|  | - isQ4Ending (period=4, clock<=30s) -> FINAL              |     |
|  +----------------------------------------------------------+     |
|                              |                                      |
|                              v                                      |
|  CAPTURE: Quarter Snapshot Edge Function                            |
|  +----------------------------------------------------------+     |
|  | record-quarter-snapshot:                                  |     |
|  | - Captures all PlayerLiveState for each rostered player   |     |
|  | - Records boxScore stats (pts, reb, ast, min, fouls)      |     |
|  | - Records vision diagnostics (fatigue, effort, speed)     |     |
|  | - Records rotation data (role, stability, stint info)     |     |
|  | - Stores to quarter_player_snapshots table                |     |
|  +----------------------------------------------------------+     |
|                              |                                      |
|                              v                                      |
|  STORAGE: Database Tables                                           |
|  +----------------------------------------------------------+     |
|  | quarter_player_snapshots:                                 |     |
|  | - event_id, quarter (1-4), player_name, team             |     |
|  | - minutes_played, points, rebounds, assists, fouls        |     |
|  | - fatigue_score, effort_score, speed_index                |     |
|  | - rotation_role, on_court_stability, foul_risk_level      |     |
|  | - risk_flags, visual_flags, hands_on_knees_count          |     |
|  | - captured_at                                              |     |
|  +----------------------------------------------------------+     |
|                              |                                      |
|                              v                                      |
|  CONSUMPTION: Lock Mode Engine                                      |
|  +----------------------------------------------------------+     |
|  | At halftime (Q2 end), Lock Mode queries:                  |     |
|  | - Q1 + Q2 snapshots for each player                       |     |
|  | - Validates Gate 1: 14+ combined minutes, role stable     |     |
|  | - Validates Gate 4: Fatigue progression across quarters   |     |
|  | - Generates high-confidence 3-leg slip                    |     |
|  +----------------------------------------------------------+     |
|                                                                    |
+--------------------------------------------------------------------+
```

---

### Database Changes

**New Table: `quarter_player_snapshots`**

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| event_id | TEXT | Game event ID |
| espn_event_id | TEXT | ESPN event ID for cross-reference |
| quarter | INT | 1, 2, 3, or 4 |
| player_name | TEXT | Player name |
| team | TEXT | Team abbreviation |
| minutes_played | NUMERIC | Cumulative minutes at quarter end |
| points | INT | Cumulative points |
| rebounds | INT | Cumulative rebounds |
| assists | INT | Cumulative assists |
| fouls | INT | Cumulative fouls |
| turnovers | INT | Cumulative turnovers |
| threes | INT | Cumulative 3-pointers made |
| fatigue_score | INT | Vision-derived fatigue (0-100) |
| effort_score | INT | Vision-derived effort (0-100) |
| speed_index | INT | Vision-derived speed (0-100) |
| rebound_position_score | INT | Vision-derived box-out quality |
| rotation_role | TEXT | STARTER, CLOSER, BENCH_CORE, BENCH_FRINGE |
| on_court_stability | NUMERIC | 0-1 stability score |
| foul_risk_level | TEXT | LOW, MED, HIGH |
| player_role | TEXT | PRIMARY, SECONDARY, SPACER, BIG |
| visual_flags | JSONB | Active visual indicators |
| hands_on_knees_count | INT | Fatigue gesture count |
| slow_recovery_count | INT | Recovery slowness count |
| sprint_count | INT | Sprint explosiveness count |
| captured_at | TIMESTAMPTZ | Snapshot timestamp |
| created_at | TIMESTAMPTZ | Record creation time |

**Indexes:**
- `idx_quarter_snapshots_event_quarter` on (event_id, quarter)
- `idx_quarter_snapshots_player` on (player_name, event_id)

---

### Edge Function: `record-quarter-snapshot`

**Purpose:** Capture comprehensive player diagnostics at quarter boundaries.

**Trigger Points:**
- Q1 end: When period=1 and clock <= 30s
- Q2 end (Halftime): When period=2 and clock <= 30s OR isHalftime flag
- Q3 end: When period=3 and clock <= 30s
- Q4 end: When period=4 and clock <= 30s OR isGameOver flag

**Input:**
```json
{
  "eventId": "401234567",
  "espnEventId": "401234567",
  "quarter": 2,
  "gameTime": "Q2 0:00",
  "playerStates": {
    "LeBron James": { 
      "fatigueScore": 45, 
      "rotation": { "rotationRole": "STARTER" }, 
      "boxScore": { "points": 12, "rebounds": 4 },
      ...
    }
  },
  "pbpPlayers": [
    { "playerName": "LeBron James", "minutes": 18.5, "points": 12, "fouls": 2, ... }
  ]
}
```

**Output:**
```json
{
  "success": true,
  "quarter": 2,
  "playersRecorded": 24,
  "snapshotId": "uuid"
}
```

---

### Frontend Integration

**Modify `useScoutAgentState.ts`:**

1. Add quarter-end detection in `updatePBPData`:
```typescript
// Detect Q1 ending
const isQ1Ending = data.period === 1 && totalClockSeconds <= 30;

// On any quarter end, trigger snapshot
if (isQ1Ending || data.isQ2Ending || data.isQ3Ending || data.isQ4Ending) {
  recordQuarterSnapshot(data.period, updatedStates, data);
}
```

2. Add `recordQuarterSnapshot` function:
```typescript
const recordQuarterSnapshot = async (
  quarter: number,
  playerStates: Map<string, PlayerLiveState>,
  pbpData: LivePBPData
) => {
  await supabase.functions.invoke('record-quarter-snapshot', {
    body: {
      eventId: state.gameContext?.eventId,
      espnEventId: state.gameContext?.espnEventId,
      quarter,
      gameTime: pbpData.gameTime,
      playerStates: Object.fromEntries(playerStates),
      pbpPlayers: pbpData.players,
    },
  });
};
```

**Modify `fetch-live-pbp`:**
- Add `isQ1Ending` detection (period=1, clock<=30s)
- Add `isQ3Ending` detection (period=3, clock<=30s) 
- Add `isQ4Ending` detection (period=4, clock<=30s OR isGameOver)

---

### Lock Mode Integration

**Modify `buildLockModeSlip` in `lockModeEngine.ts`:**

At halftime, query the stored Q1 + Q2 snapshots to validate:

```typescript
// Gate 1: Minutes validation with quarter data
const halfSnapshot = await getQuarterSnapshot(eventId, 2, playerName);
if (halfSnapshot) {
  const firstHalfMinutes = halfSnapshot.minutes_played;
  const isStarterOrCloser = halfSnapshot.rotation_role === 'STARTER' || 
                            halfSnapshot.rotation_role === 'CLOSER';
  const noFoulTrouble = halfSnapshot.fouls <= 3;
  
  // Require 14+ 1H minutes for Lock Mode
  if (firstHalfMinutes < 14 || !isStarterOrCloser || !noFoulTrouble) {
    return { passed: false, reason: 'First-half criteria not met' };
  }
}

// Gate 4: Fatigue trend across quarters
const q1Snapshot = await getQuarterSnapshot(eventId, 1, playerName);
const q2Snapshot = await getQuarterSnapshot(eventId, 2, playerName);

if (q1Snapshot && q2Snapshot) {
  const fatigueTrend = q2Snapshot.fatigue_score - q1Snapshot.fatigue_score;
  // If fatigue spiked 15+ points Q1->Q2, boost UNDER confidence
  if (fatigueTrend >= 15 && edge.lean === 'UNDER') {
    confidence += 5; // Bonus for verified fatigue progression
  }
}
```

---

### UI Enhancements

**Add Quarter Snapshot Indicator to Scout UI:**

Show checkmarks when each quarter's diagnostics are successfully recorded:

```
Quarter Diagnostics: [✓ Q1] [✓ Q2] [○ Q3] [○ Q4]
                      12:45    Now
```

**Lock Mode Tab Enhancement:**

Display data source verification:

```
Lock Mode - Data Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Q1 Snapshot: 24 players recorded
✓ Q2 Snapshot: 24 players recorded  
✓ First-half minutes verified
✓ Rotation roles confirmed
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ready to generate 3-leg slip
```

---

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/xxx_quarter_player_snapshots.sql` | Create | New table for quarter diagnostics |
| `supabase/functions/record-quarter-snapshot/index.ts` | Create | Edge function to capture snapshots |
| `supabase/functions/fetch-live-pbp/index.ts` | Modify | Add Q1/Q3/Q4 ending detection |
| `supabase/config.toml` | Modify | Add new function config |
| `src/hooks/useScoutAgentState.ts` | Modify | Add quarter snapshot trigger logic |
| `src/types/scout-agent.ts` | Modify | Add quarter snapshot types |
| `src/lib/lockModeEngine.ts` | Modify | Query quarter snapshots for validation |
| `src/components/scout/LockModeTab.tsx` | Modify | Add data verification display |

---

### Data Flow Summary

1. **Q1 End (12 min mark):** Record first snapshot with early rotation signals
2. **Q2 End (Halftime):** Record critical halftime snapshot with full first-half data
3. **Lock Mode Activation:** Query Q1+Q2 snapshots to validate all 4 gates
4. **Q3/Q4 Ends:** Continue recording for post-game analysis and backtest enrichment

---

### Benefits

- **Verified First-Half Data:** Lock Mode gates use actual recorded stats, not estimates
- **Fatigue Trend Analysis:** Compare Q1 vs Q2 diagnostics for progression signals
- **Rotation Certainty:** Confirm STARTER/CLOSER roles from actual quarter data
- **Backtest Enrichment:** Quarter snapshots feed into `run-lock-mode-backtest` for more accurate historical simulation
- **Audit Trail:** Complete diagnostic history for each game enables model improvement


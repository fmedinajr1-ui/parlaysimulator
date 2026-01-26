
## Lock Mode Live Line Scanner

### Problem Statement

The current Lock Mode system builds a 3-leg slip using **static lines** (from pregame or initial data). During live games, book lines move up and down as the game progresses. This creates two issues:

1. **Missed Optimal Entry**: A pick with certainty might become MORE valuable when the line moves in our favor
2. **Trap Lines**: A line that looks good might have moved to trap bettors (book knows something we don't)
3. **Stale Recommendations**: The slip shows the original line even if it's no longer available

### Proposed Solution: Live Line Scanner

Add a "Line Timing" layer to Lock Mode that:
1. **Scans live lines** for each candidate pick in real-time
2. **Compares live line vs. projection** to determine optimal bet timing
3. **Shows a "BET NOW" vs "WAIT" signal** for each leg
4. **Auto-updates the slip** when a line hits the optimal entry zone

---

### Core Concept: The "Line Fit" Score

For each Lock Mode candidate, calculate a **Line Fit** score:

```text
Line Fit = Certainty × Line Favorability
```

Where:
- **Certainty** = projection confidence (already calculated)
- **Line Favorability** = how favorable the current book line is vs. our projection

**Example:**
| Player | Projection | Original Line | Live Line | Line Fit | Status |
|--------|-----------|---------------|-----------|----------|--------|
| Vucevic REB O | 11.5 | 9.5 | 8.5 | HIGH | BET NOW 🟢 |
| Garland AST O | 8.2 | 7.5 | 8.5 | LOW | WAIT ⏳ |
| Brown PTS O | 24.5 | 22.5 | 20.5 | OPTIMAL | BET NOW 🟢 |

---

### Technical Architecture

#### 1. New Data Flow

```text
┌──────────────────────────────────────────────────────────────┐
│                    LOCK MODE TAB                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  useLockModeLineScanner(edges, eventId)                 │ │
│  │    └── For each candidate edge:                         │ │
│  │         ├── Fetch live line (useLiveOdds)               │ │
│  │         ├── Compare: liveLinevs. projection             │ │
│  │         ├── Calculate: lineFitScore                     │ │
│  │         └── Determine: status (BET_NOW / WAIT / AVOID)  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                              ↓                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Enhanced LockModeLegCard                               │ │
│  │    ├── Original projection + edge                       │ │
│  │    ├── Live Line: 8.5 (was 9.5)                         │ │
│  │    ├── Line Fit: 92% 🟢                                 │ │
│  │    └── Status: BET NOW                                  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### 2. New Hook: `useLockModeLineScanner`

**Purpose**: Scan live lines for Lock Mode candidates and determine optimal timing

**Input:**
- `edges: PropEdge[]` - Lock Mode candidates
- `eventId: string` - ESPN event ID for API calls
- `scanInterval: number` - How often to refresh (default: 30s)

**Output:**
```typescript
interface LineStatus {
  player: string;
  prop: PropType;
  originalLine: number;   // From edge.line
  liveBook Line: number;    // From live API
  lineMovement: number;   // liveLine - originalLine
  lineFitScore: number;   // 0-100
  status: 'BET_NOW' | 'WAIT' | 'AVOID' | 'LOADING';
  statusReason: string;   // "Line moved 1.0 in your favor"
  lastUpdated: Date;
}

interface UseLockModeLineScannerResult {
  lineStatuses: Map<string, LineStatus>;
  isScanning: boolean;
  lastScanTime: Date | null;
  optimalLegs: LineStatus[];  // Legs currently optimal to bet
  scanNow: () => Promise<void>;
}
```

#### 3. Line Fit Scoring Logic

```typescript
function calculateLineFitScore(
  projection: number,
  liveLine: number,
  lean: 'OVER' | 'UNDER',
  originalLine: number
): { score: number; status: 'BET_NOW' | 'WAIT' | 'AVOID' } {
  
  // Calculate edge vs. live line
  const liveEdge = lean === 'OVER' 
    ? projection - liveLine 
    : liveLine - projection;
  
  // Calculate original edge
  const originalEdge = lean === 'OVER'
    ? projection - originalLine
    : originalLine - projection;
  
  // Line moved in our favor?
  const lineFavorability = liveEdge - originalEdge;
  
  // Scoring rules:
  if (liveEdge >= 2.5) {
    // Strong edge with live line
    if (lineFavorability >= 0.5) {
      return { score: 95, status: 'BET_NOW' };  // Line moved in favor
    }
    return { score: 85, status: 'BET_NOW' };  // Good edge maintained
  }
  
  if (liveEdge >= 1.5) {
    // Moderate edge
    if (lineFavorability < -1.0) {
      return { score: 50, status: 'WAIT' };  // Line moved against us
    }
    return { score: 75, status: 'BET_NOW' };
  }
  
  if (liveEdge >= 0.5) {
    return { score: 60, status: 'WAIT' };  // Edge is thin, wait for better line
  }
  
  return { score: 30, status: 'AVOID' };  // Edge disappeared
}
```

#### 4. "Trap Line" Detection

Add logic to detect when lines look too good (potential trap):

```typescript
function detectTrapLine(
  projection: number,
  liveLine: number,
  lean: 'OVER' | 'UNDER',
  lineMovementHistory: number[]
): boolean {
  const edge = lean === 'OVER' 
    ? projection - liveLine 
    : liveLine - projection;
  
  // If edge is HUGE (>5), the book likely knows something
  if (edge > 5) {
    console.log('[Lock Mode] TRAP WARNING: Edge too large');
    return true;
  }
  
  // If line moved rapidly in one direction, be cautious
  const recentMovement = lineMovementHistory.slice(-3);
  const totalMovement = recentMovement.reduce((a, b) => a + b, 0);
  if (Math.abs(totalMovement) > 3) {
    console.log('[Lock Mode] TRAP WARNING: Rapid line movement');
    return true;
  }
  
  return false;
}
```

---

### UI Changes

#### 1. Enhanced `LockModeLegCard`

Add live line section:

```tsx
<div className="flex items-center justify-between">
  <span className="text-sm text-muted-foreground">Book Line:</span>
  <div className="flex items-center gap-2">
    <span className="font-mono text-foreground">
      {lineStatus.liveLine}
    </span>
    {lineStatus.lineMovement !== 0 && (
      <Badge variant={lineStatus.lineMovement > 0 ? "default" : "destructive"}>
        {lineStatus.lineMovement > 0 ? '↑' : '↓'}{Math.abs(lineStatus.lineMovement)}
      </Badge>
    )}
  </div>
</div>

<div className="flex items-center justify-between mt-2">
  <span className="text-sm text-muted-foreground">Timing:</span>
  <Badge className={cn(
    lineStatus.status === 'BET_NOW' && 'bg-emerald-500/20 text-emerald-300',
    lineStatus.status === 'WAIT' && 'bg-amber-500/20 text-amber-300',
    lineStatus.status === 'AVOID' && 'bg-red-500/20 text-red-300',
  )}>
    {lineStatus.status === 'BET_NOW' && '🟢 BET NOW'}
    {lineStatus.status === 'WAIT' && '⏳ WAIT'}
    {lineStatus.status === 'AVOID' && '🔴 AVOID'}
  </Badge>
</div>
```

#### 2. Slip Header Status

Show overall slip status:

```tsx
<Badge className={cn(
  allLegsOptimal && 'bg-emerald-500 text-white',
  someLegsWaiting && 'bg-amber-500 text-white',
)}>
  {allLegsOptimal && '✅ ALL LEGS OPTIMAL'}
  {someLegsWaiting && '⏳ WAITING FOR BETTER LINES'}
</Badge>
```

#### 3. Auto-Refresh Indicator

```tsx
<div className="flex items-center gap-2 text-xs text-muted-foreground">
  <RefreshCw className={cn("w-3 h-3", isScanning && "animate-spin")} />
  <span>Lines refresh every 30s</span>
  {lastScanTime && (
    <span>· Last: {formatDistanceToNow(lastScanTime, { addSuffix: true })}</span>
  )}
</div>
```

---

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useLockModeLineScanner.ts` | **Create** | New hook for live line scanning |
| `src/lib/lockModeEngine.ts` | **Modify** | Add Line Fit calculation functions |
| `src/types/scout-agent.ts` | **Modify** | Add LineStatus interface |
| `src/components/scout/LockModeTab.tsx` | **Modify** | Integrate line scanner hook |
| `src/components/scout/LockModeLegCard.tsx` | **Modify** | Show live line + status |

---

### Scan Throttling Strategy

To avoid excessive API calls:

1. **Scan Frequency**: Every 30 seconds (adjustable)
2. **Batching**: Fetch all legs in parallel using `Promise.all`
3. **Caching**: Use existing `useLiveOdds` cache (60s TTL)
4. **Game State Aware**: Only scan when:
   - Game is live (`status === 'in_progress'`)
   - Q2 or later (halftime lines are most relevant)
   - Slip is valid (has 3 legs)

---

### Expected User Experience

1. **User opens Lock Mode tab** → See 3-leg slip with original lines
2. **Lines refresh automatically** → Live lines appear, showing movement
3. **Line moves in favor** → See "🟢 BET NOW" on that leg
4. **Line moves against** → See "⏳ WAIT" suggesting patience
5. **All legs optimal** → Slip header shows "✅ ALL LEGS OPTIMAL - BET NOW"
6. **One leg has trap line** → See "🔴 AVOID" and leg shows warning

---

### Phase 2 Enhancements (Future)

1. **Push Notifications**: Alert when all 3 legs hit BET_NOW status
2. **Historical Line Movement Chart**: Show how each line has moved during the game
3. **Optimal Entry Predictor**: Use patterns to predict when lines typically move favorably
4. **Alternative Line Suggestions**: "Wait for +0.5 at O8.0 instead of O8.5"


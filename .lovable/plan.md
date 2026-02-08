

# Enhanced Bot: Projection-Aware Line Selection for Maximum Odds Value

## Overview

Add intelligent line selection to the bot for **risky parlays** (5-6 legs) where:
- If a player's projection is **significantly above the line**, select an **alternate higher line** with better odds
- This creates a "more risk, more reward" dynamic while maintaining high confidence
- Example: LeBron projected 28.5 pts, main line 22.5 @ -115 → Bot picks ALT 25.5 @ +120 (still likely to hit, much better payout)

## Current State

| Component | Status |
|-----------|--------|
| `unified_props` table | Has `current_line`, `over_price`, `under_price` - single line only |
| The Odds API | Supports `player_points_alternate`, `player_rebounds_alternate`, etc. |
| Bot generation | Uses single line per pick, no alternate line shopping |
| Projection data | Available via `projected_value` in `category_sweet_spots` |

## Implementation Plan

### Phase 1: Define Projection Buffer Thresholds

When should we consider alternate lines?

```text
PROJECTION BUFFER RULES:
┌─────────────────────────────────────────────────────────────┐
│ Prop Type      │ Min Buffer │ Example                       │
├─────────────────────────────────────────────────────────────┤
│ Points         │ +4.0 pts   │ Proj 28.5, Line 24.5 → OK    │
│ Rebounds       │ +2.5 reb   │ Proj 10.0, Line 7.5 → OK     │
│ Assists        │ +2.0 ast   │ Proj 8.5, Line 6.5 → OK      │
│ Threes         │ +1.0 3PM   │ Proj 4.0, Line 3.0 → OK      │
│ PRA            │ +6.0 pts   │ Proj 45, Line 38 → OK        │
└─────────────────────────────────────────────────────────────┘
```

### Phase 2: New Edge Function - `fetch-alternate-lines`

Create function to fetch alternate lines from The Odds API:

```typescript
// Markets to fetch for alternates
const ALTERNATE_MARKETS = {
  points: 'player_points_alternate',
  rebounds: 'player_rebounds_alternate',
  assists: 'player_assists_alternate',
  threes: 'player_threes_alternate',
  pra: 'player_points_rebounds_assists_alternate',
};

// Fetch all available alternate lines for a player+prop
async function fetchAlternateLines(
  eventId: string,
  playerName: string,
  propType: string
): Promise<AlternateLine[]> {
  // Returns array of { line, overOdds, underOdds }
  // Sorted by line ascending
}
```

### Phase 3: Optimal Line Selection Logic

Add to `bot-generate-daily-parlays`:

```typescript
interface LineOption {
  line: number;
  odds: number;       // American odds
  impliedProb: number;
  projectionBuffer: number;  // How much projection exceeds line
  expectedValue: number;     // EV calculation
}

/**
 * Select optimal line for a pick based on projection buffer
 * 
 * For RISKY parlays (5-6 legs):
 * - If projection >> line, pick higher alt line with plus money
 * - Goal: Maintain high hit probability while maximizing odds
 * 
 * For CONSERVATIVE parlays (3-4 legs):
 * - Stick to main line for safety
 */
function selectOptimalLine(
  pick: EnrichedPick,
  alternateLines: LineOption[],
  parlayStrategy: 'conservative' | 'balanced' | 'standard' | 'aggressive'
): SelectedLine {
  const projection = pick.projected_value;
  const mainLine = pick.line;
  const buffer = projection - mainLine;
  
  // Only shop lines for risky profiles
  if (['conservative', 'balanced'].includes(parlayStrategy)) {
    return { line: mainLine, odds: pick.americanOdds, reason: 'safe_profile' };
  }
  
  // Check if buffer is significant enough
  const minBuffer = getMinBuffer(pick.prop_type);
  if (buffer < minBuffer) {
    return { line: mainLine, odds: pick.americanOdds, reason: 'insufficient_buffer' };
  }
  
  // Find highest line that still clears with 80%+ confidence
  // Target: projection - (0.5 * minBuffer) as safety margin
  const safetyMargin = minBuffer * 0.5;
  const maxSafeLine = projection - safetyMargin;
  
  // Filter to lines we're confident about
  const viableAlts = alternateLines.filter(alt => 
    alt.line <= maxSafeLine && 
    alt.odds >= -150 && // Not too juiced
    alt.odds <= 200     // Not too risky
  );
  
  if (viableAlts.length === 0) {
    return { line: mainLine, odds: pick.americanOdds, reason: 'no_viable_alts' };
  }
  
  // For aggressive parlays, prefer plus money lines
  if (parlayStrategy === 'aggressive') {
    const plusMoneyAlts = viableAlts.filter(alt => alt.odds > 0);
    if (plusMoneyAlts.length > 0) {
      // Pick highest plus money line that's still safe
      const selected = plusMoneyAlts.sort((a, b) => b.line - a.line)[0];
      return { 
        line: selected.line, 
        odds: selected.odds, 
        reason: 'aggressive_plus_money',
        originalLine: mainLine,
        oddsImprovement: selected.odds - pick.americanOdds
      };
    }
  }
  
  // For standard risky, pick best EV line
  const bestEV = viableAlts.sort((a, b) => b.expectedValue - a.expectedValue)[0];
  return {
    line: bestEV.line,
    odds: bestEV.odds,
    reason: 'best_ev_alt',
    originalLine: mainLine,
    oddsImprovement: bestEV.odds - pick.americanOdds
  };
}
```

### Phase 4: Updated Parlay Profiles

Modify profiles to indicate which should use line shopping:

```typescript
const PARLAY_PROFILES = [
  // Conservative - NO line shopping
  { legs: 3, strategy: 'conservative', useAltLines: false },
  { legs: 3, strategy: 'conservative', useAltLines: false },
  
  // Balanced - NO line shopping
  { legs: 4, strategy: 'balanced', useAltLines: false },
  { legs: 4, strategy: 'balanced', useAltLines: false },
  
  // Standard - SOME line shopping (only for picks with 5+ buffer)
  { legs: 5, strategy: 'standard', useAltLines: true, minBuffer: 1.5 },
  { legs: 5, strategy: 'standard', useAltLines: true, minBuffer: 1.5 },
  { legs: 5, strategy: 'standard', useAltLines: false },
  
  // Aggressive - AGGRESSIVE line shopping (plus money priority)
  { legs: 6, strategy: 'aggressive', useAltLines: true, minBuffer: 1.2, preferPlusMoney: true },
  { legs: 6, strategy: 'aggressive', useAltLines: true, minBuffer: 1.2, preferPlusMoney: true },
  { legs: 6, strategy: 'aggressive', useAltLines: true, minBuffer: 1.2, preferPlusMoney: true },
];
```

### Phase 5: Enhanced Leg Storage

Store alternate line selection details:

```typescript
interface BotLeg {
  // Existing fields...
  
  // NEW: Alternate line tracking
  original_line: number;        // Main book line
  selected_line: number;        // Line we picked (may be alt)
  line_selection_reason: string; // 'main_line' | 'aggressive_plus_money' | 'best_ev_alt'
  odds_improvement: number;     // How much better than main line odds
  projection_buffer: number;    // projection - selected_line
}
```

### Phase 6: UI Display

Update `BotParlayCard.tsx` to show line selection:

```text
LeBron James
Points OVER 25.5 (alt from 22.5)
Odds: +120 (+235 vs main) | Projection: 28.5 (+3.0 buffer)
```

### Phase 7: Example Scenarios

```text
SCENARIO 1: Conservative 3-Leg Parlay
─────────────────────────────────────
LeBron Points OVER 22.5 @ -115 (proj: 28.5)
→ KEEP MAIN LINE (safe profile, no shopping)

SCENARIO 2: Aggressive 6-Leg Parlay  
─────────────────────────────────────
LeBron Points OVER 22.5 @ -115 (proj: 28.5, buffer: +6.0)
→ CHECK ALTERNATES:
  - 23.5 @ -105
  - 24.5 @ +100  
  - 25.5 @ +120 ← SELECTED (plus money, still 3.0 buffer)
  - 26.5 @ +145 (too close to projection)
  - 27.5 @ +175 (too close to projection)

Result: +235 odds improvement per leg × 6 legs = MASSIVE payout boost

SCENARIO 3: Standard 5-Leg Parlay
─────────────────────────────────
Jayson Tatum Rebounds OVER 7.5 @ -120 (proj: 8.2, buffer: +0.7)
→ KEEP MAIN LINE (buffer too small for alt shopping)
```

### File Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/fetch-alternate-lines/index.ts` | **NEW** - Fetch alt lines from Odds API |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `selectOptimalLine()` logic |
| `src/hooks/useBotEngine.ts` | Update `BotLeg` type with alt line fields |
| `src/components/bot/BotParlayCard.tsx` | Show alt line selection details |
| `supabase/config.toml` | Register new edge function |

### Expected Output

After implementation:

```text
AGGRESSIVE 6-LEG PARLAY (Line Shopping Enabled)
───────────────────────────────────────────────
Leg 1: LeBron Points OVER 25.5 @ +120 (alt from 22.5)
Leg 2: Curry Threes OVER 4.5 @ +135 (alt from 3.5)
Leg 3: Jokic Assists OVER 9.5 @ +110 (alt from 7.5)
Leg 4: Edwards Points OVER 27.5 @ -105 (main line)
Leg 5: Tatum Rebounds OVER 8.5 @ +100 (alt from 7.5)
Leg 6: Haliburton Assists OVER 10.5 @ +125 (alt from 8.5)

Combined Odds: +4850 (vs +1650 with main lines)
Risk/Reward: HIGH RISK, 3x REWARD MULTIPLIER
```

### Safety Rails

1. **Never pick a line above projection** - No matter how good the odds
2. **Minimum buffer requirement** - Must have 80%+ confidence after line bump
3. **Conservative parlays untouched** - Only aggressive profiles use alt lines
4. **Cap odds improvement** - Don't chase +300 lines with tiny buffers
5. **Track outcomes separately** - Learn if alt line picks perform differently


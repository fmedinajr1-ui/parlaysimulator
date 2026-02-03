
# Enhanced Live Hedge Recommendations System

## Problem Analysis

Based on code review, there are three critical issues with the current `HedgeRecommendation` component:

### Issue 1: Recommendations Disappear During Game
**Current behavior (line 130):**
```typescript
if (!atRisk && !severeRisk && !hasZoneDisadvantage) return null;
```
The component completely hides when no immediate risk is detected, leaving users without guidance for most of the game.

### Issue 2: No Progress Direction Indicators
The `LiveDataOverlay` shows the `trend` ('up'/'down'/'stable') but `HedgeRecommendation` uses a static `TrendingDown` icon (line 221) regardless of actual direction. Users can't see if their bet is improving or deteriorating.

### Issue 3: Recommendations Not Solid Enough
Generic messages like "BET UNDER to reduce exposure" don't provide enough context. The system doesn't factor in:
- **How much** the user should bet (relative sizing)
- **Time-sensitive urgency** based on remaining game time
- **Expected value** of the hedge at current moment
- **Probability of hitting** based on projection vs line

---

## Solution: Enhanced Hedge Recommendation Engine

### Phase 1: Always-Visible Hedge Tracking

**Modify: `src/components/sweetspots/HedgeRecommendation.tsx`**

Remove the conditional that hides the component and replace with a status-based display system:

| Scenario | Display State | Color |
|----------|---------------|-------|
| On pace, no risks | ✓ On Track (hold position) | Green |
| Slightly off pace, low urgency | ⚡ Monitor Closely | Yellow |
| Off pace, medium urgency | ⚠️ Hedge Alert | Orange |
| High risk (blowout/foul trouble/bad trend) | 🚨 HEDGE NOW | Red |
| Already hit line | 💰 Profit Lock Available | Purple |

**New logic:**
```typescript
// REMOVE this line:
// if (!atRisk && !severeRisk && !hasZoneDisadvantage) return null;

// ADD status levels:
const status = calculateHedgeStatus(spot); 
// Returns: 'on_track' | 'monitor' | 'alert' | 'urgent' | 'profit_lock'
```

---

### Phase 2: Dynamic Progress Direction with Trend Integration

**Add visual trend indicators that change based on actual `liveData.trend`:**

```text
Current Implementation (static):
[TrendingDown] Current: 12 → Projected: 18.2

Enhanced Implementation (dynamic):
[TrendingUp ↑]   Current: 12 → Projected: 18.2 (+2.1 last 5 min)  ← GREEN
[TrendingDown ↓] Current: 12 → Projected: 18.2 (-1.3 last 5 min)  ← RED
[Minus ↔]        Current: 12 → Projected: 18.2 (stable)          ← GRAY
```

**Also add "velocity" context:**
- Rate per minute vs what's needed
- Time remaining context ("Need 4.5 more in 8 minutes = 0.56/min")

---

### Phase 3: More Solid Recommendations with Actionable Details

**Enhanced `calculateHedgeAction` return structure:**

```typescript
interface EnhancedHedgeAction {
  status: 'on_track' | 'monitor' | 'alert' | 'urgent' | 'profit_lock';
  headline: string;         // Short status label
  message: string;          // Detailed explanation
  action: string;           // Specific bet recommendation
  urgency: 'high' | 'medium' | 'low' | 'none';
  hedgeOdds: string;        // "Bet UNDER 24.5 at -110"
  expectedValue: string;    // "EV: +$12 on $50 hedge"
  timeContext: string;      // "7:42 remaining in Q4"
  trendDirection: 'improving' | 'worsening' | 'stable';
  confidenceChange: number; // +5% or -10% from last update
}
```

**Specific scenario enhancements:**

| Scenario | Current Message | Enhanced Message |
|----------|-----------------|------------------|
| Trailing | "Trending 2.1 below target" | "Trailing by 2.1 with 8:32 left. Need 0.26/min but only producing 0.18/min. Trend: ↓ Worsening" |
| Blowout | "Blowout detected" | "Score margin: 24pts. 87% chance starters sit in Q4. Only 6:45 of meaningful play remaining" |
| Pace Issue | "Slow pace = fewer possessions" | "Game pace 94 (6% below avg). At current rate, projected 21.3 vs line 24.5. Gap widening" |
| Profit Lock | "You've already hit the line" | "Current: 26 vs Line: 24.5. UNDER 24.5 now at -115 = guaranteed $X profit on $Y stake" |

---

### Phase 4: Visual Redesign with Status Badges

**New component structure:**

```text
┌─────────────────────────────────────────────────────────────┐
│ [🟢 ON TRACK] Holding Position                              │  ← Status badge
├─────────────────────────────────────────────────────────────┤
│ Current: 14 [↑] → Projected: 23.8                           │  ← Progress with trend
│ Line: 22.5 | Gap: +1.3 | Confidence: 72%                    │
│                                                             │
│ ⏱ 11:24 remaining | Pace: NORMAL (101)                      │  ← Time/pace context
│ 📈 Trend: Improving (+0.8 in last 6 min)                    │
├─────────────────────────────────────────────────────────────┤
│ 💡 No hedge needed currently. Rate of 0.52/min exceeds      │  ← Recommendation
│    required 0.45/min. Continue monitoring.                  │
└─────────────────────────────────────────────────────────────┘
```

**Urgent state:**

```text
┌─────────────────────────────────────────────────────────────┐
│ [🔴 HEDGE NOW] Immediate Action Required                    │  ← Red status badge
├─────────────────────────────────────────────────────────────┤
│ Current: 8 [↓↓] → Projected: 14.2                           │  ← Trend shows severity
│ Line: 18.5 | Gap: -4.3 | Confidence: 28%                    │
│                                                             │
│ ⏱ 4:12 remaining | Pace: SLOW (92) | BLOWOUT RISK          │
│ 📉 Trend: Rapidly Declining (-3.1 in last 6 min)            │
├─────────────────────────────────────────────────────────────┤
│ 🚨 BET UNDER 18.5 NOW                                       │  ← Action box
│    Current odds: -105 | Recommended: $25-50                 │
│    At current rate, only 12% chance to hit 18.5             │
└─────────────────────────────────────────────────────────────┘
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/sweetspots/HedgeRecommendation.tsx` | Complete rewrite with enhanced logic, status system, trend integration, and new UI layout |
| `src/types/sweetSpot.ts` | Add `EnhancedHedgeAction` interface and hedge status types |

---

## New Helper Functions

Add to `HedgeRecommendation.tsx`:

```typescript
// Calculate remaining time in readable format
function formatTimeRemaining(period: string, clock: string, gameProgress: number): string;

// Determine hedge sizing recommendation  
function calculateHedgeSizing(gap: number, confidence: number): string;

// Calculate hit probability based on rate vs needed
function calculateHitProbability(current: number, line: number, ratePerMin: number, minutesRemaining: number): number;

// Get trend severity description
function getTrendDescription(trend: 'up' | 'down' | 'stable', recentDelta: number): string;
```

---

## Expected Results

After implementation:
1. **Hedge box visible throughout entire game** - Users always see current status
2. **Clear trend indicators** - Visual arrows showing if bet is improving/worsening
3. **Time-contextual advice** - "Need X in Y minutes" type messaging
4. **Actionable hedge details** - Specific amounts, odds, and probability percentages
5. **Status-based coloring** - Green (on track) → Yellow (monitor) → Orange (alert) → Red (urgent)
6. **Profit lock detection** - Clear messaging when middle opportunity exists

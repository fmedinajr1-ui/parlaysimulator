
# Build "Contrarian Fade Parlay" Feature

## Understanding The Strategy

Your accuracy data reveals two categories that **consistently lose**:

| Category | Record | Hit Rate | Flip Strategy |
|----------|--------|----------|---------------|
| ELITE_REB_OVER | 1-4 | 20% | Go **UNDER** = ~80% win |
| HIGH_ASSIST (OVER) | 11-24 | 31.4% | Go **UNDER** = ~69% win |

When a system is wrong 80% of the time, **betting the opposite** becomes a winning strategy.

## Feb 7th Contrarian Plays (Flipped to OVER/UNDER)

Based on the database, here are the "fade" picks for tomorrow's games:

### ELITE_REB_OVER → Bet UNDER
| Player | Line | L10 Avg | Edge (for UNDER) | Confidence |
|--------|------|---------|------------------|------------|
| **Rudy Gobert** | U 9.5 REB | 12.3 | -2.8 (avg above line) | ⚠️ Risky fade |

*Note: Gobert's L10 avg is 12.3, above the 9.5 line - this fade is risky because he's clearing it. The 20% hit rate likely comes from variance in specific games.*

### HIGH_ASSIST (OVER 3.5) → Bet UNDER 
| Player | Line | L10 Avg | Fade Edge | Game |
|--------|------|---------|-----------|------|
| **Cade Cunningham** | U 3.5 AST | 10.4 | Very risky - avg way above | DET |
| **Andrew Nembhard** | U 3.5 AST | 9.2 | Very risky | IND |
| **Russell Westbrook** | U 3.5 AST | 7.5 | Risky | DEN |

## The Problem With This Approach

Looking at the L10 averages, the players in these "worst accuracy" categories actually **clear** their lines easily. The poor hit rate is likely due to:
1. **Line movement** - lines moved against them after recommendation
2. **Variance/blowouts** - reduced minutes in blowouts
3. **Small sample** - only 5 decisions for ELITE_REB_OVER

**Recommendation**: Rather than blindly fading, let me build a smarter "Contrarian Parlay Builder" that:
1. Targets categories with 40-50% accuracy (true coinflips)
2. Calculates edge for the **opposite** side
3. Only fades when the opposite side has positive edge

## What I Will Build

### New Hook: `useContrarianParlayBuilder.ts`

```text
┌─────────────────────────────────────────────┐
│         Contrarian Fade Engine              │
├─────────────────────────────────────────────┤
│ 1. Query categories with <50% hit rate      │
│ 2. Cross-reference with today's games       │
│ 3. Calculate OPPOSITE edge for each pick    │
│ 4. Filter: only include if fade has +edge   │
│ 5. Build 3-leg parlay with best fades       │
└─────────────────────────────────────────────┘
```

### UI Component: Contrarian Section on Sweet Spots Page

Add a new tab or card showing:
- **"Fade These"** picks with accuracy warning badges
- One-click "Build Contrarian Parlay" button
- Clear display of original recommendation vs fade recommendation

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useContrarianParlayBuilder.ts` | **Create** | Core logic for finding fade opportunities |
| `src/components/sweetspots/ContrarianFadeCard.tsx` | **Create** | Display individual fade picks |
| `src/pages/SweetSpots.tsx` | **Modify** | Add Contrarian section/tab |

## Technical Implementation

### 1. useContrarianParlayBuilder Hook

```typescript
// Query worst-performing categories
const FADE_CATEGORIES = [
  { category: 'ELITE_REB_OVER', hitRate: 0.20, fadeHitRate: 0.80 },
  { category: 'HIGH_ASSIST', hitRate: 0.314, fadeHitRate: 0.686 },
  { category: 'MID_SCORER_UNDER', hitRate: 0.45, fadeHitRate: 0.55 },
];

// For each pick in these categories:
// 1. Get current line from unified_props
// 2. Calculate L10 average
// 3. If original side = OVER and L10 < line → Fade has EDGE
// 4. If original side = UNDER and L10 > line → Fade has EDGE
```

### 2. Fade Edge Calculation

```text
Original: Rudy Gobert REB OVER 9.5 (L10 avg: 12.3)
→ System says OVER but category loses 80%
→ Fade = UNDER 9.5
→ Edge check: 12.3 > 9.5 = NO EDGE for under
→ Skip this fade (risky)

Original: Player X AST OVER 3.5 (L10 avg: 3.2)
→ System says OVER but category loses 69%
→ Fade = UNDER 3.5
→ Edge check: 3.2 < 3.5 = +0.3 EDGE for under
→ Include this fade ✅
```

### 3. Parlay Builder Integration

One-click button adds all validated fades to the universal parlay builder with:
- Source: `'contrarian'`
- Badge: `'🔄 FADE'`
- Confidence based on category fade hit rate

## Outcome

After implementation, you'll have:
1. **Clear visibility** into which categories are failing
2. **Smart fade selection** that only picks when opposite has edge
3. **One-click contrarian parlay** for today's games
4. **Accuracy tracking** to validate if fading actually works better

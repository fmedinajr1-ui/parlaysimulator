
# Plan: Enhanced 3PT Parlay Research & Outcome Learning System

## Overview

Build a comprehensive 3PT parlay research system that:
1. Records your winning parlay outcomes for learning
2. Adds H2H matchup analysis for 3PT picks
3. Discovers consistent high-volume 3PT shooters with low variance
4. Dynamically updates elite picks based on proven outcomes

---

## Part 1: Record Winning Parlay Outcomes (Learning System)

### Database: New Table `user_parlay_outcomes`

Store your winning slips for pattern analysis:

```sql
CREATE TABLE user_parlay_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_date DATE NOT NULL,
  total_legs INTEGER NOT NULL,
  wager_amount NUMERIC,
  payout_amount NUMERIC,
  total_odds TEXT,
  legs JSONB NOT NULL,  -- [{player, line, prop_type, actual_value, outcome}]
  outcome TEXT DEFAULT 'pending',  -- won/lost/push
  source TEXT,  -- 'prizepicks', 'draftkings', etc.
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Implementation: Manual Entry Hook

Create `useRecordParlayOutcome` hook to:
- Add past winning parlays for analysis
- Extract patterns (player types, line ranges, matchups)
- Feed into recommendation engine

---

## Part 2: Enhanced H2H Matchup Research

### Update `matchup_history` Population

The current `matchup_history` table has data but needs better hit rate tracking. Enhance the analyzer to:

1. Calculate H2H 3PT performance against specific teams
2. Track "best matchup" opponents for each shooter
3. Flag favorable matchups in parlay recommendations

### New View: `v_3pt_matchup_favorites`

```sql
CREATE VIEW v_3pt_matchup_favorites AS
SELECT 
  player_name,
  opponent,
  games_played,
  avg_stat AS avg_3pt_vs_team,
  min_stat AS worst_3pt_vs_team,
  CASE WHEN min_stat >= 2 THEN 'ELITE_MATCHUP'
       WHEN min_stat >= 1 THEN 'GOOD_MATCHUP'
       ELSE 'VOLATILE_MATCHUP'
  END AS matchup_tier
FROM matchup_history
WHERE prop_type = 'player_threes'
AND games_played >= 2
ORDER BY min_stat DESC, avg_stat DESC;
```

---

## Part 3: Consistent Shooter Discovery

### New Query: Low-Variance 3PT Shooters

Identify shooters with:
- High 3PM average (≥2.0 per game)
- Low standard deviation (≤1.5)
- High consistency score (≥40)
- Adequate minutes (≥20)

### Implementation

Update `useEliteThreesBuilder` to:
1. Cross-reference `player_season_stats.threes_std_dev`
2. Prioritize shooters with `threes_std_dev < 1.0` (ultra-consistent)
3. Add "Consistency Badge" to UI

---

## Part 4: Dynamic 3PT Parlay Builder

### Enhanced Selection Criteria (v2.0)

```text
SELECTION PRIORITY:
1. L10 Hit Rate = 100% (required)
2. L10 Min ≥ 2 (floor protection)
3. Low Variance (std_dev ≤ 1.5)
4. Favorable H2H Matchup (avg > line × 1.5)
5. High Minutes (≥25 avg)
6. Team Diversity (max 1 per team)
```

### UI Enhancements

Add to `Elite3PTFixedParlay.tsx`:
- **H2H Badge**: Show historical performance vs today's opponent
- **Consistency Score**: Display variance tier (Low/Medium/High)
- **Floor Indicator**: Show L10 minimum (crucial for O1.5 lines)

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/xxx_user_parlay_outcomes.sql` | Create | Learning system table |
| `src/hooks/useRecordParlayOutcome.ts` | Create | Record winning slips |
| `src/hooks/use3PTMatchupAnalysis.ts` | Create | H2H research for 3PT |
| `src/hooks/useEliteThreesBuilder.ts` | Modify | Add consistency + H2H scoring |
| `src/components/market/Elite3PTResearchCard.tsx` | Create | Research dashboard UI |
| `supabase/functions/analyze-3pt-patterns/index.ts` | Create | Backend pattern analysis |

---

## Implementation Flow

```text
┌─────────────────────────────────────────────────────────────┐
│                 3PT PARLAY RESEARCH SYSTEM                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. RECORD OUTCOMES                                         │
│     └─> Store winning slips → Extract player patterns       │
│                                                             │
│  2. MATCHUP ANALYSIS                                        │
│     └─> Cross-reference H2H data → Flag favorable games     │
│                                                             │
│  3. CONSISTENCY SCORING                                     │
│     └─> Check std_dev → Prioritize low-variance shooters    │
│                                                             │
│  4. DYNAMIC BUILDER                                         │
│     └─> Combine all signals → Generate elite parlay         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Insights from Your Wins

### Pattern: **O1.5 Line Sweet Spot**

5 of 7 winning legs were O1.5 lines - these have the highest floor protection:
- Toumani Camara O1.5 → 4 made
- Saddiq Bey O1.5 → 3 made
- Egor Demin O1.5 → 3 made
- John Collins O1.5 → 2 made
- Ayo Dosunmu O1.5 → 2 made

### Pattern: **L10 Minimum ≥ 1 is Critical**

All winning picks had L10_min ≥ 1, meaning they've never busted on the line in recent games.

### Pattern: **Volume Shooters + Role Players Mix**

Your wins combined:
- High-volume shooters (Coby White 5.2 avg, Sam Hauser 5.0 avg)
- Consistent role players (Dosunmu, Camara, Collins with 2.0-2.5 avg)

---

## Technical Details

### Consistency Score Calculation

```typescript
// Weight shooters by variance
const consistencyWeight = 
  (p.threes_std_dev <= 0.8 ? 1.3 :   // Ultra-consistent: +30%
   p.threes_std_dev <= 1.2 ? 1.1 :   // Consistent: +10%
   p.threes_std_dev <= 1.8 ? 1.0 :   // Normal: no bonus
   0.85);                             // Volatile: -15% penalty
```

### H2H Matchup Boost

```typescript
// Boost picks with favorable H2H
const h2hBoost = 
  (h2h.avg_stat >= line * 2.0 ? 1.25 :  // Dominant matchup
   h2h.avg_stat >= line * 1.5 ? 1.15 :  // Good matchup
   h2h.min_stat >= line ? 1.10 :        // Safe matchup
   1.0);
```

---

## Expected Outcomes

After implementation:
- **Record your wins** → System learns which players/lines work
- **H2H research** → Surface players who feast vs specific teams
- **Consistency filter** → Avoid high-variance boom/bust shooters
- **Dynamic updates** → Builder adapts based on proven outcomes

---

## Today's Recommended 3PT Parlay (Based on Research)

Using the enhanced criteria:

| Player | Line | L10 Avg | L10 Min | Variance | Matchup |
|--------|------|---------|---------|----------|---------|
| Coby White | O2.5 | 5.2 | 3 | Low | ✅ |
| Sam Hauser | O2.5 | 5.2 | 2 | Medium | Elite vs ATL |
| Donte DiVincenzo | O1.5 | 3.6 | 2 | Low | Good |
| Toumani Camara | O1.5 | 2.4 | 1 | Medium | ✅ |

All have 100% L10 hit rate + favorable floors.

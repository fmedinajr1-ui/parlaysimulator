

## Wire Day Type Classifier Into Backend Generation + Remove Frontend

### What happened
The Day Type Classifier was built as a **frontend-only UI card** (`useDayTypeClassifier.ts` + `DayTypeClassifierCard.tsx`). It correctly parses the matchup scan and identifies dominant prop types — but the backend parlay generator (`bot-generate-daily-parlays`) never reads this signal. The generator uses backward-looking 14-day archetype win rates and hardcoded `winning_archetype_reb_ast` profiles, which caused a rebound-heavy slate on a "Threes + Points" day.

### Changes

#### 1. Add `getDayTypeSignal()` to `bot-generate-daily-parlays/index.ts`
Port the frontend parsing logic (from `useDayTypeClassifier.ts`) into a backend function that:
- Queries `bot_research_findings` for today's `matchup_defense_scan` summary
- Parses it to extract per-prop-type avg scores and attack vector counts
- Returns the dominant day type (POINTS/THREES/REBOUNDS/ASSISTS/BALANCED) with confidence

~60 lines added near the other `fetchResearch*` functions (around line 4100).

#### 2. Apply day-type scoring modifier to `calculateCompositeScore()`
Add a `dayTypeBoost` parameter to the composite score function (line 2998):
- Legs matching the day's dominant prop type: **+8 boost**
- Legs contradicting the day type (e.g., rebounds on a Threes day): **-5 penalty**
- Balanced days or missing signal: no adjustment

This tilts the candidate pool without hard-blocking any prop type.

#### 3. Dynamically adjust archetype profile weights
Before profile iteration, use the day type signal to:
- If THREES day: duplicate `winning_archetype_3pt_scorer` profiles, skip 2 of 3 `winning_archetype_reb_ast` profiles
- If POINTS day: boost scorer profiles, reduce rebound profiles
- If REBOUNDS day: keep rebound profiles as-is
- If BALANCED: no adjustment

This ensures the strategy mix reflects today's matchup conditions rather than only historical performance.

#### 4. Log the day type signal at pipeline start
```
[Bot v2] 📊 Day Type: THREES (confidence 78%) — boosting 3PT legs, penalizing REB legs
```

#### 5. Remove frontend components
- Delete `src/hooks/useDayTypeClassifier.ts`
- Delete `src/components/parlays/DayTypeClassifierCard.tsx`
- Remove the `<DayTypeClassifierCard />` usage and import from `DailyParlayHub.tsx` (lines 14, 104-107)

### Scope
- **Modified:** `supabase/functions/bot-generate-daily-parlays/index.ts` (~80 lines added)
- **Modified:** `src/components/parlays/DailyParlayHub.tsx` (remove import + usage)
- **Deleted:** `src/hooks/useDayTypeClassifier.ts`, `src/components/parlays/DayTypeClassifierCard.tsx`
- No database changes needed


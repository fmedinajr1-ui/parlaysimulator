# Plan — Engine-Powered Slip Analyzer

## Problem
The slip analyzer (Results page) currently calls two edge functions that **don't exist**: `analyze-parlay` and `generate-roasts`. So `aiAnalysis` is always `null`, every leg shows "N/A", and the only output users see is fallback static roasts. Meanwhile we already have 4 engines wired into `find-swap-alternatives` (Unified Props, Median Lock, Juiced Props, Hit Rates) plus tables for sharp signals, trap analysis, injuries, fatigue, and FanDuel signals — none are touched on the analyzer path.

## What Will Change

### 1. New edge function: `analyze-parlay`
Single endpoint the Results page already calls. For each uploaded leg it cross-references our engines and returns a real `LegAnalysis` (already typed in `src/types/parlay.ts`) plus a parlay-level summary.

Per-leg engine cross-reference (parallel queries, fuzzy player+prop+line match):
- **Unified Props** → `pvsScore`, `recommendation`, `combined_confidence` → drives `adjustedProbability`
- **Median Lock Candidates** → `LOCK`/`STRONG` classification, `consensus_percentage`, `parlay_grade` → `medianLockData`
- **Juiced Props** → juice level + direction → `juiceData`
- **Player Prop Hit Rates (L10)** → `hitRatePercent`
- **Sharp Signals** → recommendation + signal codes → `sharpRecommendation`, `sharpSignals`
- **Trap Probability Analysis** → trap risk label → adds to `riskFactors`, can flip verdict to FADE
- **Injury Reports** → matched by player → `injuryAlerts`
- **Sports Fatigue Scores** → `fatigueData` (incl. B2B flag)

Synthesis layer:
- Build `researchSummary.signals[]` from each engine that returned a hit (positive/negative/neutral)
- `strengthScore` = weighted sum (Unified 30%, Median Lock 25%, HitRate 20%, Sharp 15%, Trap −20% if high)
- `overallVerdict`: `STRONG_PICK` ≥75, `LEAN_PICK` ≥55, `NEUTRAL` 40-55, `LEAN_FADE` 25-40, `STRONG_FADE` <25
- `adjustedProbability` blends implied prob with engine consensus (capped ±15% delta to stay defensible)
- `correlatedLegs` detection: same event_id or same last-name → flagged as same-game

Parlay-level output added to response:
- `recommendedAction`: `TAIL` / `TAIL_WITH_SWAPS` / `REBUILD` / `PASS`
- `summary`: 2–3 sentence narrative ("3 of your 5 legs are sharp. Your Curry leg is a trap — books moved both sides. Drop it or swap to LeBron Over 6.5 ast (78% Median Lock).")
- `keepLegs[]`, `swapLegs[]`, `dropLegs[]` — concrete actions per leg index
- `suggestedSwaps[]` — pulls top 1 alternative per weak leg via the same logic as `find-swap-alternatives` (call its helper inline; no extra HTTP hop)
- `expectedValueDelta` — projected EV improvement if user applies all suggested swaps

### 2. New edge function: `generate-roasts`
Tiny wrapper around Lovable AI Gateway (`google/gemini-2.5-flash`) that takes legs + verdict + swap suggestions and returns 3 punchy roasts. Falls back to static lines on error so the Results page never breaks.

### 3. Results page wiring (no UI rewrite required)
`src/pages/Results.tsx` already consumes the exact `ParlayAnalysis` shape we'll return — `LegBreakdownScorecard`, `ConsolidatedVerdictCard`, `ParlayHealthCard`, `SmartLegSwapCard`, the new EV badges we just shipped — they'll all light up automatically once `aiAnalysis` is no longer null.

We'll add **one** new card above the roast: `EngineRecommendationCard` that surfaces the parlay-level `summary` + `recommendedAction` + the keep/swap/drop verdict counts in a single hero block, so users see the actionable answer immediately without scrolling.

### 4. Homepage analyzer (`HomepageAnalyzer.tsx`)
Currently only runs Monte Carlo simulation. After the existing simulation step, fire `analyze-parlay` in parallel and surface:
- The `recommendedAction` chip on the risk banner
- The `summary` sentence under the existing tier label
- Top 1 swap suggestion inline per weak leg (with a "Use sharper pick" tap that copies to clipboard)

Free preview shows verdict + summary; the full leg-by-leg engine breakdown stays behind the existing $4.99 unlock (fits the current paid model).

## Technical Details

**Files to create:**
- `supabase/functions/analyze-parlay/index.ts` — engine cross-reference + synthesis
- `supabase/functions/generate-roasts/index.ts` — Lovable AI roast generator
- `supabase/functions/_shared/leg-matcher.ts` — fuzzy player/prop/line matching helper used by both analyze-parlay and find-swap-alternatives
- `src/components/results/EngineRecommendationCard.tsx` — hero summary card

**Files to edit:**
- `src/pages/Results.tsx` — add `EngineRecommendationCard` near the top; pass `recommendedAction` to existing components
- `src/components/home/HomepageAnalyzer.tsx` — invoke `analyze-parlay`, render verdict chip + inline swaps in free preview
- `supabase/functions/find-swap-alternatives/index.ts` — refactor to import from `_shared/leg-matcher.ts`
- `src/types/parlay.ts` — extend `ParlayAnalysis` with `recommendedAction`, `summary`, `keepLegs`, `swapLegs`, `dropLegs`, `suggestedSwaps`, `expectedValueDelta`

**Engine fan-out pattern (per leg):**
```text
                 ┌─► unified_props (PVS + confidence)
                 ├─► median_lock_candidates (LOCK/STRONG)
   leg ──fuzzy──►├─► juiced_props (juice level)
                 ├─► player_prop_hitrates (L10)
                 ├─► sharp_signals (sharp rec)
                 ├─► trap_probability_analysis (trap risk)
                 ├─► injury_reports (player match)
                 └─► sports_fatigue_scores (B2B + load)
                          │
                          ▼
                synthesizeLegAnalysis()
                  → researchSummary
                  → adjustedProbability
                  → riskFactors / sharpSignals
```

**Performance:** all 8 engine queries per leg run in `Promise.all`; expected total ~600ms for an 8-leg slip on the existing Supabase indexes. No new tables required.

**Auth:** both new functions stay public (`verify_jwt = false` default) — the analyzer is used by anonymous visitors on the homepage. No PII written.

**Lovable AI key:** `generate-roasts` uses `LOVABLE_API_KEY` (already provisioned for the project); no user secret prompt needed.

## Outcome
After this lands, dropping a slip into the analyzer returns:
1. **A real verdict** ("REBUILD — 2 of 5 legs are traps")
2. **A plain-English summary** of which legs to keep, swap, drop
3. **Concrete sharper alternatives** sourced from 4+ engines, ranked by confidence gain
4. **Per-leg engine evidence** (PVS, hit rate, sharp signals, trap flags, injuries, fatigue) feeding the existing EV badges and tap-to-expand risk drawer we just shipped
5. The roast — but now as flavor on top of actual analysis, not the only output.

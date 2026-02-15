

# Smart Thin-Slate Relaxation for Higher Volume

## Problem
On light days (few NBA/NHL games, NCAAB-only slates), the pool size drops sharply. The validation tier's strict gates (52% hit rate, 0.008 edge, 0.02 Sharpe) reject most candidates, producing 0 validation parlays. The pool threshold at 8 picks can also block generation entirely.

## Solution: Adaptive Thin-Slate Mode
Instead of blanket relaxation (which hurts accuracy), the system will detect thin slates and intelligently loosen gates while preserving quality signals.

## Changes

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

### 1. Lower Global Pool Threshold (line 2820)
- Drop minimum pool from **8 to 5** picks to allow generation on very thin slates
- Drop real-line fallback from **5 to 3** (with team picks check from 5 to 3)
- This prevents the bot from skipping generation entirely on 2-3 game nights

### 2. Add Thin-Slate Detection (after pool is built, ~line 2852)
Detect thin slate when total pool is below 25 picks:
```
const isThinSlate = pool.totalPool < 25;
```
Log the mode so we can track it in Telegram/dashboard.

### 3. Relax Validation Tier Gates on Thin Slates (in `generateTierParlays`)
When thin slate is detected, dynamically reduce validation thresholds:

| Gate | Normal | Thin Slate | Why Safe |
|------|--------|------------|----------|
| minHitRate | 52% | 48% | Still above coin-flip, keeps directional edge |
| minEdge | 0.008 | 0.004 | Half the edge floor, but still positive EV |
| minSharpe | 0.02 | 0.01 | Matches exploration tier floor |
| minConfidence | 0.52 | 0.48 | Allows borderline candidates in |

### 4. Relax Parlay-Level Quality Gates on Thin Slates (lines 2701-2704)
- Lower probability floor from `0.001` to `0.0005` for thin slates
- Lower effective edge floor for validation tier to `0.004` on thin slates
- Keep execution tier gates unchanged (these are the money bets)

### 5. Intelligence Guardrails (keeps accuracy)
These remain fully enforced regardless of slate size:
- Golden Gate rule for execution tier (60%+ hit rate legs required)
- Negative-edge blocking (projection must support bet direction)
- Injury/availability gate (OUT/DOUBTFUL players still blocked)
- Fingerprint deduplication (no duplicate parlays)
- NCAAB KenPom Top 200 gate for execution/validation
- Category auto-blocking from calibration (losing categories still blocked)

## Technical Detail

The thin-slate flag will be passed into `generateTierParlays` as a parameter. Inside, if `isThinSlate && tier === 'validation'`, the config thresholds are overridden with the relaxed values before profile iteration begins. Execution tier is never relaxed.

```text
Normal day (40+ picks)           Thin slate (< 25 picks)
+----------------------------+   +----------------------------+
| Exploration: loose gates   |   | Exploration: same          |
| Validation:  strict gates  |   | Validation:  relaxed gates |
| Execution:   strictest     |   | Execution:   UNCHANGED     |
+----------------------------+   +----------------------------+
```

## Impact
- On thin slates: expect 5-10 more validation parlays per day
- On normal slates: zero change (threshold not triggered)
- Execution tier accuracy fully preserved
- All safety gates (injuries, dedup, negative-edge) still enforced

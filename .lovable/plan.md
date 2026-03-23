

# Tune DNA Audit Thresholds

## Problem

The current audit has three overly aggressive rules that together void 91% of parlays:

1. **`NO_FD_LINE` is fatal** (line 146, 166): Any leg without a real FanDuel line instantly makes the entire parlay F-grade. Even after the `bookmaker` fix, many props (steals, blocks, combos) simply aren't on FanDuel — they're still valid bets on other books.

2. **`NEG_BUFFER` flags all negative buffers** (line 147): Even -0.1% buffer flags a leg as weak. A player averaging 12.4 on a 12.5 line is essentially a coin flip, not a fatal flaw.

3. **`NO_FD_LINE` + `NO_PLAYER` are treated equally fatal** (line 165-167): Missing player name is truly fatal, but missing FanDuel line should be a warning, not a death sentence.

## Changes to `score-parlays-dna/index.ts`

### 1. Downgrade `NO_FD_LINE` from fatal to warning
- Line 146: Keep the flag but **don't** include it in the fatal check
- Line 165-167: Change `fatalLegs` to only check `NO_PLAYER` (not `NO_FD_LINE`)
- Legs without FD lines still get flagged as weak (eligible for pruning) but don't auto-void the parlay

### 2. Relax negative buffer threshold
- Line 147: Change `bufferPct < 0` → `bufferPct < -5`
- A small negative buffer (-1% to -5%) is marginal, not disqualifying. Only flag legs with deeply negative buffers.

### 3. Lower DNA score floor
- Line 148: Change `dnaScore < 40` → `dnaScore < 30`
- The current 40 threshold is too aggressive given the scoring normalizes around 50. A 35-score pick is mediocre but not terrible.

### 4. Add severity tiers to flags
- New concept: `FATAL` flags (NO_PLAYER, empty legs) vs `WEAK` flags (NEG_BUFFER, LOW_DNA, NO_FD_LINE)
- Fatal flags → void the parlay
- Weak flags → prune the leg if possible, keep parlay alive

### Summary of threshold changes

| Rule | Before | After |
|------|--------|-------|
| No FanDuel line | Fatal (voids parlay) | Warning (prune leg) |
| Negative buffer | Any < 0% | Only < -5% |
| Low DNA score | < 40 | < 30 |
| No player name | Fatal | Fatal (unchanged) |

## Expected Impact
- Before: 91% void rate (14/16 parlays voided)
- After: ~20-30% void rate (only truly unbettable parlays voided), with weak legs pruned from the rest

## Files Changed
1. **`supabase/functions/score-parlays-dna/index.ts`** — Relax thresholds, separate fatal vs weak flags




# Add "Over RBI" Engine for HR Power Hitters vs Weak Pitchers

## Concept
You're right — players with 2+ HRs in L10 who face weak pitchers are exactly who you want on **Over** RBI picks. Right now the system blocks them from Unders but wastes the data. Flip it: use the HR Power Gate rejects as Over candidates.

## Qualifying Criteria (Over 0.5 RBI)
- **L10 HRs >= 2** (the same players currently blocked from Unders)
- **Facing a weak pitcher**: ERA >= 4.0 OR K/game < 5 (inverse of the Under pitcher gate)
- **L10 RBI avg >= 0.5** (producing RBIs, not just hitting HRs in blowouts)
- **L10 hit rate >= 40%** (hitting Over 0.5 in at least 4 of 10 games)

## Changes

### 1. `hrb-mlb-rbi-analyzer/index.ts` — Add Over RBI detection
After the existing Under validation loop, add a second pass that collects **Over** candidates:
- Players with `l10HRs >= 2` AND `l10Avg >= 0.5` AND `l10HitRate >= 0.4`
- Tag with `prediction: 'Over'` and `signal_type: 'hr_power_over'`
- Store opposing pitcher info in metadata for the parlay generator
- Same dedup, daily cap, and Telegram dispatch as Unders

### 2. `generate-rbi-parlays/index.ts` — Add Over parlay generation
After the existing Under parlay section, add a separate Over parlay builder:
- Pull today's `hr_power_over` alerts from `fanduel_prediction_alerts`
- **Inverse pitcher gate**: require weak pitcher (ERA >= 4.0 OR K/game < 5)
- Score by: L10 HR count, L10 avg, hit rate, pitcher weakness
- Build **3-leg Over RBI parlays** (require >= 3 candidates)
- Also build 2-leg version as backup
- Separate Telegram message: "🔥 RBI Over Power Parlay"

### 3. Telegram format for Overs
```
🔥 RBI Over Power Parlay (3-Leg)

1️⃣ Matt Olson — OVER 0.5 RBI
   💪 3 HRs in L10 | L10: 0.7 avg (6/10 over)
   🎯 Facing [weak pitcher] (4.82 ERA, 3.2 K/g)

2️⃣ Ketel Marte — OVER 0.5 RBI
   💪 3 HRs in L10 | L10: 0.8 avg (7/10 over)
   🎯 Facing [weak pitcher] (5.10 ERA, 4.1 K/g)

3️⃣ Daulton Varsho — OVER 0.5 RBI
   💪 2 HRs in L10 | L10: 0.5 avg (5/10 over)
   🎯 Facing [weak pitcher] (4.50 ERA, 4.8 K/g)
```

### Files
- `supabase/functions/hrb-mlb-rbi-analyzer/index.ts` — add Over candidate detection
- `supabase/functions/generate-rbi-parlays/index.ts` — add Over parlay builder + Telegram

### No DB changes needed
Uses existing `fanduel_prediction_alerts` table and `hrb_rbi_line_timeline` — just new signal type `hr_power_over`.


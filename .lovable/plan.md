

# Score Today's Parlays Against Pick DNA + Fix Weak Legs

## What's Wrong With Today's 16 Parlays

From the data:

- **Fake lines**: Many legs have `has_real_line: false`, `line_source: projected` — these are made-up lines, not bettable on FanDuel
- **Negative buffers**: Jokic REB OVER 12.5 has buffer -0.5, Jalen Green REB OVER 4.5 has buffer -1 — these are picks where the player's L10 avg is BELOW the line
- **No DNA scoring**: Zero parlays have been scored against the learned weights (buffer_pct = #1 predictor with 0.441 separation)
- **Ghost legs**: Bench under parlays have no player name, no hit rate, no line source — just empty shells

## Solution: New `score-parlays-dna` Edge Function

### What It Does

1. Load today's 16 pending parlays from `bot_daily_parlays`
2. Load DNA weights from `pick_score_weights`
3. For each parlay, score every leg:
   - Calculate buffer % (L10 avg vs line)
   - Compute DNA pick_score using learned weights
   - Flag legs with: no real FanDuel line, negative buffer, DNA score < 40
4. Grade each parlay: A (all legs strong), B (1 weak leg), C (2+ weak), F (fake lines or negative buffers)
5. **Auto-void** F-grade parlays (unbettable)
6. **Drop weak legs** from B/C parlays if remaining legs ≥ 2, recalculate odds
7. Send graded report to Telegram with per-leg DNA scores

### Telegram Output
```
🧬 DNA PARLAY AUDIT — March 22
16 parlays scored | 4 voided | 3 fixed

✅ A-GRADE (keep as-is):
#1 KAT REB O7 (DNA:82) + OG 3PT O2.5 (DNA:76) + Brunson AST O7.5 (DNA:71)

⚠️ B-GRADE (1 weak leg dropped):
#5 Was 3-leg → 2-leg after dropping Jalen Green REB O4.5 (DNA:28, buffer:-22%)

❌ VOIDED (unbettable):
#3 Dejounte Murray AST O3.5 — no FanDuel line
#7 Bench Unders — no player data
```

### Wire Into Pipeline

Add to `refresh-l10-and-rebuild` after parlay generation (phase3d) so every day's parlays get DNA-audited before broadcast.

## Files

1. **New: `supabase/functions/score-parlays-dna/index.ts`** — Score, grade, fix, void, Telegram report
2. **Edit: `supabase/functions/refresh-l10-and-rebuild/index.ts`** — Add `score-parlays-dna` after parlay generation
3. **Edit: `supabase/config.toml`** — Register new function




# Ceiling Line Straights — L3 + H2H Matchup Scanner

## What This Does
Scans today's sweet spots for players whose **L3 average** and **H2H matchup boost** both point OVER, then finds a **higher "ceiling" line** (based on L10 max / L3 trend) and generates a single straight bet at that elevated line. Tracks these separately as `ceiling_straight` bets for performance monitoring.

Example: Bam Adebayo has a FanDuel line of 8.5 REB. His L3 avg is 11.3 and H2H vs opponent shows +15% boost. System identifies a ceiling line of 10.5 and creates a straight bet on OVER 10.5 REB — higher risk, higher reward.

---

## Plan

### Step 1: Add `bet_type` column to `bot_straight_bets`
Add a column to distinguish standard straights from ceiling straights so they can be tracked and filtered independently.

```sql
ALTER TABLE bot_straight_bets 
  ADD COLUMN IF NOT EXISTS bet_type text DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS ceiling_line numeric,
  ADD COLUMN IF NOT EXISTS standard_line numeric,
  ADD COLUMN IF NOT EXISTS l3_avg numeric,
  ADD COLUMN IF NOT EXISTS h2h_boost numeric,
  ADD COLUMN IF NOT EXISTS ceiling_reason text;
```

### Step 2: Add ceiling logic to `bot-generate-straight-bets/index.ts`
After the existing straight bet generation, add a **Ceiling Scanner** phase:

1. **Query** today's sweet spots with `l3_avg`, `l10_max`, `h2h_matchup_boost`, and `actual_line` (verified FanDuel line)
2. **Filter** for ceiling candidates where:
   - `l3_avg > actual_line` (recent trend clears the book line)
   - `h2h_matchup_boost > 0` (matchup is favorable, not negative)
   - `l10_max >= actual_line * 1.25` (player has shown ceiling 25%+ above line)
3. **Calculate ceiling line**: `ceil_line = round_to_half(min(l3_avg * 0.95, l10_max * 0.8))` — picks a line between the L3 trend and L10 ceiling, ensuring it's above the standard line but below the true max
4. **Validate**: ceiling line must be > standard FanDuel line (otherwise it's just a normal pick)
5. **Insert** into `bot_straight_bets` with `bet_type = 'ceiling_straight'`, recording both `standard_line` and `ceiling_line`, plus `l3_avg` and `h2h_boost` for audit
6. **Telegram broadcast**: separate section showing ceiling picks with L3/H2H/ceiling rationale

### Step 3: Settlement support
The existing `bot-settle-and-learn` function already settles `bot_straight_bets` by comparing `line` to actual stats. Since we insert the ceiling line as `line`, settlement works automatically — no changes needed.

---

## Ceiling Line Calculation Example

```
Player: Bam Adebayo | Prop: Rebounds
FanDuel Line: 8.5
L3 Avg: 11.3 | L10 Max: 14 | H2H Boost: +12%

Ceiling Line = min(11.3 * 0.95, 14 * 0.8) = min(10.7, 11.2) = 10.7 → rounded to 10.5

Result: OVER 10.5 REB (ceiling straight)
Standard was 8.5, ceiling is 10.5 — tracks separately
```

## Files Changed
1. **Migration** — Add `bet_type`, `ceiling_line`, `standard_line`, `l3_avg`, `h2h_boost`, `ceiling_reason` columns
2. **`supabase/functions/bot-generate-straight-bets/index.ts`** — Add ceiling scanner phase after standard generation


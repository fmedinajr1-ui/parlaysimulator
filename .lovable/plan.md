

## Add "Correct-Priced Lines" Detection + Mixed-Stack Parlay Strategy

### Concept
Currently the pipeline only tracks **mispriced lines** (15%+ edge). Props with smaller edges (3-14%) are discarded entirely. These "correct-priced" lines represent props where the sportsbook has it roughly right -- the player's L10 average is close to the book line. These are **stable, predictable props** that make excellent anchor legs in parlays.

The new strategy stacks three different conviction types into one parlay:
- **Mispriced leg** (15%+ edge) -- the upside/value play
- **Correct-priced leg** (3-14% edge, 65%+ hit rate) -- the anchor/stability play
- **Conviction leg** (double or triple confirmed) -- the cross-engine consensus play

### Changes

#### 1. New Database Table: `correct_priced_lines`
Create a table mirroring `mispriced_lines` but for props with edge between 3% and 14.99%. Same columns: player_name, prop_type, book_line, player_avg_l10, edge_pct, signal, confidence_tier, analysis_date, sport, etc. These are the "book got it right" props -- low edge but historically consistent hitters.

#### 2. Update `detect-mispriced-lines` Edge Function
Currently line 331 discards anything with `< 15%` edge. Instead of discarding, persist props with **3-14.99% edge** into the new `correct_priced_lines` table. The mispriced table continues to hold 15%+ edge props. This is a simple fork -- same analysis, different destination based on edge threshold.

#### 3. Update `bot-generate-daily-parlays` Pipeline

- **Fetch correct-priced lines** alongside mispriced lines (new query against `correct_priced_lines` table)
- **Enrich correct-priced picks** with the same hit rate, odds, and composite scoring pipeline (but tagged as `line_source: 'correct_priced'`)
- **New strategy: `mixed_conviction_stack`** -- A 3-leg builder that requires:
  - Leg 1: From mispriced pool (15%+ edge)
  - Leg 2: From correct-priced pool (3-14% edge, 65%+ L10 hit rate)
  - Leg 3: From double/triple confirmed pool
- Each leg must be a different player (existing correlation blocking applies)
- Add 2-3 `mixed_conviction_stack` profiles to the execution tier, positioned after the priority conviction strategies

#### 4. Add Strategy to Priority Bypass
Add `mixed_conviction_stack` to the `PRIORITY_STRATEGIES` set so it also bypasses the diversity cap -- it contains a conviction leg by definition.

### Technical Details

**Migration SQL:**
```sql
CREATE TABLE IF NOT EXISTS public.correct_priced_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name text NOT NULL,
  prop_type text NOT NULL,
  book_line numeric NOT NULL,
  player_avg_l10 numeric,
  player_avg_l20 numeric,
  edge_pct numeric,
  signal text CHECK (signal IN ('OVER', 'UNDER')),
  shooting_context jsonb,
  confidence_tier text,
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  sport text DEFAULT 'basketball_nba',
  defense_adjusted_avg numeric,
  opponent_defense_rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_name, prop_type, analysis_date)
);

ALTER TABLE public.correct_priced_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read correct priced lines"
  ON public.correct_priced_lines FOR SELECT USING (true);
CREATE POLICY "Service role can manage correct priced lines"
  ON public.correct_priced_lines FOR ALL USING (true) WITH CHECK (true);
```

**detect-mispriced-lines change (line ~331):**
```text
// Instead of: if (Math.abs(edgePct) < 15) continue;
// Now: fork into correct-priced vs mispriced
if (Math.abs(edgePct) >= 3 && Math.abs(edgePct) < 15) {
  correctPricedResults.push({ ...same fields... });
  continue;
}
if (Math.abs(edgePct) < 3) continue; // too small, skip entirely
// >= 15% falls through to existing mispriced logic
```

**bot-generate-daily-parlays new profiles:**
```text
{ legs: 3, strategy: 'mixed_conviction_stack', sports: ['all'], minHitRate: 65, sortBy: 'composite' },
{ legs: 3, strategy: 'mixed_conviction_stack', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'hit_rate' },
```

**mixed_conviction_stack builder logic:**
1. Pick best available conviction leg (triple > double confirmed, highest composite)
2. Pick best mispriced leg (different player, highest edge)
3. Pick best correct-priced leg (different player, highest hit rate, 65%+ required)
4. Apply existing correlation blocking + min line filters

### Files Modified
- `supabase/functions/detect-mispriced-lines/index.ts` -- fork 3-14% edge into correct_priced_lines
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- fetch correct-priced, add mixed_conviction_stack strategy + profiles
- New migration for `correct_priced_lines` table

### Impact
- More data captured daily (props currently thrown away now stored as correct-priced)
- New parlay type that diversifies conviction sources across 3 different engines
- Correct-priced anchor legs add stability to parlays (book agrees with the data)
- No changes to existing mispriced or conviction logic


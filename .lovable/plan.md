
# Build Our Own KenPom-Equivalent Efficiency Formula

## Why This Is Needed

The KenPom/BartTorvik scraper has been unreliable -- paywalled data, Cloudflare blocks, and broken parsing have left us with garbage efficiency values (AdjD of 52, 61, 150) and wrong rankings (Saint Louis #1, Auburn #33). Instead of fixing another scraper, we'll compute our own adjusted efficiency ratings using data we already have from ESPN.

## What We Have to Work With

| Data Source | Coverage | Reliability |
|-------------|----------|-------------|
| PPG (points per game) | 200/362 teams | Solid (ESPN API) |
| OPPG (opponent PPG) | 200/362 teams | Solid (ESPN API) |
| Home/Away records | 200/362 teams | Solid |
| SOS rank | 285/362 teams | Solid |
| adj_tempo | Garbage (avg 95, should be 67) | Needs recalculating |

## The Formula: "Parlay Adjusted Efficiency" (PAE)

KenPom's core idea: adjust raw scoring by opponent quality and pace. We'll replicate this with ESPN data.

### Step 1: SOS-Adjusted Offensive Rating (PAE-O)

Raw PPG doesn't account for schedule strength. A team scoring 85 PPG against a top-50 SOS is much better than 85 PPG against a bottom-50 SOS.

```text
D1 Average PPG = ~76.8 (calculated from our data)
SOS Factor = 1 + (181 - sos_rank) / 362 * 0.3
  -- Rank 1 (hardest) -> factor 1.15 (boost)
  -- Rank 181 (average) -> factor 1.00
  -- Rank 362 (easiest) -> factor 0.85 (penalize)

PAE_O = PPG * SOS_Factor
  -- Then normalize to per-100-possessions scale:
  PAE_O_adj = (PAE_O / estimated_possessions) * 100
```

### Step 2: SOS-Adjusted Defensive Rating (PAE-D)

Lower is better for defense. Teams allowing few points against tough opponents get rewarded.

```text
Inverse SOS Factor = 2 - SOS_Factor
  -- Hard schedule (rank 1) -> 0.85 (reduce OPPG = better defense)
  -- Easy schedule (rank 362) -> 1.15 (inflate OPPG = worse defense)

PAE_D = OPPG * Inverse_SOS_Factor
  PAE_D_adj = (PAE_D / estimated_possessions) * 100
```

### Step 3: Tempo Estimation

Since our adj_tempo field has garbage values, we'll estimate tempo from win margins and total scoring:

```text
Estimated Possessions = (PPG + OPPG) / 2 / D1_avg_PPG * 67
  -- 67 is average D1 possessions per game
  -- A team averaging 85+75=160 total / 2 = 80 -> 80/76.8*67 = 69.8 possessions
```

### Step 4: Power Rating (Composite Rank)

```text
PAE_NET = PAE_O_adj - PAE_D_adj  (like KenPom's AdjEM)

Win_Bonus = (win_rate - 0.5) * 10  
  -- Undefeated (1.0) -> +5
  -- .500 team -> 0
  -- Bad team (0.3) -> -2

Power_Rating = PAE_NET + Win_Bonus
  -- Sort by Power_Rating DESC to get rankings
```

### Step 5: Rank All 362 Teams

Teams without ESPN PPG/OPPG get estimated values from their SOS rank:
```text
Fallback PPG = D1_avg - (sos_rank - 181) * 0.03
Fallback OPPG = D1_avg + (sos_rank - 181) * 0.03
```

## Implementation

### File 1: Replace `ncaab-kenpom-scraper` with `ncaab-efficiency-calculator`

Rename/repurpose the scraper into a pure calculation function:

1. Load all 362 teams from `ncaab_team_stats` with PPG, OPPG, records, SOS
2. Calculate D1 averages from the dataset
3. For each team, compute PAE-O, PAE-D, estimated tempo, and PAE-NET
4. Rank all teams by PAE-NET descending
5. Write back to existing columns: `kenpom_rank` (our rank), `kenpom_adj_o` (PAE-O), `kenpom_adj_d` (PAE-D), `adj_tempo` (estimated), `kenpom_source = 'pae_formula'`
6. One-time cleanup: NULL out all existing garbage kenpom values first

### File 2: Update `ncaab-team-stats-fetcher` to cover more teams

The ESPN API currently only fetches 200 teams. We need to:
- Increase pagination (try pages 5-8 for remaining teams)
- For teams with SOS but no PPG, use conference averages as fallbacks
- Ensure all 362 teams get at least estimated values

### File 3: Scoring engine validation update

- Accept `kenpom_source = 'pae_formula'` as valid (currently only checks for 'kenpom' or 'barttorvik')
- The AdjO/AdjD validation ranges (90-135, 80-120) stay the same since PAE outputs are in the same scale

### Database: Cleanup migration

- NULL out all current garbage kenpom values (AdjD < 80 or > 120)
- No schema changes needed (reusing existing columns)

## Expected Results

| Metric | Current | After PAE |
|--------|---------|-----------|
| Teams ranked | ~51 (broken) | All 362 |
| Top 5 accuracy | Saint Louis #1 (wrong) | Auburn, Duke, Houston, Iowa State, Florida (correct) |
| AdjO range | 104-119 (sparse) | 90-125 (full coverage) |
| AdjD range | 52-173 (garbage) | 85-115 (validated) |
| Data source | Scraper (unreliable) | ESPN API + math (reliable) |
| Tempo values | avg 95 (wrong) | avg 67 (correct) |

## Files Changed

1. **MODIFY** `supabase/functions/ncaab-kenpom-scraper/index.ts` -- Replace scraper with PAE efficiency calculator using ESPN data + SOS ranks
2. **MODIFY** `supabase/functions/ncaab-team-stats-fetcher/index.ts` -- Expand ESPN pagination to cover more teams
3. **MODIFY** `supabase/functions/team-bets-scoring-engine/index.ts` -- Accept 'pae_formula' as valid kenpom_source
4. **DATABASE** -- One-time cleanup of garbage kenpom values

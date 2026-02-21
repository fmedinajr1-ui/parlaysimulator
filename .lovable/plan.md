

## MLB Batter Analyzer + Combined /mlb Telegram Command

### Overview

Build a new `mlb-batter-analyzer` edge function that cross-references MLBST batter props (Home Runs, Hitter Fantasy Score, Total Bases, Hits, RBIs, Stolen Bases) against `mlb_player_game_logs`, then create a `/mlb` Telegram command that shows the full MLBST slate across all prop types.

### 1. New Edge Function: `mlb-batter-analyzer`

**File:** `supabase/functions/mlb-batter-analyzer/index.ts`

Follows the exact pattern of `mlb-pitcher-k-analyzer`:

- Query `pp_snapshot` for active batter props: `batter_home_runs`, `batter_total_bases`, `player_hits`, `player_rbis`, `player_runs`, `batter_stolen_bases`, `player_fantasy_score`
- Deduplicate by player + stat_type (take latest)
- For each prop, look up L10/L20 from `mlb_player_game_logs` using the stat mapping:
  - `batter_home_runs` -> `home_runs`
  - `batter_total_bases` -> `total_bases`
  - `player_hits` / `batter_hits` -> `hits`
  - `player_rbis` / `batter_rbis` -> `rbis`
  - `player_runs` / `batter_runs` -> `runs`
  - `batter_stolen_bases` -> `stolen_bases`
  - `player_fantasy_score` -> calculated: `hits + walks + runs + rbis + total_bases + stolen_bases`
- Calculate L10 avg, L20 avg, median, hit rate over line, edge %, signal (OVER/UNDER), confidence tier
- Upsert results into `mispriced_lines` with the appropriate `prop_type`
- Send Telegram report grouped by tier
- Log to `cron_job_history`

### 2. Add `/mlb` Command to Telegram Webhook

**File:** `supabase/functions/telegram-webhook/index.ts`

Add a `handleMLB` function and wire it up:

- Query `mispriced_lines` for today where `sport = 'baseball_mlb'`
- Group results by prop type: Pitcher Ks, HRs, Total Bases, Fantasy Score, etc.
- Format a combined report showing the strongest edges across all MLB prop types
- Add `/mlb` to the command router and `/start` help menu
- Also add `/runmlbbatter` to trigger the analyzer on demand

### 3. Add `/runmlbbatter` Trigger

Wire `/runmlbbatter` to invoke the new `mlb-batter-analyzer` function, following the same `handleTriggerFunction` pattern used by `/runpitcherk`.

### Technical Details

**Stat-to-column mapping for game logs:**

```text
pp_snapshot stat_type    -> mlb_player_game_logs column
─────────────────────────────────────────────────────
batter_home_runs         -> home_runs
batter_total_bases       -> total_bases
batter_hits / player_hits -> hits
batter_rbis / player_rbis -> rbis
player_runs / batter_runs -> runs
batter_stolen_bases      -> stolen_bases
player_fantasy_score     -> SUM(hits + walks + runs + rbis + total_bases + stolen_bases)
```

**Confidence tiers** (same as pitcher K analyzer):
- ELITE: abs(edge) >= 25% AND hit rate >= 70% (over) or <= 30% (under)
- HIGH: abs(edge) >= 15% AND hit rate >= 60% (over) or <= 40% (under)
- MEDIUM: abs(edge) >= 8%
- Below 8% edge: skipped

**`/mlb` Telegram output format:**

```text
-- MLB FULL SLATE -- [date]
━━━━━━━━━━━━━━━━━━━━━━━━

Pitcher Ks: 5 plays | HRs: 3 plays | TB: 4 plays | Fantasy: 6 plays

[Pitcher Strikeouts section]
[Home Runs section]
[Total Bases section]
[Hitter Fantasy Score section]
...
```

### Files Changed

| Action | File |
|--------|------|
| Create | `supabase/functions/mlb-batter-analyzer/index.ts` |
| Modify | `supabase/functions/telegram-webhook/index.ts` (add `/mlb`, `/runmlbbatter`, `handleMLB`) |


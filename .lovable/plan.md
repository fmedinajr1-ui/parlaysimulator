# Sport-Aware Slip Analyzer

## Problem

Today `analyze-parlay` treats every leg as NBA. It queries `median_lock_candidates`, `juiced_props`, `sharp_signals`, `unified_props`, `player_prop_hitrates` with no sport filter, then guesses the sport from whatever row matched. On a cross-sport slip (NBA + MLB + NHL), the MLB and NHL legs either get zero hits or get matched to the wrong sport's data, producing low-confidence "NEUTRAL" verdicts and useless swap suggestions.

The prop-type map in `_shared/leg-matcher.ts` also has collisions: `points` is shared between NBA and NHL, `hits` isn't tied to MLB, and football/tennis terms can leak across sports.

## Goal

Every leg uploaded through the analyzer is:
1. Tagged with a sport BEFORE engine lookups (NBA / WNBA / NCAAMB / MLB / NHL / NFL / NCAAF / Tennis / MMA / Golf / Soccer).
2. Cross-referenced ONLY against tables and rows for that sport.
3. Returned with the sport visible in the leg card, and any swap suggestion drawn from the same sport.

## Approach

### 1. Sport detection layer (`_shared/leg-matcher.ts`)

Add a `detectSport(parsed, rawDescription)` helper with a layered strategy:

- **Prop-type signature** (strongest signal):
  - MLB: `hits, total_bases, home_runs, rbis, stolen_bases, strikeouts, pitcher_outs, walks, runs, singles, doubles, triples`
  - NHL: `shots_on_goal, sog, saves, goals, blocked_shots, power_play_points, +/-`
  - NFL/NCAAF: `passing_yards, rushing_yards, receiving_yards, receptions, touchdowns, interceptions, completions, sacks`
  - Tennis: `aces, double_faults, games_won, sets_won, breaks`
  - MMA: `significant_strikes, takedowns, fight_to_go_distance`
  - Golf: `birdies, bogeys, made_cut, top_5, top_10`
  - NBA/WNBA/NCAAMB: `points, rebounds, assists, threes, steals, blocks, pra, pr, pa, ra, double_double, triple_double` (default basketball)
- **Caller hint**: respect `leg.sport` if the OCR/upload provided one.
- **Description keywords fallback**: scan raw text for "MLB", "NHL", "NFL", team-name dictionaries, "vs", pitcher names, etc.
- Returns a canonical sport key plus a confidence (`high | medium | low`).

Update `PROP_TYPE_MAP` to be sport-scoped: keep one flat map for normalization but also export a `PROP_SPORT_MAP` that maps each normalized prop → the sport(s) it belongs to. Resolve collisions (`points`, `assists`, `goals`) by requiring sport context before normalization picks the wrong canonical form.

### 2. Sport-routed engine queries (`analyze-parlay/index.ts`)

Refactor `gatherEngineHits(parsed, today)` → `gatherEngineHits(parsed, sport, today)`:

- Add a `sport` filter to every `unified_props`, `median_lock_candidates`, `juiced_props`, `player_prop_hitrates`, `sharp_signals`, `trap_probability_analysis`, `injury_reports` query (those tables already store a `sport` / `sport_key` column — verify and use it).
- For sport-specific tables, route by sport:
  - **MLB** → also query `mlb_player_game_logs`, `mlb_pitcher_props`, `hrb_rbi_analysis`, `first_inning_hr_scanner` results when the prop type matches.
  - **NHL** → query NHL-specific projection tables if present.
  - **NFL** → query NFL prop tables if present.
  - **Tennis** → query the tennis games analyzer outputs.
- Skip tables that don't apply (don't waste a query hitting NBA-only tables for an MLB leg).

Use `supabase--read_query` during implementation to confirm the exact column names and which sport-specific tables exist before wiring them in.

### 3. Sport-aware swap suggestions

`findTopSwap(parsed, today)` → `findTopSwap(parsed, sport, today)`:
- Only return swaps from the same sport as the weak leg. An NBA points leg never gets swapped for an MLB strikeout pick.
- For MLB legs, prefer `hrb_rbi_analysis` / pitcher signals over generic `median_lock_candidates`.

### 4. Frontend display (`src/components/results/EngineRecommendationCard.tsx` + `Results.tsx`)

- Show the detected sport badge on every leg card using `SportPropIcon`.
- If sport detection confidence is `low`, show a small "Sport: NBA (assumed)" tag so the user can see when the analyzer fell back.

### 5. Telegram path (`telegram-prop-scanner`)

The Telegram analyzer already calls `analyze-parlay`; once the function is sport-aware, the bot inherits the fix automatically. Add a one-line "Sports detected: NBA · MLB · NHL" header to the response so users see cross-sport routing happened.

## Files to change

- `supabase/functions/_shared/leg-matcher.ts` — add `detectSport`, `PROP_SPORT_MAP`, sport-scoped normalization
- `supabase/functions/analyze-parlay/index.ts` — thread sport through `gatherEngineHits`, `synthesizeLeg`, `findTopSwap`; add per-sport table routing
- `supabase/functions/find-swap-alternatives/index.ts` — same sport-filter treatment if it exists
- `src/components/results/EngineRecommendationCard.tsx` — sport badge + assumption hint
- `src/pages/Results.tsx` — pass sport into card; show "Sports detected" summary
- `supabase/functions/telegram-prop-scanner/index.ts` — surface detected sports list in reply

## Verification (per testing-policy memory: 5 independent tests)

1. Pure NBA 3-leg slip → all legs tagged NBA, hits NBA tables, no MLB swap leakage.
2. Pure MLB 3-leg slip (HR + Ks + Hits) → all legs tagged MLB, swap pulls from MLB engines.
3. Mixed slip (NBA points + MLB HR + NHL SOG) → each leg gets correct sport, three different engine pools used.
4. Ambiguous "Goals" leg → resolved to NHL via context, not MLB/Soccer.
5. Tennis Aces leg → tagged Tennis, doesn't match NBA threes despite "3" in the line.

No DB migrations required — all sport columns already exist on the engine tables.


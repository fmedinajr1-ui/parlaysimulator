

# Three New Scanners — Tennis Check + MMA Rounds + MLB NRFI

## Status of existing systems

**Tennis Games Analyzer** — fully deployed and functional (646 lines). Reads from `unified_props` for tennis, applies gender/surface modifiers, writes to `tennis_match_model` and `category_sweet_spots`. However, `unified_props` currently has zero tennis data — the whale-odds-scraper doesn't fetch tennis props (it only fetches team markets for tennis). The `pp-props-scraper` maps UFC/MMA but tennis data isn't flowing in yet. The analyzer logic is solid but needs data.

**MMA Total Rounds** — nothing exists. The Odds API supports `totals` market for `mma_mixed_martial_arts` which gives over/under total rounds. Currently the whale-odds-scraper fetches MMA as team-only (h2h, spreads, totals) but doesn't write those totals into any analysis pipeline.

**MLB NRFI (No Run First Inning)** — nothing exists. The Odds API supports `totals_1st_1_innings` for baseball which gives the first inning over/under line (typically 0.5). NRFI = Under 0.5 first inning runs. Hard Rock Bet is a supported bookmaker.

## Plan

### 1. New Edge Function: `hrb-nrfi-scanner`
Scrapes Hard Rock Bet first-inning totals via The Odds API.

- Fetch MLB events from `baseball_mlb` filtered to `hardrockbet`
- For each event, fetch `totals_1st_1_innings` market
- NRFI = Under 0.5 at the best available odds
- Cross-reference with pitcher data: query `unified_props` for `pitcher_strikeouts` lines as a proxy for starter quality (higher K line = better pitcher = more likely NRFI)
- Write qualifying NRFI picks to `category_sweet_spots` with category = `MLB_NRFI`
- Send Telegram alert with pitcher context and odds
- Filter: only emit when Under odds are ≥ -130 (value territory) or when both starters have high K lines (≥ 5.5)

### 2. New Edge Function: `mma-rounds-analyzer`
Analyzes UFC/MMA total rounds markets for over/under value.

- Fetch MMA events + `totals` market from The Odds API across multiple bookmakers
- Compare Hard Rock Bet line vs consensus (FanDuel, DraftKings, BetMGM)
- Identify fights where HRB total rounds line diverges from consensus by ≥ 0.5 rounds or where odds show value
- Apply fighter style heuristics: store metadata about fighter tendencies (wrestler vs striker) — initially manual via fight card analysis
- Write to `category_sweet_spots` with category = `MMA_ROUNDS_OVER` or `MMA_ROUNDS_UNDER`
- Telegram alert with fight context

### 3. Fix tennis data flow
The tennis analyzer queries `unified_props` for `sport IN ('tennis_atp', 'tennis_wta')` but no tennis data exists there. Two options:
- Option A: Add tennis to the whale-odds-scraper's prop market batches (but The Odds API has no tennis player props)
- Option B: The pp-props-scraper already maps ATP/WTA leagues — verify it's writing to `unified_props` with correct sport keys

I'll verify the pp-props-scraper writes tennis data, and if needed patch it to ensure tennis total games flow into `unified_props`.

### 4. Wire into morning-prep-pipeline
Add two new steps:
- Step 4.6: `hrb-nrfi-scanner` (after tennis, before settlement)
- Step 4.7: `mma-rounds-analyzer` (after NRFI, before settlement)
- Both non-fatal, same pattern as tennis step

## Files

| File | Action |
|------|--------|
| `supabase/functions/hrb-nrfi-scanner/index.ts` | **Create** — MLB first inning under scanner for HRB |
| `supabase/functions/mma-rounds-analyzer/index.ts` | **Create** — MMA total rounds analyzer |
| `supabase/functions/morning-prep-pipeline/index.ts` | **Edit** — add Steps 4.6 + 4.7 |
| `supabase/functions/pp-props-scraper/index.ts` | **Check/patch** — verify tennis data flows to unified_props |

## Telegram message style
All three scanners will use the conversational format from the recent formatting overhaul — narratives, not raw numbers. Examples:

**NRFI alert:**
```
⚾ MLB NRFI Scanner — 3 picks

1️⃣ Yankees @ Red Sox — NO RUN 1st INNING
   🧊 Cole (K line 7.5) vs Whitlock (K line 5.5)
   Both elite starters — 1st inning shutout likely
   💰 Under 0.5 @ -115 (HRB)

2️⃣ Dodgers @ Padres — NO RUN 1st INNING  
   ...
```

**MMA Rounds alert:**
```
🥊 MMA Rounds — 2 picks

1️⃣ Holloway vs Topuria — OVER 2.5 rounds
   Both elite strikers with strong chins.
   HRB line sits 0.5 below consensus.
   📊 Consensus: 3.0 | HRB: 2.5 | Edge: value over
```


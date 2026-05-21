## Goal

Build a **Cross-Sport Bulk Parlay Generator** that uses the proven Sweet Spot formula (L10 hit rate + floor/median + line edge) but extends it across MLB, NHL, NCAAB, NCAAF, and team-market plays (ML / Spread / Total) — not just NBA player props. Use Perplexity as a research layer to gather the cross-sport intelligence (pitching matchups, weather, sharp money, injuries, pace) that the formula then folds into scoring.

NBA volume is dying (211 active player props vs 2,339 MLB), so the engine needs to pivot to MLB as primary, NHL second, with team markets as full first-class citizens.

## The Formula (extended Sweet Spot v2)

Per leg:

```text
Safety       = 0.45 * L10_hit_rate
             + 0.20 * floor_margin       (how far floor sits vs line)
             + 0.15 * median_margin
             + 0.10 * line_value_edge    (model_prob - de-juiced implied)
             + 0.10 * research_boost     (Perplexity-derived signal, -0.1..+0.1)

Tier         = Lock (>=0.80)  |  Strong (0.70-0.79)  |  Lean (0.60-0.69)
HardDrops    = odds worse than -250, all-zero L10 Unders, spreads |line|>=9.5,
               poison signals (snapback/live drift), miss-by-1 leaks
```

Per parlay:

```text
ParlayScore  = geomean(leg.Safety) * combo_odds_band_bonus * diversity_bonus
Hard gates   = >=2 distinct games, <=1 team-market leg per game,
               >=1 player leg in any 3+ leg ticket, no conflicting sides
```

## Plan

### 1. Research layer — `cross-sport-parlay-research` (new edge function)

- Perplexity `sonar-pro` queries, one per sport in season today (MLB / NHL / NCAAB / NCAAF / NBA if any). Each call is structured-output (tool calling) so we get JSON, not prose.
- Pulls: probable pitchers + ERA/WHIP, weather + park factor, injury/lineup news, sharp/whale movement, pace mismatches, revenge/letdown spots.
- Writes to `bot_research_findings` keyed by `(sport, date, category)` and emits a normalized `research_boost` lookup keyed by team and player name.

### 2. Candidate builder — `cross-sport-sweet-spots` (new edge function)

Runs after `unified_props` and game logs are fresh:

- **Player legs**: pull from `unified_props` (`market_type='player'`) across all in-season sports. Join to sport-specific game logs (`mlb_player_game_logs`, future NHL/NCAA logs) to compute L10 hit rate, floor, median, std, bounce-back. Reuse the exact column shape of `category_sweet_spots`.
- **Team legs**: pull ML / Spread / Total from `unified_props`. Confidence = de-juiced implied prob + structural bumps (HOME ML +0.04, HOME Spread +0.03, UNDER +0.02), cap 0.85 — already implemented for parlay-engine-v2, lifted here.
- Apply hard drops (odds, fat spread, all-zero, poison signal) at this stage.
- Apply `research_boost` from step 1 (e.g. ace pitcher on short rest → opposing UNDER gets +0.05; wind blowing out → game OVER gets +0.04).
- Persist into a new table `cross_sport_sweet_spots` mirroring `category_sweet_spots` plus a `market_type` and `sport` column and `research_boost` audit field.

### 3. Bulk parlay assembler — `cross-sport-parlay-generator` (new edge function)

Per run, produces a configurable batch (default 25 tickets) across tiers:

```text
- 8 x 2-leg Lock combos        (band -250 .. +150)
- 8 x 3-leg Strong combos      (band +150 .. +500)
- 6 x 4-leg Stretch combos     (band +500 .. +1500)
- 3 x 5-leg Lottery            (band +1500 .. +5000)
```

For each slot:
- Pull tier-eligible legs from `cross_sport_sweet_spots`.
- Enforce: ≥2 distinct games; ≤1 team leg per game; ≥1 player leg when legs≥3; no same-game ML+Spread+Total stacking; cross-sport bonus if ≥2 sports.
- Rank by `ParlayScore`, dedupe by leg-set hash, persist to `bot_daily_parlays` with `tier`, `sport_mix`, and full leg metadata.

### 4. Broadcast + bot integration

- Reuse `parlay-engine-v2-broadcast` label resolver so team legs render as `"<Team> Spread (vs <Opp>)"` and player legs use full property names (per `mem://telegram/ui-standardization`).
- Send via `bot-send-telegram` with `type: 'cross_sport_parlay'`. Lock/Strong tickets always broadcast; Lean tickets only when no Lock exists that day (admin-only fallback note otherwise).
- Add a "Cross-Sport Parlay of the Day" pinned card analogous to `WhaleParlayOfTheDayCard`.

### 5. Scheduling

- 09:30 ET: `cross-sport-parlay-research`
- 09:45 ET: `cross-sport-sweet-spots`
- 10:00 ET: `cross-sport-parlay-generator` (bulk batch, broadcast top 5 per tier)
- 14:30 ET: re-run after lineups lock; replace any ticket whose leg is now DNP/scratched

All gated by `cloud_status === ACTIVE_HEALTHY` and the standard non-fatal failure pattern in `mem://infrastructure/pipeline/morning-prep-pipeline-unified`.

### 6. Memory + validation

- New memory: `mem://logic/parlay/cross-sport-generator` documenting the formula, weights, tier thresholds, and hard gates.
- 5 Deno tests per the project testing rule: (a) Perplexity JSON parser, (b) research_boost merge, (c) hard-drop gate (fat spread + all-zero Under), (d) parlay assembly diversity gate, (e) end-to-end fixture producing ≥1 ticket per tier from a frozen slate.

### Technical details

- **Tables**: new `cross_sport_sweet_spots` (mirrors `category_sweet_spots` + `sport`, `market_type`, `research_boost`); reuse `bot_daily_parlays` for output and `bot_research_findings` for raw Perplexity output.
- **Edge functions**: `cross-sport-parlay-research`, `cross-sport-sweet-spots`, `cross-sport-parlay-generator`.
- **Perplexity**: `sonar-pro` with `response_format: json_schema` for deterministic parsing; `search_recency_filter: 'day'`; secret `PERPLEXITY_API_KEY` already present.
- **Sport adapters**: MLB uses `mlb_player_game_logs`; NHL/NCAAB use existing log tables where available, fall back to season-avg + research-only scoring when L10 absent (Lean tier max).
- **Shared lib**: extract `_shared/cross-sport/{formula.ts, gates.ts, research.ts}` so the bulk generator and any per-sport one-offs share scoring.

## Open question before I build

Two choices change scope materially — please confirm:

1. **Sports included on day one**: MLB + NHL + NCAAB + NCAAF, or start MLB-only and add the others in a second pass?
2. **Bulk volume**: the 25-ticket-per-run default above, or a different mix (e.g., 10 Lock-only, or 50 spanning more lottery tickets)?

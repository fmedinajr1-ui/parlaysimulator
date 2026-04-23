## What's actually broken

Looking at the live data, every prop your bot scanned today says `no_match_in_unified_props`. That's why the pool is empty and it can't build a parlay. Three concrete bugs:

1. **Prop-type names don't line up.** Your market table (`unified_props`) stores `player_points`, `player_rebounds_assists`, `player_threes`, etc. The scanner normalizes OCR text to `points`, `ra`, `threes`. They never match.
2. **Player names don't line up.** PrizePicks renders `CJ McCollum`. The market data has `C.J. McCollum`. The current `ilike '%CJ McCollum%'` returns zero rows because of the periods.
3. **Junk prop types from PrizePicks get passed through.** Things like `2_pt_made`, `fg_made`, `rebs+asts` aren't markets that exist in `unified_props` at all — they should either be mapped to a real market or dropped.

On top of that, you said: *"we should know if it's going to be under or over."* Right now the scanner just takes whatever side appeared on the screen. It never tells you to flip from Over to Under when Under has the edge.

## The fix

### 1. Prop-type alias map (matching layer)

Add a single source of truth that maps every short name **and** every PrizePicks/Underdog quirk to the canonical Odds-API names:

```text
points              → player_points
rebounds            → player_rebounds
assists             → player_assists
threes              → player_threes
pra                 → player_points_rebounds_assists
pr                  → player_points_rebounds
pa                  → player_points_assists
ra / rebs+asts      → player_rebounds_assists
2_pt_made / fg_made → DROP (no liquid market) → flag prop as "unsupported_market"
shots_on_goal       → player_shots_on_goal
hits / total_bases  → unchanged (MLB)
```

Anything still unmatched after the alias pass gets dropped from the pool with `block_reason="unsupported_market"` instead of polluting the scan list.

### 2. Smarter player-name match

Strip punctuation and collapse to lowercase tokens on **both sides** before comparing, so `CJ McCollum` matches `C.J. McCollum`. Match strategy, in order:
- exact lowercased+depunctuated equality
- last-name + first-initial fallback (handles "C McCollum" style)
- only then fall back to `ilike` partial match

### 3. Auto-pick Over vs Under (the part you really asked for)

Instead of using whichever side the screenshot showed, for every captured prop the scanner will compute an **edge for both sides** and recommend one:

For each `(player, prop_type, line)` we look up:
- `over_price` and `under_price` from `unified_props` (the true market)
- L10 hit rate for both directions from `nba_player_game_logs` / `mlb_player_game_logs`
- Optional sweet-spot tag

We compute a **fair probability** from L10 (`hits_over / 10`), convert the market odds to **implied probability**, and the side with the bigger `fair_prob − implied_prob` (the **edge**) wins. Threshold: edge ≥ 4%. If neither side clears 4%, the prop is marked `no_edge` and excluded from the parlay pool.

Each captured prop in the pool will store:
- `recommended_side` (over | under | none)
- `edge_pct` (e.g. +7.2%)
- `fair_prob` and `implied_prob`
- A short `verdict` like *"UNDER 17.5 — L10 hit 7/10, market priced 52%, fair 70%, edge +18%"*

The pool screen and the parlay builder then use `recommended_side` instead of the side the user happened to see on the book.

### 4. Pool & parlay builder updates

- `composite_score` becomes `edge_pct * 10 + l10_hit_bonus + sweet_spot_bonus` so high-edge legs sort first.
- The parlay builder pulls only props with `edge_pct ≥ 4%` AND `recommended_side` set.
- `block_reason` reasons get human-friendly: `unsupported_market`, `no_edge`, `no_market_data`, `low_l10_sample`.

### 5. Telegram output gets a clear verdict

Each line in the pool message becomes:

```
1. James Harden — points UNDER 17.5  ✅ +12% edge
   ↳ L10 4/10 over · market -110 · fair 60% under
```

And when the bot can't build a parlay, instead of the confusing `pool_too_small:0`, it will say:

```
🤔 Couldn't build a parlay yet — only 1 prop has a real edge.
Send more screenshots or try a different book/sport.
```

## Files touched

- `supabase/functions/ocr-prop-scan/index.ts` — alias map, name normalizer, dual-side edge calculator, new fields in the insert payload
- `supabase/functions/ocr-pool-build-parlays/index.ts` — filter on `edge_pct`, sort by edge, friendlier reason text
- `supabase/functions/telegram-prop-scanner/index.ts` — render verdict line with recommended side + edge
- Schema: a small migration adding `recommended_side`, `edge_pct`, `fair_prob`, `implied_prob`, `verdict` columns to `ocr_scanned_props`

## What you'll see after this ships

Send the same FanDuel screenshot you sent earlier:

- `2 pt Made` rows for Harden/Mitchell/etc. → silently dropped (unsupported)
- `points`, `rebounds`, `pra`, `ra` → matched to the real market lines
- Each prop shows whether Over or Under is the value side, with a percentage edge
- Parlay builder picks the top-edge legs across distinct games and prints a real ticket

No more `no_match_in_unified_props` on legitimate props, no more empty pools, and the bot tells you which side to bet — not just what was on the screen.
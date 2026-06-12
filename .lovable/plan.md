# Soccer Sharp Market Engine

A Pinnacle-anchored sharp-divergence engine for soccer that devigs Pinnacle ML / Asian Handicap / Totals / Team Totals, compares against Hard Rock / DK / FD / Caesars / MGM, scores each opportunity with a Soccer-tuned CHESS formula, and surfaces edges + steam in a Sharp Scanner page.

## 1. Data layer (new tables)

- `soccer_sharp_lines` — Pinnacle snapshots per `(match_id, market_type, line)` with both `pinnacle_price_a/b` and devigged `sharp_probability_a/b`.
- `soccer_book_comparisons` — per book/market/line row with `sportsbook_probability`, `edge_percent`, side, captured at the same tick as the sharp row (FK to `soccer_sharp_lines`).
- `soccer_sharp_alerts` — fired alerts: `market`, `edge_percent`, `chess_score`, `classification` (LEAN/STRONG/HAMMER/STEAM), `status` (open/closed/expired), `recommended_side`, `risk_flags jsonb`.
- `soccer_line_movements` — opening + last + current line/price per book/market for the movement panel and steam detection.

All tables: `service_role` full grant + `authenticated SELECT`; RLS read-only for authenticated.

## 2. Devig + edge math (shared module)

`supabase/functions/_shared/soccer-devig.ts`:
- `americanToDecimal`, `decimalToImplied`
- `powerDevig(odds_a, odds_b)` — solves k such that `p_a^k + p_b^k = 1`, returns fair probs
- `edgePct(sharpProb, bookProb)` and `classifyEdge(edge)` → PASS/LEAN/STRONG/HAMMER
- Totals/AH use the matched line on each book; if no matched line, devig nearest and apply standard half-point adjustment.

## 3. Ingestion + comparison engine

`supabase/functions/soccer-sharp-ingest` (5-min cron):
1. Pull Pinnacle ML/AH/Totals/Team Totals for the target leagues (World Cup Qual, MLS, EPL, La Liga, Serie A, UCL, Copa Libertadores).
2. Power-devig each two-way market → insert `soccer_sharp_lines`.
3. Pull same matches/markets from secondary feed (Odds API / OpticOdds / SportsDataIO) for HRB, DK, FD, CZR, MGM → upsert `soccer_book_comparisons` with `edge_percent = sharp_prob - book_prob`.
4. Update `soccer_line_movements` (open if first sight, otherwise current/previous).
5. Run alert evaluator (see §5).

Secret strategy: requires `PINNACLE_API_KEY` (or RapidAPI Pinnacle Odds key) and at least one of `ODDS_API_KEY` / `OPTICODDS_API_KEY` / `SPORTSDATAIO_KEY`. Plan will pause for the user to add these before deploying the ingest.

## 4. Soccer CHESS scoring

`_shared/soccer-chess.ts`:
- SD = normalized edge vs Pinnacle (0–1)
- LM = AH line move magnitude in points (normalized)
- TM = Total line move magnitude (normalized)
- LI = lineup impact (placeholder 0; wires into existing `lineup_alerts` later)
- PS = public sentiment (placeholder from book consensus drift)
- `CHESS = 0.4·SD + 0.2·LM + 0.1·TM + 0.2·LI + 0.1·PS`, scaled 0–100.

## 5. Alert + steam logic

Alert when ALL: `edge > 4%` AND `chess > 70` AND Pinnacle moved before any compared book in the last 15 min AND ≥2 books still on the stale line. Classification follows edge buckets; bumped to `STEAM` when Pinnacle line moves (e.g. -0.5 → -0.75) before HRB/DK/FD adjust.

Hammer tier: `edge > 6% AND chess > 80`.

## 6. UI — `/soccer-sharp-scanner`

New page with three sections:
1. **Today's Edges** — table: Match · Market · Sharp Prob · Book Prob · Edge · CHESS · Classification, sortable by edge.
2. **Live Line Movement** — per market: Opening / Current / Δ / Direction with sparkline.
3. **Hammer Candidates** — filtered cards (edge>6, chess>80) showing EV %, market, recommended side, risk flags.

Realtime via Supabase channel on `soccer_sharp_alerts` + 30s polling fallback. Added to nav under existing Sharp tools.

## 7. Automation

`pg_cron` job `soccer-sharp-ingest-5min` invoking the edge function every 5 minutes (via `supabase--insert` so the per-project URL stays out of migrations).

## 8. Open questions before build

1. Which Pinnacle source do you have a key for — direct Pinnacle Odds API, RapidAPI Pinnacle Odds, or pull Pinnacle through OpticOdds?
2. For the non-Pinnacle books (HRB/DK/FD/CZR/MGM), do you want me to use The Odds API (already common in this project) or wire in OpticOdds/SportsDataIO?
3. Lineup Impact (LI) and Public Sentiment (PS) — ship as 0/neutral placeholders for v1, or block on a data source first?

## Technical details

- Tables created in one migration with GRANTs + RLS + `updated_at` triggers.
- Edge functions: `soccer-sharp-ingest` (cron + manual), `soccer-sharp-alert-evaluator` (called inline by ingest, also exposed for replay).
- Shared modules under `supabase/functions/_shared/` (`soccer-devig.ts`, `soccer-chess.ts`).
- Frontend: `src/pages/SoccerSharpScanner.tsx` + hook `src/hooks/useSoccerSharpScanner.ts`; route registered in `App.tsx`.
- No changes to existing MLB/tennis sharp pipelines.

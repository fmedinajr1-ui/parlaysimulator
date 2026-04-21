

## Export — All wins since day one

I'll generate a single Excel workbook with every winning pick across both sports and all engines, plus full context for each.

### Output file

`/mnt/documents/parlayfarm-all-wins-since-launch.xlsx`

### Workbook structure (5 sheets)

**Sheet 1 — `Summary`**
- Total wins, date range, breakdown by source / sport / engine / month
- Total simulated profit, average odds, biggest single win

**Sheet 2 — `Winning Parlays` (361 rows, since 2026-02-09)**
From `bot_daily_parlays WHERE outcome='won'`. One row per parlay:
- `parlay_date`, `tier`, `strategy_name`, `dna_grade`, `leg_count`, `legs_hit`, `legs_missed`, `legs_voided`, `expected_odds`, `combined_probability`, `simulated_win_rate`, `simulated_edge`, `simulated_stake`, `simulated_payout`, `profit_loss`, `selection_rationale`, `lesson_learned`, `approval_status`, `settled_at`, `created_at`, `id`

**Sheet 3 — `Parlay Legs` (one row per leg of every winning parlay)**
Flattened from the `legs` JSONB column of Sheet 2 — joined back to parent parlay by `parlay_id`. Columns: `parlay_id`, `parlay_date`, `tier`, `leg_index`, `player_name`, `team`, `opponent`, `sport`, `prop_type`, `line`, `side`, `odds`, `confidence`, `edge`, `signal_label`, `reason`, `actual_value`, `outcome`.

**Sheet 4 — `Winning Straight Props` (230 rows, since 2026-01-09)**
From `prop_results_archive WHERE outcome='hit'`:
- `game_date`, `sport`, `engine`, `player_name`, `team_name`, `opponent`, `prop_type`, `side`, `line`, `actual_value`, `confidence_score`, `edge`, `signal_label`, `archetype`, `reason`, `settled_at`, `archived_at`, `id`

**Sheet 5 — `By Sport / Engine`**
Pivot-style breakdown: hit count, hit rate context, avg confidence, avg edge per sport per engine per month.

### Formatting

- Currency columns ($) for stake/payout/profit, formatted with thousand separators and red parentheses for negatives
- Percentage columns (probability, edge, confidence) formatted as `0.0%`
- Dates as `YYYY-MM-DD`
- Frozen header row, autofiltered, column widths sized to content
- Numbers (not formulas) — this is a static export, not a model

### Process

1. Pull all 361 winning parlays + flatten the `legs` jsonb into a separate sheet
2. Pull all 230 winning props with full context
3. Compute summary aggregates in Python
4. Write workbook with openpyxl, apply formatting
5. Drop final file at `/mnt/documents/parlayfarm-all-wins-since-launch.xlsx`
6. Spot-check totals against the DB before delivering

### Notes / scope

- "Wins" = settled `outcome='won'` (parlays) and `outcome='hit'` (straight props). Pushes and pending excluded.
- Data starts 2026-01-09 (first archived hit). Earlier picks predate the results archive table and aren't recoverable from a settled-outcome view.
- Tables with zero recorded wins (`bot_daily_picks`, `final_verdict_picks`, `scout_prop_outcomes`, `user_parlay_outcomes`) are skipped — no data to export.
- Signal context (matchup notes, line history, sharp money) lives in different tables and is not joined here unless you want a deeper enrichment pass — the columns above already include `reason`, `signal_label`, `selection_rationale`, and `lesson_learned` which carry the per-pick narrative.


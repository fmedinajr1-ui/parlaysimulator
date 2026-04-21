

## Engine-level deep-dive export — Feb & March

I'll generate a research-grade dataset that breaks down every parlay from Feb and March by the **engine / strategy / signal source** that built it, so you can isolate which engines actually drove accuracy vs. which were noise.

### Output

`/mnt/documents/research/feb-march-engine-deep-dive.xlsx` + matching CSVs at `/mnt/documents/research/csv/` (so you can browse without the sheet-tab issue).

### Workbook structure (7 sheets)

**Sheet 1 — `Engine Scorecard`** *(the main answer)*
One row per `strategy_name` per month. Columns:
- Month, Strategy, Total Parlays, Unique Parlays (deduped by leg combo), Wins, Losses, Voids, **Win Rate (raw)**, **Win Rate (deduped)**, Avg Legs, Avg Expected Odds, Total Stake, Total Payout, Net Profit, ROI%, Avg DNA Grade, Sample Confidence (high/med/low)

**Sheet 2 — `Engine × Sport`**
Same metrics broken down by strategy AND sport (NBA/MLB/NCAAB/NHL). Reveals which engines work for which sports.

**Sheet 3 — `Engine × Leg Count`**
Strategy × leg count (2/3/4/5/7/8). Shows whether an engine's accuracy collapses at higher leg counts.

**Sheet 4 — `All Parlays` (Feb + March, every parlay)**
Full row per parlay: date, month, strategy, tier, legs count, sport mix, dna_grade, expected_odds, combined_probability, simulated_edge, outcome, profit_loss, **leg_combo_hash** (md5 of legs for dedup analysis), **is_duplicate** (true if same hash exists earlier same day), selection_rationale, lesson_learned.

**Sheet 5 — `All Legs` (every leg of every Feb/March parlay)**
Flattened legs with parent strategy attached: parlay_date, strategy, leg_index, sport, player/team, prop_type (cleaned), side, line, odds, projected, actual, outcome, hit_rate, confidence, signal_source. Lets you ask "which signal_source has the best per-leg hit rate within strategy X?"

**Sheet 6 — `Signal Source Performance`**
Aggregated from leg-level data: signal_source × month × outcome. Surfaces which underlying signals (mispriced_edge, sharp_steam, cascade, snapback, velocity_spike, etc.) actually hit at the leg level — independent of which strategy bundled them.

**Sheet 7 — `Duplication Audit`**
Per day: total parlays, unique leg combos, duplication ratio, top duplicated combos. Confirms / quantifies the Feb 26 inflation issue and exposes any similar days in March.

### What this enables

- "Strategy X has 28% raw win rate but 18% deduped — kill it"
- "mispriced_edge legs hit 71%, but role_stacked_8leg using them only wins 4% — the engine bundling is the problem, not the signal"
- "force_mispriced_conviction works on NBA 3-leg only — gate it"
- "Feb's edge was X engine; reproduce it in April"

### Process

1. Pull all Feb + March parlays from `bot_daily_parlays` (~2,445 rows)
2. Compute `leg_combo_hash` and dedup flags
3. Flatten legs jsonb (~7K leg rows)
4. Aggregate the 3 scorecard sheets in pandas
5. Apply prop/sport label cleanup (same maps as previous export)
6. Write workbook with formatting (color-coded outcomes, % formats, frozen headers, autofilter) + parallel CSVs
7. Recalculate formulas, verify zero errors, spot-check totals against DB

### Out of scope

- Cross-referencing into `engine_live_tracker` or `signal_accuracy` tables for the original signal scores at generation time (deeper enrichment pass — let me know if you want it as a follow-up; it's another ~30 min of analysis)
- April data (only 19 days, too small to compare)
- Recommendations/remediation — this export is the raw research material; we'll act on findings in a separate pass


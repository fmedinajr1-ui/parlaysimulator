

## Export historical RBI Under parlay legs to .xlsx

Pull every RBI Under leg ever shipped in `bot_daily_parlays` (Feb 10 – Apr 20, 2026) and write it to a workbook at `/mnt/documents/rbi_unders_history.xlsx`.

### What's in the file

**Sheet 1 — All RBI Under legs** (every historical RBI Under leg, both jsonb shapes normalized):

| parlay_date | player | prop | side | line | odds | parlay_outcome | leg_outcome | strategy | parlay_id |
|---|---|---|---|---|---|---|---|---|---|

Sorted by `parlay_date desc`, then `odds` (juiciest first).

**Sheet 2 — From winning parlays only** (the only legs we can be confident hit, since every leg of a won parlay must have hit):

Same columns, filtered to `parlay_outcome = 'won'`. Based on what's in the DB now this will be **1 parlay's worth of RBI legs** — small, but it's the only "known winners" set we actually have.

**Sheet 3 — Summary**:
- Total RBI Under legs shipped
- Breakdown by parlay outcome (won / lost / void / pending)
- Avg odds, juiciest leg, most-frequent player
- Date range covered

### Honest caveats baked into the file

A "Notes" header on Sheet 1 spells out:
- Leg-level wins were never graded — `leg_outcome` is mostly null
- `parlay_outcome = 'void'` usually means a different leg's player DNP'd, not that the RBI Under itself lost
- For true leg-level RBI Under win history, we'd need the settlement engine from the previous plan

### What this does NOT do

- No DB changes, no migrations
- No settlement engine
- No edge function
- No frontend changes
- Pulls only from `bot_daily_parlays` (existing data, read-only)

### Sequence

1. Query `bot_daily_parlays` for every leg where `prop`/`prop_type` matches RBI and `side` = under
2. Normalize the two leg shapes into one row format
3. Write the 3-sheet `.xlsx` to `/mnt/documents/rbi_unders_history.xlsx`
4. Return artifact link

If you want **leg-level true win/loss** for these historical RBIs (cross-reference each player+date against `mlb_player_game_logs` to grade what *actually* happened), say so and I'll add a Sheet 4 "Reconstructed leg outcomes" that does that grading at export time. No DB writes — purely computed in the export script.


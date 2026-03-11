

## Fix L3 Cross-Engine Production Bottlenecks

### Root Cause Analysis

Today's data shows:
- **101** L3-confirmed mispriced picks
- **83** sweet spot picks with L3 data
- **0** high conviction results

The engine has **three compounding restrictions** that choke output:

1. **Double L3 filtering**: Mispriced picks already require `l3_confirms === true`, but then the assembly loop (line 225-228) applies ANOTHER L3 gate requiring `l3_avg >= line * 0.85` for overs. This is redundant — a pick confirmed as L3-aligned is being re-filtered with a stricter threshold.

2. **High conviction dependency**: With 0 high conviction results today, no pick can achieve 3-source overlap. The overlap bonus (15 pts per source) means single-source picks score drastically lower, pushing quality picks to the bottom.

3. **Hard 3-leg minimum**: If the double gate filters too many, the engine returns "insufficient_legs" and produces nothing.

### Changes (`l3-cross-engine-parlay/index.ts`)

**1. Remove redundant assembly L3 gate**
Delete lines 224-228 (the second L3 filter in the assembly loop). Source data is already L3-validated — mispriced requires `l3_confirms === true`, and sweet spots have non-null `l3_avg`. The composite score already penalizes picks with poor L3 margins via `l3Score`, so bad picks naturally rank lower without a hard gate.

**2. Accept all L3-confirmed sources independently**
Currently all three sources feed the pickMap, but the scoring heavily rewards overlap. Adjust the composite formula:
- Reduce overlap bonus from 15 to 10 per extra source
- Increase L3 margin weight from 40 to 60 (reward strong L3 clearance over multi-engine overlap)
- Add a hit rate floor: require `hit_rate >= 0.6` OR `edge_pct >= 8` OR `sources.length >= 2` to enter the scored picks array — this replaces the hard L3 gate with a quality floor

**3. Lower minimum legs to 2 with adjusted stake**
If only 2 quality legs pass scoring, build a 2-leg parlay at reduced stake ($5 instead of $10). Keep 3-5 legs as the preferred range.

**4. Inline L3 backfill for sweet spot picks missing l3_avg**
Query `nba_player_game_logs` for any sweet spot pick where `l3_avg` is null, compute it on the fly (last 3 games), and populate before scoring. This prevents good sweet spot candidates from scoring 0 on the L3 margin component.

### Expected Impact

With these changes, the engine should produce 1-2 parlays daily from the ~180 available L3-confirmed picks instead of returning "insufficient_legs". Quality is maintained through composite scoring rather than hard gates.


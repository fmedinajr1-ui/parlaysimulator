

# Flip SB Alerts to "Over 0.5 Stolen Bases"

## Why

Hard Rock Bet only offers the **Over** side for stolen bases props. The current analyzer generates "Under 0.5 SB" alerts, which users can't actually bet on HRB.

## The flip

Since most players rarely steal bases, L10 avg ≤ 0.3 means the Over hits ≤ 30% of the time — that's bad for Over bets. We need to **invert the logic**: find players who DO steal bases frequently and recommend Over.

### Changes to `mlb-sb-analyzer/index.ts`

- **New gates** (inverted from current):
  - L10 SB avg must be ≥ 0.5 (player steals regularly)
  - L10 Over hit rate (games with ≥1 SB) must be ≥ 50%
- **Prediction text**: `Over 0.5 Stolen Bases`
- **Signal type**: `sb_over_l10`
- **Metadata**: store `over_price` instead of `under_price`, `l10_over_rate` instead of `l10_under_rate`
- **Confidence**: based on over hit rate
- **Telegram summary**: updated wording to reflect Over picks

### Changes to `mlb-sb-settler/index.ts`

No changes needed — it already handles both Over and Under settlement correctly (lines 129-139).

### Impact

This targets players like Victor Scott II, Jose Ramirez, etc. who are active base stealers. With the 0.5 line, players averaging ≥0.5 SB/game should hit Over at a profitable rate.


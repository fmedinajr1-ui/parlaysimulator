
# Deep Calibration & Weighting System Overhaul

## ✅ COMPLETED

### Phase 1: Bootstrap Weights from Historical Data ✅
- Created `calibrate-bot-weights` edge function
- Queries actual hit rates from `category_sweet_spots` (8,863+ settled picks)
- Calculates true hit rates per category/side
- Upserts ALL active categories into `bot_category_weights` with real data
- Weight formula: `clamp(0.5, 1.5, base(1.0) + (hitRate - 0.50) * 0.8 + sampleBonus)`

**Initial Calibration Results:**
| Category | Side | Hit Rate | Weight | Samples | Status |
|----------|------|----------|--------|---------|--------|
| THREE_POINT_SHOOTER | over | 63.2% | 1.21 | 105 | ✅ Active |
| LOW_SCORER_UNDER | under | 66.0% | 1.18 | 60 | ✅ Active |
| BIG_ASSIST_OVER | over | 59.0% | 1.12 | 69 | ✅ Active |
| VOLUME_SCORER | over | 52.4% | 1.12 | 141 | ✅ Active |
| BIG_REBOUNDER | over | 52.4% | 1.07 | 88 | ✅ Active |
| ROLE_PLAYER_REB | over | 48.2% | 1.09 | 155 | ✅ Active |
| HIGH_ASSIST | over | 33.3% | 0.00 | 43 | 🚫 BLOCKED |

### Phase 2: Continuous Learning Integration ✅
- Modified `bot-settle-and-learn` to sync from `category_sweet_spots` verified outcomes
- Queries recently settled picks (last 24h) and applies incremental learning
- Auto-triggers `calibrate-bot-weights` after each settlement run
- Added streak-based blocking (5+ consecutive misses)
- Added hit-rate-based blocking (<35% with 20+ samples)

### Phase 3: Blocking Rules ✅
Implemented automatic category blocking when:
- ✅ Hit rate drops below 35% with 20+ samples
- ✅ 5+ consecutive misses (streak-based block)
- ✅ Weight drops below minimum threshold

### Phase 4: Database Migration ✅
- Added `last_calibrated_at` timestamp column
- Created index on `(category, side)` for faster lookups
- Created index on `(outcome, settled_at)` for outcome queries

---

## Files Changed

| File | Status |
|------|--------|
| `supabase/functions/calibrate-bot-weights/index.ts` | ✅ Created |
| `supabase/functions/bot-settle-and-learn/index.ts` | ✅ Updated |
| `supabase/config.toml` | ✅ Updated |
| Database migration | ✅ Applied |

---

## Next Steps (Optional Enhancements)

1. **Add cron job** for weekly full weight rebuild (Sundays)
2. **Add Telegram /calibrate command** for manual triggering
3. **Dashboard UI** to visualize category weights and performance


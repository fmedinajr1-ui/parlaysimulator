

## Scale Up cross_sport_4 & double_confirmed_conviction

### Current Profile Counts

| Strategy | Exploration | Validation | Execution | Total |
|----------|------------|------------|-----------|-------|
| `cross_sport_4` | 2 | 2 | 10 | 14 |
| `double_confirmed_conviction` | ~11 | ~7 | 0 | ~18 |

**Key finding**: `double_confirmed_conviction` has zero execution-tier profiles — it only runs at exploration/validation stakes. This explains lower volume despite good win rate.

### Changes (`bot-generate-daily-parlays/index.ts`)

**1. Add `double_confirmed_conviction` to Execution tier (6 profiles)**
Insert before the cross_sport_4 execution block (line 1057):
- 2× `composite` sort, NBA, `minHitRate: 65`
- 2× `hit_rate` sort, all sports, `minHitRate: 60`
- 1× `shuffle` sort, NBA, `minHitRate: 65`
- 1× sport-pair NBA+NHL, `minHitRate: 60`, `composite`

This puts it at $100 stake with strict 65%+ hit rate filtering.

**2. Add 4 more `cross_sport_4` execution profiles (10 → 14)**
Add after line 1071:
- 2× `shuffle` sort with NBA+NHL sport pair
- 2× `hit_rate` sort with NBA+NCAAB sport pair

This increases sport-pair diversity while maintaining the 55% hit rate floor.

**3. Bump execution tier count from 40 to 50**
Update line 951 (`count: 40` → `count: 50`) to accommodate the 10 new profiles.

### Expected Output
- **cross_sport_4**: 14 → 18 execution profiles → 4-6 unique parlays/day at $100-250 stakes
- **double_confirmed_conviction**: 0 → 6 execution profiles → 4-6 unique parlays/day at $100 stakes (plus existing validation/exploration output)




# DD/TD Pattern Detector — Pipeline Integration

## Overview
Add a new edge function that automatically detects Double-Double and Triple-Double candidates from game log patterns, runs as part of the daily pipeline, and broadcasts top candidates to all customers via Telegram.

## What Gets Built

### 1. New Edge Function: `dd-td-pattern-analyzer`
**File:** `supabase/functions/dd-td-pattern-analyzer/index.ts`

Queries `nba_player_game_logs` and cross-references with tonight's schedule (`game_bets`) to produce ranked DD/TD candidates.

**Per-player pattern analysis (minimum 10 games):**
- Season DD rate (games with 10+ in 2 stat categories: PTS/REB/AST/STL/BLK)
- Season TD rate (10+ in 3 categories)
- Home vs Away DD split
- L10 DD trend (hot/cold vs season)
- Per-opponent DD rate (when 2+ matchups exist)
- Near-miss frequency (8-9 in a secondary category)
- Minutes context (starter status, avg minutes)

**Composite scoring:**
```text
DD probability = 0.40 * season_rate
               + 0.25 * home_away_rate (context-adjusted)
               + 0.20 * l10_rate
               + 0.15 * vs_opponent_rate
```

**Flow:**
1. Fetch all players with 10+ games from `nba_player_game_logs`
2. Compute DD/TD stats per player
3. Cross-reference with tonight's `game_bets` schedule to get opponent + home/away
4. Score and rank only players with a game tonight
5. Send top candidates to Telegram via `bot-send-telegram`

### 2. New Telegram Notification Type: `dd_td_candidates`
**File:** `supabase/functions/bot-send-telegram/index.ts`

Add a new notification type that formats and broadcasts DD/TD candidates to all active customers. The message will look like:

```
🔮 DD/TD Watch — Mar 2

🏀 Double-Double Candidates:
1. Nikola Jokic vs POR (Home) — 88% | L10: 90%
2. Karl-Anthony Towns vs BOS (Home) — 64% | L10: 70%
3. Bam Adebayo vs CLE (Away) — 55% | L10: 50%

🌟 Triple-Double Watch:
1. Nikola Jokic vs POR — 44% season rate
2. Jalen Johnson vs MIA — 12% (trending up L10)

📊 Based on season game logs, home/away splits, opponent history
```

This notification type will bypass quiet hours (same as other customer-facing reports like `double_confirmed_report`).

### 3. Pipeline Integration
**File:** `supabase/functions/data-pipeline-orchestrator/index.ts`

Add the function call in **Phase 2 (Analysis)**, after the double-confirmed scanner — this is where pattern analysis engines run:

```text
Phase 2: ANALYSIS
  ...existing analyzers...
  await runFunction('double-confirmed-scanner', {});
  await runFunction('dd-td-pattern-analyzer', {});   // NEW
  await runFunction('recurring-winners-detector', {});
```

### 4. Database Table: `dd_td_predictions`
Stores nightly predictions for accuracy tracking and settlement.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Auto-generated |
| prediction_date | date | Game date |
| player_name | text | Player name |
| prediction_type | text | 'DD' or 'TD' |
| season_rate | numeric | Overall season % |
| home_away_rate | numeric | Context-adjusted % |
| vs_opponent_rate | numeric | Opponent-specific % |
| l10_rate | numeric | Last 10 games % |
| composite_score | numeric | Final weighted probability |
| opponent | text | Tonight's opponent |
| is_home | boolean | Home game? |
| near_miss_rate | numeric | How often they get 8-9 in a stat |
| games_played | integer | Total games this season |
| outcome | text | 'pending' / 'hit' / 'miss' |
| created_at | timestamptz | Default now() |

No RLS needed (backend-only table, no frontend access).

## Technical Details

**DD detection logic per game:**
```typescript
const cats = [
  g.points >= 10,
  g.rebounds >= 10,
  g.assists >= 10,
  g.steals >= 10,
  g.blocks >= 10
].filter(Boolean).length;

const isDD = cats >= 2;
const isTD = cats >= 3;
```

**Near-miss detection (signals "almost DD"):**
```typescript
// Count categories at 8-9 when player had exactly 1 category at 10+
const nearMissCats = [
  g.points >= 8 && g.points < 10,
  g.rebounds >= 8 && g.rebounds < 10,
  g.assists >= 8 && g.assists < 10,
].filter(Boolean).length;
```

**Schedule matching:** Uses the same `game_bets` query pattern (noon-ET-to-noon-ET window, deduplication by `game_id`) already established in the `/lookup` fix.

## Files Changed

| File | Action |
|------|--------|
| `supabase/functions/dd-td-pattern-analyzer/index.ts` | Create |
| `supabase/functions/bot-send-telegram/index.ts` | Modify (add `dd_td_candidates` type + formatter) |
| `supabase/functions/data-pipeline-orchestrator/index.ts` | Modify (add to Phase 2) |
| Database migration | Create `dd_td_predictions` table |

## Validation
1. Run the function manually and confirm it returns ranked DD/TD candidates
2. Verify Telegram message is broadcast to all active customers
3. Confirm predictions are persisted in `dd_td_predictions` for future settlement tracking

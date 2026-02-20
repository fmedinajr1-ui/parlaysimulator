

## Add High-Conviction Plays to Parlay Generation + Telegram Commands

### Current Gap

The **high-conviction analyzer** (cross-engine overlaps between mispriced lines, risk engine, prop v2, sharp, and heat) currently only generates a **Telegram report**. It does NOT feed those plays into the parlay generation engine. Meanwhile, `bot-generate-daily-parlays` fetches raw `mispriced_lines` but ignores the cross-engine conviction scoring.

### What We'll Build

**1. New Telegram Commands (3 admin commands)**

| Command | Action |
|---------|--------|
| `/mispriced` | Triggers `detect-mispriced-lines` on demand, which chains into `high-conviction-analyzer` and sends reports |
| `/highconv` | Triggers `high-conviction-analyzer` directly and sends the top-15 cross-engine overlaps |
| `/forcegen` | Triggers `bot-force-fresh-parlays` to generate high-conviction 3-leg parlays immediately |

**2. Feed High-Conviction Plays into Main Parlay Generation**

Update `bot-generate-daily-parlays` to also query the high-conviction analyzer output and boost those picks during candidate selection. Specifically:
- After fetching mispriced lines, also run the cross-engine overlap check inline
- Picks that appear in 2+ engines with side agreement get a conviction bonus applied to their composite score
- This ensures the main generation engine naturally prioritizes the strongest statistical edges

**3. Pipeline Integration**

Add `high-conviction-analyzer` to Phase 2 of the orchestrator (after `detect-mispriced-lines`) so it runs automatically every cycle, not just when chained from mispriced detection.

### Technical Details

**File: `supabase/functions/telegram-webhook/index.ts`**

Add three new admin command handlers:

```
/mispriced  -> calls detect-mispriced-lines edge function
/highconv   -> calls high-conviction-analyzer edge function  
/forcegen   -> calls bot-force-fresh-parlays edge function
```

Each handler invokes the respective edge function via fetch, waits for the response, and returns a summary message (e.g., "Found 118 mispriced lines, 23 high-conviction overlaps"). The full detailed reports are sent separately by the existing Telegram notification system.

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

In the data-fetching section (around line 2939), add a parallel query to fetch today's high-conviction plays that have already been computed:
- Query `mispriced_lines` WHERE `confidence_tier` IN ('ELITE', 'HIGH') AND `edge_pct` magnitude >= 50
- Cross-reference with `nba_risk_engine_picks` for same player+prop overlaps
- Apply a conviction multiplier (1.3x) to the composite score for picks that have 2+ engine confirmations

This means the standard generation templates (`mispriced_edge` strategy at lines 139-141) will naturally select the highest-conviction picks first.

**File: `supabase/functions/data-pipeline-orchestrator/index.ts`**

Add `high-conviction-analyzer` explicitly after `detect-mispriced-lines` in Phase 2 for reliability (currently it only fires when chained from mispriced detection, which could silently fail):

```
await runFunction('detect-mispriced-lines', {});
await runFunction('high-conviction-analyzer', {});   // NEW - explicit call
```

### Files Changed

| Action | File |
|--------|------|
| Modify | `supabase/functions/telegram-webhook/index.ts` (add 3 commands + handlers) |
| Modify | `supabase/functions/bot-generate-daily-parlays/index.ts` (conviction boost for cross-engine picks) |
| Modify | `supabase/functions/data-pipeline-orchestrator/index.ts` (add explicit high-conviction-analyzer call) |


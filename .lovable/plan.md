

# Connect Perplexity Sharp Money Intel to Whale Signal Detector

## What This Does

After the `whale-signal-detector` generates signals from book-to-book divergence (math-based), it will cross-reference today's Perplexity findings from `bot_research_findings` to boost whale picks that have confirmed sharp/whale action from real market intelligence.

## How It Works

```text
CURRENT FLOW:
  whale-signal-detector → book divergence math → sharp_score → whale_picks

NEW FLOW:
  whale-signal-detector → book divergence math → sharp_score
                        → query bot_research_findings for today's sharp intel
                        → fuzzy match player names + props
                        → boost sharp_score by +8 to +12 when Perplexity confirms
                        → add "Perplexity confirmed" to why_short[]
                        → whale_picks (with boosted scores)
```

## Implementation

### File: `supabase/functions/whale-signal-detector/index.ts`

**New function: `fetchPerplexitySharpIntel`** (inserted before the main serve block)
- Queries `bot_research_findings` for today's entries in categories: `nba_nhl_sharp_signals`, `ncaab_sharp_signals`, `tennis_sharp_signals`, `table_tennis_signals`, `value_line_discrepancies`
- Parses `key_insights` and `summary` text to extract player names, prop types, and directional signals (OVER/UNDER/favorite/underdog)
- Returns a map of normalized player names to their Perplexity-confirmed signals

**New function: `matchPerplexitySignal`**
- Fuzzy matches a whale pick's `player_name` + `stat_type` against the Perplexity intel map
- Uses case-insensitive substring matching (e.g., "LeBron" matches "LeBron James PTS opened at 25.5")
- Returns boost amount based on match quality:
  - +12 if player name AND prop type AND direction all match
  - +8 if player name AND direction match (no specific prop)
  - +5 if player name mentioned in sharp context (generic)

**Modification: After allSignals is built (line ~430), before insert**
- Call `fetchPerplexitySharpIntel(supabase)` to get today's research
- Loop through `allSignals`, check each against the intel map
- If matched: boost `sharp_score`, upgrade `confidence_grade` if threshold crossed, append to `why_short[]`
- Log how many signals got Perplexity confirmation

### Changes Summary

| What | Where | Detail |
|------|-------|--------|
| Add `fetchPerplexitySharpIntel()` | New function ~line 165 | Queries today's research findings, extracts player/signal intel |
| Add `matchPerplexitySignal()` | New function ~line 200 | Fuzzy matches whale picks against Perplexity intel |
| Perplexity cross-ref loop | After line 430, before insert | Boosts matched signals, updates why_short |
| Cron history update | Line 486 | Add `perplexityMatches` count to result |

### Example Output

Before Perplexity cross-ref:
```text
LeBron James | PTS | sharp_score: 62 | Grade B | book_divergence
```

After Perplexity confirms "LeBron PTS opened at 25.5, now 27.5 with 70% money on UNDER":
```text
LeBron James | PTS | sharp_score: 74 | Grade B | book_divergence
  why_short: ["1.5 pt book divergence", "3 books disagree", "Perplexity: sharp money confirmed UNDER"]
```

### Pipeline Timing

In the orchestrator, `ai-research-agent` runs as part of Phase 1 (Data Collection) or independently via cron. `whale-signal-detector` runs in Phase 2 (Analysis). So Perplexity data will always be available when the detector runs -- no ordering change needed.


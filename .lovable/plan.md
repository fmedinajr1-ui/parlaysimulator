

# Add Whale-Targeted Perplexity Query + Cross-Reference to AI Research Agent

## What This Does

Adds a **new dedicated research query** to the `ai-research-agent` that specifically asks Perplexity about today's whale money, steam moves, and sharp prop action. After all findings are stored, a **new cross-reference step** queries existing `whale_picks` and updates their conviction by matching them against the fresh Perplexity intel.

## How It Works

```text
CURRENT FLOW:
  ai-research-agent → 14 Perplexity queries → store findings → Telegram digest

NEW FLOW:
  ai-research-agent → 14 existing queries
                     → NEW query: "whale_money_steam_moves" (targeted whale/steam intel)
                     → store all findings
                     → NEW STEP: query today's whale_picks
                     → fuzzy match whale_picks against findings
                     → update whale_picks with conviction_score boost + why_short annotation
                     → include cross-ref results in Telegram digest
```

## Implementation

### File: `supabase/functions/ai-research-agent/index.ts`

**Change 1 -- New research query in RESEARCH_QUERIES array (~line 103)**

Add a new entry targeting whale money and steam moves specifically:
- Category: `whale_money_steam_moves`
- Query asks Perplexity for: today's biggest steam moves on player props, whale-sized wagers, prop lines that moved 1+ points since open, books pulling or freezing props, and specific player/prop/direction details
- System prompt instructs Perplexity to format each signal as: "PLAYER | PROP_TYPE | DIRECTION | line movement details"

**Change 2 -- Add title + emoji mappings (~lines 212-228, 279-294)**

- Title: `'Whale Money & Steam Moves'`
- Emoji: `'🐳'`

**Change 3 -- New function: `crossReferenceWhalePicks` (before the serve block)**

After findings are stored in the database, this function:
1. Queries `whale_picks` for today's unsettled picks (where `outcome` is null)
2. Queries `bot_research_findings` for today's sharp signal categories (`whale_money_steam_moves`, `nba_nhl_sharp_signals`, `ncaab_sharp_signals`, `tennis_sharp_signals`, `table_tennis_signals`)
3. For each whale pick, fuzzy-matches `player_name` against `key_insights` and `summary` text from findings
4. Assigns a conviction boost:
   - **+12** if player name + prop type + direction all match
   - **+8** if player name + direction match
   - **+5** if player name mentioned in sharp context
5. Updates the matching `whale_picks` row:
   - Boosts `sharp_score` (capped at 100)
   - Recalculates `confidence_grade` based on new score thresholds (A >= 80, B >= 65, C >= 55)
   - Appends a "Perplexity conviction: [detail]" entry to `why_short`
6. Returns a summary of how many picks were cross-referenced and boosted

**Change 4 -- Call cross-reference after DB insert (~line 269)**

After findings are inserted, call `crossReferenceWhalePicks(supabase)` and capture the result (match count, boosted picks).

**Change 5 -- Add cross-ref results to Telegram digest (~line 324)**

Append a line like: `"🐳 Whale Cross-Ref: 3/7 picks confirmed by Perplexity (boosted)"` to the digest message.

**Change 6 -- Include cross-ref stats in the response JSON (~line 370)**

Add `whaleMatches` and `whaleBoosted` counts to the returned JSON.

### Changes Summary

| What | Where | Detail |
|------|-------|--------|
| New Perplexity query | `RESEARCH_QUERIES` array | Dedicated whale money + steam moves query |
| Title + emoji maps | Lines ~212, ~279 | `whale_money_steam_moves` mappings |
| `crossReferenceWhalePicks()` | New function before `Deno.serve` | Queries whale_picks, fuzzy matches against findings, updates scores |
| Call cross-reference | After line 269 | Runs after findings are stored |
| Telegram digest update | Line ~324 | Adds whale cross-ref summary |
| Response JSON update | Line ~370 | Adds match/boost counts |

### Example Telegram Output

```text
🐳 Whale Money & Steam Moves 🟢
  • LeBron James PTS opened 25.5 now 27.5 — 70% sharp money UNDER
  • Connor McDavid SOG moved from 3.5 to 4.5 — steam detected OVER
  • Caitlin Clark AST frozen at 7.5 after sharp action

🐳 Whale Cross-Ref: 3/8 picks confirmed by Perplexity (boosted +8 to +12)
```


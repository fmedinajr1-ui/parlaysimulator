

# Team Name Alias Mapping for NCAA Baseball

## Problem
The scoring engine can't match team names between two data sources:
- **The Odds API** (used in `game_bets`): e.g., "Wright St Raiders", "Georgia St Panthers", "Kansas St Wildcats"
- **ESPN** (used in `ncaa_baseball_team_stats`): e.g., "Wright State Raiders", "Georgia State Panthers", "Kansas State Wildcats"

Currently **most baseball teams score as unmatched** (falling back to generic defaults), which produces weak composite scores and limits parlay quality.

## Root Cause
The existing `resolveBaseballTeam()` function in `team-bets-scoring-engine` has basic fuzzy matching that fails on:
- Abbreviations: "St" vs "State", "NC" vs "North Carolina"
- Missing teams in ESPN data (Charlotte 49ers, Army, Dallas Baptist, East Carolina, etc.)
- Mascot-only matching creating false positives (multiple "Falcons", "Patriots", etc.)

## Solution

### 1. Add a name normalization function to the scoring engine

Add a `normalizeTeamName()` helper that handles common abbreviations before map lookup:
- "St " to "State " (and vice versa)
- "NC State" to "NC State" (preserve)
- "Ga " to "Georgia ", etc.

### 2. Add an explicit alias map for known mismatches

A hardcoded `BASEBALL_TEAM_ALIASES` dictionary mapping Odds API names to ESPN names for cases that normalization alone can't fix. Based on today's data, this includes roughly 15-20 known aliases.

### 3. Improve `resolveBaseballTeam()` with multi-pass matching

Replace the current fuzzy matcher with:
1. Exact match (current)
2. Alias lookup
3. Normalized name match ("St" to "State" expansion)
4. School-name substring match (e.g., "Clemson" in "Clemson Tigers")

### 4. Add the same normalization to the whale-odds-scraper (optional enhancement)

Normalize team names at ingestion time so `game_bets` already stores the ESPN-compatible name, eliminating the need for runtime matching entirely.

---

## Technical Details

### File: `supabase/functions/team-bets-scoring-engine/index.ts`

**Add alias map** (before the `resolveBaseballTeam` function, around line 365):

```typescript
const BASEBALL_TEAM_ALIASES: Record<string, string> = {
  // "St" abbreviations
  'Wright St Raiders': 'Wright State Raiders',
  'Georgia St Panthers': 'Georgia State Panthers', 
  'Kansas St Wildcats': 'Kansas State Wildcats',
  'Oregon St Beavers': 'Oregon State Beavers',
  'Bowling Green Falcons': 'Bowling Green Falcons',
  // Common short names
  'NC State Wolfpack': 'NC State Wolfpack',
  'UNC Greensboro Spartans': 'UNC Greensboro Spartans',
  'UNC Wilmington Seahawks': 'UNC Wilmington Seahawks',
  // Other known mismatches
  'Army Knights': 'Army Black Knights',
  'BYU Cougars': 'BYU Cougars',
};
```

**Replace `resolveBaseballTeam`** with improved multi-pass matching:

```typescript
function normalizeBaseballName(name: string): string {
  return name
    .replace(/\bSt\b/g, 'State')
    .replace(/\bN\.\s*/g, 'North ')
    .replace(/\bS\.\s*/g, 'South ')
    .replace(/\bW\.\s*/g, 'West ')
    .replace(/\bE\.\s*/g, 'East ')
    .trim();
}

function resolveBaseballTeam(
  teamName: string, 
  statsMap: Map<string, BaseballTeamStats>
): BaseballTeamStats | undefined {
  // Pass 1: Exact match
  let stats = statsMap.get(teamName);
  if (stats) return stats;

  // Pass 2: Alias lookup
  const alias = BASEBALL_TEAM_ALIASES[teamName];
  if (alias) {
    stats = statsMap.get(alias);
    if (stats) return stats;
  }

  // Pass 3: Normalized name ("St" -> "State", etc.)
  const normalized = normalizeBaseballName(teamName);
  stats = statsMap.get(normalized);
  if (stats) return stats;

  // Pass 4: School name substring (first word(s) before mascot)
  const words = teamName.split(' ');
  if (words.length >= 2) {
    const school = words.slice(0, -1).join(' ').toLowerCase();
    if (school.length >= 4) {
      for (const [key, val] of statsMap) {
        if (key.toLowerCase().startsWith(school)) return val;
      }
    }
  }

  return undefined;
}
```

### File: `supabase/functions/whale-odds-scraper/index.ts` (optional)

Add the same `normalizeBaseballName` function and apply it when constructing `home_team` / `away_team` for `baseball_ncaa` bets at ingestion time, so the names stored in `game_bets` already match ESPN format.

### Deployment
- Deploy the updated `team-bets-scoring-engine` (and optionally `whale-odds-scraper`)
- Re-trigger the scoring engine for `baseball_ncaa` to rescore all 88+ bets with proper team matching
- Regenerate parlays with the improved scores


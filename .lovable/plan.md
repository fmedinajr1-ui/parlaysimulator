

# Fix Matchup Scanner Edge Function: Team Abbreviation Mapping

## Problem Identified

The `generate-matchup-scanner-picks` edge function returns 0 players because:

1. **Game descriptions** contain full team names: `"Minnesota Timberwolves @ Toronto Raptors"`
2. **`parseTeamsFromDescription()`** extracts: `{ awayTeam: "Minnesota Timberwolves", homeTeam: "Toronto Raptors" }`
3. **`team_zone_defense` table** stores abbreviations: `MIN`, `TOR`, `NYK`, etc.
4. **Query fails** because `"Minnesota Timberwolves"` is not in `["MIN", "TOR", ...]`

Result: No defense data matches, all players are skipped with `continue` at line 239.

---

## Solution

Add the NBA team abbreviation mapping directly to the edge function (cannot import from `src/lib`).

---

## File Changes

### File: `supabase/functions/generate-matchup-scanner-picks/index.ts`

**Add NBA team mapping constant** (after line 50):

```typescript
// NBA team name to abbreviation mapping
const NBA_TEAM_ABBREV: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'LA Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'LA Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS',
};

// Helper to get abbreviation from full name
const getTeamAbbrev = (fullName: string): string => {
  return NBA_TEAM_ABBREV[fullName] || fullName.substring(0, 3).toUpperCase();
};
```

**Update `parseTeamsFromDescription`** to return abbreviations:

```typescript
const parseTeamsFromDescription = (description: string): { awayTeam: string; homeTeam: string } => {
  const parts = description.split(' @ ');
  if (parts.length !== 2) {
    return { awayTeam: '', homeTeam: '' };
  }
  // Convert full names to abbreviations for database lookup
  return { 
    awayTeam: getTeamAbbrev(parts[0].trim()), 
    homeTeam: getTeamAbbrev(parts[1].trim()) 
  };
};
```

---

## Before vs After

| Step | Before | After |
|------|--------|-------|
| Parse game description | `"Minnesota Timberwolves"` | `"MIN"` |
| Query team_zone_defense | `IN ('Minnesota Timberwolves', 'Toronto Raptors')` | `IN ('MIN', 'TOR')` |
| Result | 0 rows | 10 rows (5 zones x 2 teams) |
| Players analyzed | 0 | All matched players |

---

## Verification

After deployment, test the function:

```bash
# Expected output with real data
{
  "success": true,
  "date": "2026-02-04",
  "playersAnalyzed": 85,
  "picksSaved": 42,
  "breakdown": {
    "points": 28,
    "threes": 14
  }
}
```


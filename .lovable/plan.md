
# Fix: Team Name to Abbreviation Conversion in Matchup Scanner

## Root Cause Identified

The Matchup Scanner is empty because of a **team name format mismatch**:

| Source | Example Value |
|--------|---------------|
| `unified_props.game_description` | "Denver Nuggets @ New York Knicks" |
| `team_zone_defense.team_abbrev` | "DEN", "NYK" |

The `parseTeamsFromDescription` function returns full team names ("Denver Nuggets"), but the database query needs abbreviations ("DEN").

## Solution

Use the existing `getTeamAbbreviation()` utility from `src/lib/team-abbreviations.ts` to convert full team names to abbreviations.

## Technical Changes

### File: `src/hooks/usePreGameMatchupScanner.ts`

**1. Add Import (line 5)**
```typescript
import { getTeamAbbreviation } from '@/lib/team-abbreviations';
```

**2. Update `parseTeamsFromDescription` function (lines 46-57)**

Current code returns full team names:
```typescript
const awayTeam = parts[0].trim();
const homeTeam = parts[1].trim();
return { teamAbbrev: awayTeam, opponentAbbrev: homeTeam };
```

Updated code converts to abbreviations:
```typescript
const awayTeamFull = parts[0].trim();
const homeTeamFull = parts[1].trim();
return { 
  teamAbbrev: getTeamAbbreviation(awayTeamFull, 'NBA'), 
  opponentAbbrev: getTeamAbbreviation(homeTeamFull, 'NBA') 
};
```

## Expected Result

After fix:
- "Denver Nuggets" converts to "DEN"
- "New York Knicks" converts to "NYK"
- Query matches `team_zone_defense` records
- **7 games and 40+ players** display in the scanner

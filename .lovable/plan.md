

# Fix Player-Team Mapping in Whale Proxy Mock Data

## Problem Identified

The mock data generator randomly combines players with matchups from the same sport without ensuring the player actually plays for one of the teams in the matchup.

**Example Issue:**
- Napheesa Collier (plays for MIN - Minnesota Lynx) is shown with matchup "CON vs IND"
- This is incorrect since she doesn't play for either team

## Solution

Create a proper player-to-team mapping structure so generated picks only show players with matchups involving their actual team.

---

## Implementation

### 1. Update Data Structure in whaleUtils.ts

Replace the separate `MOCK_PLAYERS` and `MATCHUPS` arrays with a unified structure that maps players to their teams:

```typescript
interface PlayerTeamMapping {
  name: string;
  team: string;
}

const PLAYERS_WITH_TEAMS: Record<Sport, PlayerTeamMapping[]> = {
  NBA: [
    { name: 'LeBron James', team: 'LAL' },
    { name: 'Jayson Tatum', team: 'BOS' },
    { name: 'Luka Doncic', team: 'DAL' },
    { name: 'Nikola Jokic', team: 'DEN' },
    { name: 'Stephen Curry', team: 'GSW' },
    { name: 'Kevin Durant', team: 'PHX' },
    { name: 'Giannis Antetokounmpo', team: 'MIL' },
    { name: 'Anthony Edwards', team: 'MIN' },
  ],
  WNBA: [
    { name: "A'ja Wilson", team: 'LVA' },
    { name: 'Breanna Stewart', team: 'NYL' },
    { name: 'Caitlin Clark', team: 'IND' },
    { name: 'Sabrina Ionescu', team: 'NYL' },
    { name: 'Napheesa Collier', team: 'MIN' },
  ],
  MLB: [
    { name: 'Shohei Ohtani', team: 'LAD' },
    { name: 'Aaron Judge', team: 'NYY' },
    { name: 'Mookie Betts', team: 'LAD' },
    { name: 'Ronald Acuna Jr.', team: 'ATL' },
    { name: 'Gerrit Cole', team: 'NYY' },
    { name: 'Max Scherzer', team: 'TEX' },
  ],
  NHL: [
    { name: 'Connor McDavid', team: 'EDM' },
    { name: 'Nathan MacKinnon', team: 'COL' },
    { name: 'Auston Matthews', team: 'TOR' },
    { name: 'Leon Draisaitl', team: 'EDM' },
    { name: 'Cale Makar', team: 'COL' },
  ],
  TENNIS: [
    { name: 'Novak Djokovic', team: 'DJOKOVIC' },
    { name: 'Carlos Alcaraz', team: 'ALCARAZ' },
    { name: 'Iga Swiatek', team: 'SWIATEK' },
    { name: 'Jannik Sinner', team: 'SINNER' },
    { name: 'Aryna Sabalenka', team: 'SABALENKA' },
  ]
};
```

### 2. Update Matchup Generation Logic

Modify `generateMockPick()` to:
1. First select a player (with their team)
2. Generate a matchup that includes that player's team
3. Randomly assign opponent from other teams in the league

```typescript
function generateMockPick(existingIds: Set<string>): WhalePick {
  const sport = randomChoice<Sport>(['NBA', 'WNBA', 'MLB', 'NHL', 'TENNIS']);
  
  // Pick a player with their team
  const playerData = randomChoice(PLAYERS_WITH_TEAMS[sport]);
  const player = playerData.name;
  const playerTeam = playerData.team;
  
  // Generate matchup with player's team
  const matchup = generateMatchupForTeam(sport, playerTeam);
  
  // ... rest of the function
}

function generateMatchupForTeam(sport: Sport, playerTeam: string): string {
  const allTeams = TEAMS_BY_SPORT[sport];
  const opponents = allTeams.filter(t => t !== playerTeam);
  const opponent = randomChoice(opponents);
  
  // Randomly determine home/away
  return Math.random() > 0.5 
    ? `${playerTeam} vs ${opponent}` 
    : `${opponent} vs ${playerTeam}`;
}
```

### 3. Add Team Lists Per Sport

```typescript
const TEAMS_BY_SPORT: Record<Sport, string[]> = {
  NBA: ['LAL', 'BOS', 'GSW', 'MIA', 'PHX', 'MIL', 'DEN', 'CLE', 'DAL', 'NYK', 'MIN'],
  WNBA: ['LVA', 'NYL', 'SEA', 'CHI', 'MIN', 'PHO', 'CON', 'IND'],
  MLB: ['LAD', 'NYY', 'HOU', 'ATL', 'PHI', 'SD', 'TEX', 'ARI'],
  NHL: ['EDM', 'TOR', 'COL', 'BOS', 'VGK', 'NYR', 'DAL', 'FLA'],
  TENNIS: ['DJOKOVIC', 'ALCARAZ', 'MEDVEDEV', 'SINNER', 'SWIATEK', 'SABALENKA']
};
```

### 4. Special Handling for Tennis

For tennis, matchups are player vs player, so we need special logic:

```typescript
if (sport === 'TENNIS') {
  const otherPlayers = PLAYERS_WITH_TEAMS.TENNIS.filter(p => p.name !== player);
  const opponent = randomChoice(otherPlayers);
  matchup = `${player.split(' ')[1]} vs ${opponent.name.split(' ')[1]}`;
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/whaleUtils.ts` | Replace data structures, update `generateMockPick()` function |

---

## Result

After this fix:
- Napheesa Collier will only appear with matchups like "MIN vs NYL" or "IND vs MIN"
- LeBron James will only appear with "LAL vs BOS" or "MIA vs LAL"
- Tennis players will show head-to-head matchups like "Djokovic vs Alcaraz"

The mock data will be realistic and accurate for demonstration purposes.


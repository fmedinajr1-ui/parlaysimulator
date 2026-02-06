
# Multi-Player Selection for Film Profile Upload

## Overview

Modify the Film Profile Upload component to allow selecting **multiple players** from a single video, enabling batch profile updates from the same footage (e.g., analyzing both Jalen Brunson and Cade Cunningham from a single game clip).

---

## Current Behavior

- Single player selection via search input
- One `selectedPlayer` state object
- Analysis updates one profile at a time

## New Behavior

- Multi-select with tag-style player badges
- Type to search, click to add player to selection list
- Selected players shown as removable badges
- Analysis runs once and updates ALL selected player profiles

---

## Technical Changes

### 1. FilmProfileUpload.tsx State Changes

**From:**
```typescript
const [selectedPlayer, setSelectedPlayer] = useState<PlayerSearchResult | null>(null);
```

**To:**
```typescript
const [selectedPlayers, setSelectedPlayers] = useState<PlayerSearchResult[]>([]);
```

### 2. Player Selection UI

Replace single-select with multi-select pattern:

```text
┌──────────────────────────────────────────────────────────────┐
│ 👤 Select Players                                            │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 🔍 Search player name...                                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  [Jalen Brunson ×] [Cade Cunningham ×]  ← Removable badges  │
│                                                               │
│  ┌─ Search Results (dropdown) ──────────────────────────┐   │
│  │  LeBron James            LAL • SF                    │   │
│  │  LaMelo Ball             CHA • PG                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3. Selection Logic

```typescript
const handleSelectPlayer = (player: PlayerSearchResult) => {
  // Don't add duplicates
  if (selectedPlayers.some(p => p.id === player.id)) return;
  
  setSelectedPlayers(prev => [...prev, player]);
  setPlayerSearch(''); // Clear search after adding
  setPlayerResults([]);
};

const handleRemovePlayer = (playerId: string) => {
  setSelectedPlayers(prev => prev.filter(p => p.id !== playerId));
};
```

### 4. Analysis Flow Update

When analyzing, loop through all selected players:

```typescript
const handleAnalyzeAndUpdate = async () => {
  if (selectedPlayers.length === 0 || extractedFrames.length === 0) return;

  // Step 1: Run vision analysis once (already returns all player observations)
  const { data: analysisData } = await supabase.functions.invoke('analyze-game-footage', {
    body: {
      frames: extractedFrames.slice(0, 20),
      gameContext: {
        homeTeam: selectedPlayers[0].team_name,
        awayTeam: 'Opponent',
        homeRoster: selectedPlayers.map(p => `${p.player_name} (${p.position})`).join(', '),
        awayRoster: '',
        eventId: 'profile-upload',
      },
      clipCategory: 'timeout',
    },
  });

  // Step 2: Update profile for EACH selected player
  const updatedProfiles = [];
  for (const player of selectedPlayers) {
    // Find observation for this player (fuzzy match on last name)
    const playerObs = findPlayerObservation(analysisData.observations, player.player_name);
    
    // Upsert profile
    const { data: profileData } = await supabase
      .from('player_behavior_profiles')
      .upsert({
        player_name: player.player_name,
        team: player.team_name,
        fatigue_tendency: playerObs?.fatigueIndicators?.join(', '),
        body_language_notes: playerObs?.bodyLanguage,
        film_sample_count: 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'player_name' })
      .select()
      .single();
    
    updatedProfiles.push(profileData);
  }
  
  setUpdatedProfiles(updatedProfiles); // Now an array
};
```

### 5. Success State UI Update

Show multiple profile cards on success:

```tsx
{analysisStage === 'complete' && updatedProfiles.length > 0 && (
  <div className="space-y-3">
    {updatedProfiles.map((profile, i) => (
      <div key={i} className="p-4 bg-chart-2/10 rounded-lg border border-chart-2/30">
        <div className="flex items-center gap-2 text-chart-2">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">{profile.player_name}</span>
        </div>
        {profile.fatigue_tendency && (
          <p className="text-sm text-muted-foreground mt-1">
            Fatigue: {profile.fatigue_tendency}
          </p>
        )}
      </div>
    ))}
  </div>
)}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/scout/FilmProfileUpload.tsx` | Multi-select state, tag badges, batch update logic |

---

## UI Components Used

- **Badge** with X button for removable player tags
- **Input** for search (same as current)
- **Dropdown** for search results (same as current)
- Lucide **X** icon for remove button

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Duplicate player selected | Prevent adding, silently ignore |
| Player not found in video analysis | Still update profile with empty observations (film_sample_count increments) |
| Remove all players | Disable analyze button (same as no selection) |
| Max players | Limit to 5 players per upload to avoid API overload |

---

## Implementation Summary

1. Change `selectedPlayer` (single) → `selectedPlayers` (array)
2. Add player tag badges with remove (X) button
3. Keep search input clearing after each selection
4. Run analysis once, loop through players for profile updates
5. Show multiple profile results on success
6. Add max 5 player limit with helpful message

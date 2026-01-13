import { supabase } from "@/integrations/supabase/client";

export interface PlayerInfo {
  playerName: string;
  jerseyNumber: string;
  teamName: string;
  position: string | null;
  bdlPlayerId: number | null;
}

/**
 * Look up a player by team name and jersey number
 * Used by Second Half Scout for video analysis player identification
 */
export async function getPlayerByJersey(
  teamName: string,
  jerseyNumber: string | number
): Promise<PlayerInfo | null> {
  const jerseyStr = String(jerseyNumber);
  
  const { data, error } = await supabase
    .from('bdl_player_cache')
    .select('player_name, jersey_number, team_name, position, bdl_player_id')
    .ilike('team_name', `%${teamName}%`)
    .eq('jersey_number', jerseyStr)
    .limit(1)
    .single();

  if (error || !data) {
    console.warn(`[playerJerseyLookup] No player found for ${teamName} #${jerseyNumber}`);
    return null;
  }

  return {
    playerName: data.player_name,
    jerseyNumber: data.jersey_number || jerseyStr,
    teamName: data.team_name || teamName,
    position: data.position,
    bdlPlayerId: data.bdl_player_id,
  };
}

/**
 * Get all players with jersey numbers for a specific team
 * Returns roster context for AI analysis
 */
export async function getTeamRoster(teamName: string): Promise<PlayerInfo[]> {
  const { data, error } = await supabase
    .from('bdl_player_cache')
    .select('player_name, jersey_number, team_name, position, bdl_player_id')
    .ilike('team_name', `%${teamName}%`)
    .not('jersey_number', 'is', null)
    .order('jersey_number');

  if (error || !data) {
    console.warn(`[playerJerseyLookup] No roster found for ${teamName}`);
    return [];
  }

  return data.map(player => ({
    playerName: player.player_name,
    jerseyNumber: player.jersey_number || '',
    teamName: player.team_name || teamName,
    position: player.position,
    bdlPlayerId: player.bdl_player_id,
  }));
}

/**
 * Build roster context string for AI prompts
 * Format: "Lakers roster: #23 LeBron James (F), #3 Anthony Davis (F-C)..."
 */
export async function buildRosterContext(teamNames: string[]): Promise<string> {
  const contexts: string[] = [];

  for (const teamName of teamNames) {
    const roster = await getTeamRoster(teamName);
    
    if (roster.length > 0) {
      const playerList = roster
        .map(p => `#${p.jerseyNumber} ${p.playerName}${p.position ? ` (${p.position})` : ''}`)
        .join(', ');
      
      contexts.push(`${teamName} roster: ${playerList}`);
    }
  }

  return contexts.join('\n');
}

/**
 * Batch lookup multiple players by jersey numbers
 * Returns a map of "teamName-jerseyNumber" -> PlayerInfo
 */
export async function batchGetPlayersByJersey(
  lookups: Array<{ teamName: string; jerseyNumber: string | number }>
): Promise<Map<string, PlayerInfo>> {
  const results = new Map<string, PlayerInfo>();
  
  // Group by team for efficiency
  const teamGroups = new Map<string, Set<string>>();
  for (const { teamName, jerseyNumber } of lookups) {
    const jerseyStr = String(jerseyNumber);
    if (!teamGroups.has(teamName)) {
      teamGroups.set(teamName, new Set());
    }
    teamGroups.get(teamName)!.add(jerseyStr);
  }

  // Fetch each team's players
  for (const [teamName, jerseyNumbers] of teamGroups) {
    const { data, error } = await supabase
      .from('bdl_player_cache')
      .select('player_name, jersey_number, team_name, position, bdl_player_id')
      .ilike('team_name', `%${teamName}%`)
      .in('jersey_number', Array.from(jerseyNumbers));

    if (!error && data) {
      for (const player of data) {
        const key = `${teamName}-${player.jersey_number}`;
        results.set(key, {
          playerName: player.player_name,
          jerseyNumber: player.jersey_number || '',
          teamName: player.team_name || teamName,
          position: player.position,
          bdlPlayerId: player.bdl_player_id,
        });
      }
    }
  }

  return results;
}

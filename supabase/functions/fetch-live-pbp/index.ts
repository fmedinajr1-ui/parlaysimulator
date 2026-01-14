import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_NBA_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

interface LivePBPRequest {
  eventId: string;
}

interface PlayerStats {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  plusMinus: number;
  fgm: number;
  fga: number;
  threePm: number;
  threePa: number;
  ftm: number;
  fta: number;
}

interface RecentPlay {
  time: string;
  text: string;
  playerId?: string;
  playerName?: string;
  team?: string;
  playType: 'score' | 'rebound' | 'assist' | 'turnover' | 'foul' | 'substitution' | 'timeout' | 'other';
}

function parseMinutes(minStr: string): number {
  if (!minStr) return 0;
  const parts = minStr.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  }
  return parseInt(minStr) || 0;
}

function parsePlayType(text: string): RecentPlay['playType'] {
  const lower = text.toLowerCase();
  if (lower.includes('makes') || lower.includes('scores') || lower.includes('layup') || lower.includes('dunk') || lower.includes('three pointer')) {
    return 'score';
  }
  if (lower.includes('rebound')) return 'rebound';
  if (lower.includes('assist')) return 'assist';
  if (lower.includes('turnover') || lower.includes('steal')) return 'turnover';
  if (lower.includes('foul')) return 'foul';
  if (lower.includes('substitution') || lower.includes('enters') || lower.includes('leaves')) return 'substitution';
  if (lower.includes('timeout')) return 'timeout';
  return 'other';
}

function formatGameTime(period: number, clock: string): string {
  const quarter = period <= 4 ? `Q${period}` : `OT${period - 4}`;
  return `${quarter} ${clock}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { eventId } = await req.json() as LivePBPRequest;

    if (!eventId) {
      return new Response(
        JSON.stringify({ error: 'eventId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[PBP Fetch] Fetching data for event: ${eventId}`);

    // Fetch from ESPN Summary API
    const response = await fetch(`${ESPN_NBA_SUMMARY}?event=${eventId}`);
    
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Parse game status
    const header = data.header?.competitions?.[0];
    const status = header?.status;
    const period = status?.period || 1;
    const clock = status?.displayClock || '12:00';
    const isHalftime = status?.type?.description === 'Halftime';
    const isGameOver = status?.type?.completed === true;
    
    // Parse scores
    const competitors = header?.competitors || [];
    const homeTeamData = competitors.find((c: any) => c.homeAway === 'home');
    const awayTeamData = competitors.find((c: any) => c.homeAway === 'away');
    
    const homeScore = parseInt(homeTeamData?.score) || 0;
    const awayScore = parseInt(awayTeamData?.score) || 0;
    const homeTeam = homeTeamData?.team?.abbreviation || 'HOME';
    const awayTeam = awayTeamData?.team?.abbreviation || 'AWAY';

    // Calculate pace (rough estimate based on current stats)
    const boxscore = data.boxscore;
    let pace = 100; // Default NBA pace
    
    if (boxscore?.teams) {
      // Estimate possessions from FGA, TO, FTA
      // This is a simplified version
      const homeStats = boxscore.teams.find((t: any) => t.team?.abbreviation === homeTeam)?.statistics;
      if (homeStats) {
        const fga = parseInt(homeStats.find((s: any) => s.name === 'fieldGoalsAttempted')?.displayValue) || 0;
        const to = parseInt(homeStats.find((s: any) => s.name === 'turnovers')?.displayValue) || 0;
        const fta = parseInt(homeStats.find((s: any) => s.name === 'freeThrowsAttempted')?.displayValue) || 0;
        const estimatedPossessions = fga + to + 0.44 * fta;
        const minutesPlayed = period * 12; // Rough estimate
        if (minutesPlayed > 0) {
          pace = Math.round((estimatedPossessions / minutesPlayed) * 48);
        }
      }
    }

    // Parse player stats from boxscore
    const players: PlayerStats[] = [];
    
    if (boxscore?.players) {
      for (const teamPlayers of boxscore.players) {
        const teamAbbr = teamPlayers.team?.abbreviation || '';
        
        for (const statCategory of (teamPlayers.statistics || [])) {
          const labels = statCategory.labels || [];
          
          for (const athlete of (statCategory.athletes || [])) {
            const stats: Record<string, any> = {};
            
            (athlete.stats || []).forEach((value: string, idx: number) => {
              const label = labels[idx];
              if (label) {
                stats[label.toLowerCase()] = value;
              }
            });
            
            players.push({
              playerId: athlete.athlete?.id || '',
              playerName: athlete.athlete?.displayName || '',
              team: teamAbbr,
              position: athlete.athlete?.position?.abbreviation || '',
              minutes: parseMinutes(stats.min || '0'),
              points: parseInt(stats.pts) || 0,
              rebounds: parseInt(stats.reb) || 0,
              assists: parseInt(stats.ast) || 0,
              steals: parseInt(stats.stl) || 0,
              blocks: parseInt(stats.blk) || 0,
              fouls: parseInt(stats.pf) || 0,
              plusMinus: parseInt(stats['+/-']) || 0,
              fgm: parseInt(stats.fgm || stats.fg?.split('-')?.[0]) || 0,
              fga: parseInt(stats.fga || stats.fg?.split('-')?.[1]) || 0,
              threePm: parseInt(stats['3pm'] || stats['3pt']?.split('-')?.[0]) || 0,
              threePa: parseInt(stats['3pa'] || stats['3pt']?.split('-')?.[1]) || 0,
              ftm: parseInt(stats.ftm || stats.ft?.split('-')?.[0]) || 0,
              fta: parseInt(stats.fta || stats.ft?.split('-')?.[1]) || 0,
            });
          }
        }
      }
    }

    // Parse recent plays
    const recentPlays: RecentPlay[] = [];
    const plays = data.plays || [];
    
    // Get last 15 plays
    const lastPlays = plays.slice(-15).reverse();
    
    for (const play of lastPlays) {
      const playText = play.text || play.shortText || '';
      const playPeriod = play.period?.number || period;
      const playClock = play.clock?.displayValue || '';
      
      recentPlays.push({
        time: formatGameTime(playPeriod, playClock),
        text: playText,
        playerId: play.participants?.[0]?.athlete?.id,
        playerName: play.participants?.[0]?.athlete?.displayName,
        team: play.team?.abbreviation,
        playType: parsePlayType(playText),
      });
    }

    const result = {
      gameTime: formatGameTime(period, clock),
      period,
      clock,
      homeScore,
      awayScore,
      homeTeam,
      awayTeam,
      pace,
      players,
      recentPlays,
      isHalftime,
      isGameOver,
    };

    console.log(`[PBP Fetch] Found ${players.length} players, ${recentPlays.length} recent plays`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[PBP Fetch] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

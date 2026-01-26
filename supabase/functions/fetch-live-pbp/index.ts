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
  playType: 'dunk' | 'alley_oop' | 'and_one' | 'three_pointer' | 'score' | 'block' | 'steal' | 'def_rebound' | 'off_rebound' | 'rebound' | 'assist' | 'turnover' | 'missed_ft' | 'foul' | 'substitution' | 'timeout' | 'other';
  pointValue?: number;           // 0, 1, 2, or 3 points scored
  isHighMomentum?: boolean;      // Dunks, blocks, steals, and-1s
}

function parseMinutes(minStr: string): number {
  if (!minStr) return 0;
  const parts = minStr.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  }
  return parseInt(minStr) || 0;
}

function parsePlayType(text: string): { playType: RecentPlay['playType']; pointValue: number; isHighMomentum: boolean } {
  const lower = text.toLowerCase();
  
  // High momentum scoring plays (most impactful)
  if (lower.includes('and one') || lower.includes('and-1') || lower.includes('and 1')) {
    return { playType: 'and_one', pointValue: lower.includes('three') ? 4 : 3, isHighMomentum: true };
  }
  if (lower.includes('alley oop') || lower.includes('alley-oop')) {
    return { playType: 'alley_oop', pointValue: 2, isHighMomentum: true };
  }
  if (lower.includes('dunk') || lower.includes('slam')) {
    return { playType: 'dunk', pointValue: 2, isHighMomentum: true };
  }
  
  // Three pointers
  if (lower.includes('three pointer') || lower.includes('3pt') || lower.includes('three point')) {
    if (lower.includes('makes') || lower.includes('made')) {
      return { playType: 'three_pointer', pointValue: 3, isHighMomentum: false };
    }
  }
  
  // Regular scoring
  if (lower.includes('makes') || lower.includes('scores') || lower.includes('layup') || lower.includes('jumper') || lower.includes('hook')) {
    const pts = lower.includes('free throw') ? 1 : 2;
    return { playType: 'score', pointValue: pts, isHighMomentum: false };
  }
  
  // Defensive momentum plays
  if (lower.includes('blocked') || lower.includes('block')) {
    return { playType: 'block', pointValue: 0, isHighMomentum: true };
  }
  if (lower.includes('steal')) {
    return { playType: 'steal', pointValue: 0, isHighMomentum: true };
  }
  
  // Rebounds
  if (lower.includes('offensive rebound')) {
    return { playType: 'off_rebound', pointValue: 0, isHighMomentum: false };
  }
  if (lower.includes('defensive rebound')) {
    return { playType: 'def_rebound', pointValue: 0, isHighMomentum: false };
  }
  if (lower.includes('rebound')) {
    return { playType: 'rebound', pointValue: 0, isHighMomentum: false };
  }
  
  // Negative plays
  if (lower.includes('turnover')) {
    return { playType: 'turnover', pointValue: 0, isHighMomentum: false };
  }
  if (lower.includes('missed') && lower.includes('free throw')) {
    return { playType: 'missed_ft', pointValue: 0, isHighMomentum: false };
  }
  
  // Other plays
  if (lower.includes('assist')) return { playType: 'assist', pointValue: 0, isHighMomentum: false };
  if (lower.includes('foul')) return { playType: 'foul', pointValue: 0, isHighMomentum: false };
  if (lower.includes('substitution') || lower.includes('enters') || lower.includes('leaves')) {
    return { playType: 'substitution', pointValue: 0, isHighMomentum: false };
  }
  if (lower.includes('timeout')) return { playType: 'timeout', pointValue: 0, isHighMomentum: false };
  
  return { playType: 'other', pointValue: 0, isHighMomentum: false };
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

    // Extract numeric ESPN ID from various formats
    // Supports: "401234567", "bdl_nba_18447386", "espn_401234567", etc.
    let espnEventId = eventId;
    
    // If it has a prefix like "bdl_nba_" or "espn_", try to extract or skip
    if (eventId.includes('_')) {
      const parts = eventId.split('_');
      const lastPart = parts[parts.length - 1];
      // Only use if it's a valid ESPN-length ID (typically 9 digits starting with 40)
      if (/^\d{9}$/.test(lastPart) && lastPart.startsWith('40')) {
        espnEventId = lastPart;
      } else {
        // This is likely a BallDontLie ID or other non-ESPN format
        console.log(`[PBP Fetch] Non-ESPN event ID format: ${eventId}, returning empty data`);
        return new Response(
          JSON.stringify({
            gameTime: 'Unknown',
            period: 1,
            clock: '12:00',
            homeScore: 0,
            awayScore: 0,
            homeTeam: 'HOME',
            awayTeam: 'AWAY',
            pace: 100,
            players: [],
            recentPlays: [],
            isHalftime: false,
            isGameOver: false,
            notAvailable: true,
            reason: 'ESPN data not available for this event ID format',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`[PBP Fetch] Fetching data for ESPN event: ${espnEventId}`);

    // Fetch from ESPN Summary API with retry logic for transient errors
    const maxRetries = 3;
    let lastError: Error | null = null;
    let response: Response | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(`${ESPN_NBA_SUMMARY}?event=${espnEventId}`);
        if (response.ok) break;
        
        // Non-retryable HTTP errors
        if (response.status >= 400 && response.status < 500) {
          console.error(`[PBP Fetch] ESPN API error: ${response.status}`);
          return new Response(
            JSON.stringify({
              gameTime: 'Unknown',
              period: 1,
              clock: '12:00',
              homeScore: 0,
              awayScore: 0,
              homeTeam: 'HOME',
              awayTeam: 'AWAY',
              pace: 100,
              players: [],
              recentPlays: [],
              isHalftime: false,
              isGameOver: false,
              notAvailable: true,
              reason: `ESPN API returned ${response.status}`,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Server errors - retry
        lastError = new Error(`HTTP ${response.status}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.log(`[PBP Fetch] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      }
      
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * attempt)); // Exponential backoff
      }
    }
    
    if (!response || !response.ok) {
      console.error(`[PBP Fetch] All retries failed: ${lastError?.message}`);
      return new Response(
        JSON.stringify({
          gameTime: 'Unknown',
          period: 1,
          clock: '12:00',
          homeScore: 0,
          awayScore: 0,
          homeTeam: 'HOME',
          awayTeam: 'AWAY',
          pace: 100,
          players: [],
          recentPlays: [],
          isHalftime: false,
          isGameOver: false,
          notAvailable: true,
          reason: `ESPN API unavailable after ${maxRetries} attempts`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    
    // Parse game status
    const header = data.header?.competitions?.[0];
    const status = header?.status;
    const period = status?.period || 1;
    const clock = status?.displayClock || '12:00';
    const isHalftime = status?.type?.description === 'Halftime';
    
    // Parse clock to detect period transitions
    const clockParts = clock.split(':');
    const clockMinutes = parseInt(clockParts[0]) || 0;
    const clockSeconds = parseInt(clockParts[1]) || 0;
    const totalClockSeconds = clockMinutes * 60 + clockSeconds;
    
    // Detect quarter endings (clock <= 30 seconds remaining)
    const isQ1Ending = period === 1 && totalClockSeconds <= 30;
    const isQ2Ending = period === 2 && totalClockSeconds <= 30;
    const isQ3Ending = period === 3 && totalClockSeconds <= 30;
    const isQ4Ending = period === 4 && totalClockSeconds <= 30;
    
    // Detect quarter starts (first 30 seconds of quarter = clock >= 11:30)
    const isQ3Starting = period === 3 && totalClockSeconds >= 690; // 11:30 or more remaining
    const isQ4Starting = period === 4 && totalClockSeconds >= 690;
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
      const { playType, pointValue, isHighMomentum } = parsePlayType(playText);
      
      recentPlays.push({
        time: formatGameTime(playPeriod, playClock),
        text: playText,
        playerId: play.participants?.[0]?.athlete?.id,
        playerName: play.participants?.[0]?.athlete?.displayName,
        team: play.team?.abbreviation,
        playType,
        pointValue,
        isHighMomentum,
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
      // Period transition flags for quarter snapshots
      isQ1Ending,
      isQ2Ending,
      isQ3Ending,
      isQ4Ending,
      // Period start flags for auto-suggest
      isQ3Starting,
      isQ4Starting,
    };

    // Validation logging: check box score totals match scoreboard
    const homePlayerPts = players.filter(p => p.team === homeTeam).reduce((sum, p) => sum + p.points, 0);
    const awayPlayerPts = players.filter(p => p.team === awayTeam).reduce((sum, p) => sum + p.points, 0);
    console.log(`[PBP Fetch] Box score totals: ${homeTeam}=${homePlayerPts} (score: ${homeScore}), ${awayTeam}=${awayPlayerPts} (score: ${awayScore})`);
    
    // Log top scorers for debugging
    const topScorers = players.filter(p => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
    console.log(`[PBP Fetch] Top scorers: ${topScorers.map(p => `${p.playerName}: ${p.points}pts`).join(', ')}`);
    
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

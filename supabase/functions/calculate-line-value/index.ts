import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LineEdge {
  id: string;
  description: string;
  sport: string;
  bookLine: number;
  medianLine: number;
  edgeAmount: number;
  edgeType: 'over' | 'under' | 'ml';
  confidence: number;
  historicalHitRate: number;
  recommendation: string;
  homeTeam: string;
  awayTeam: string;
  homeAvg: number;
  awayAvg: number;
  homeLast5: number[];
  awayLast5: number[];
  homeStreak: { type: 'over' | 'under'; count: number } | null;
  awayStreak: { type: 'over' | 'under'; count: number } | null;
  gameTime: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: { sport?: string } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      console.log('[calculate-line-value] No body, using defaults');
    }

    const sport = body.sport || 'NBA';
    console.log(`[calculate-line-value] Calculating edges for ${sport}...`);

    // Fetch last 10 games for each team from player game logs
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .order('game_date', { ascending: false })
      .limit(2000);

    if (logsError) {
      console.error('Error fetching game logs:', logsError);
      throw logsError;
    }

    console.log(`[calculate-line-value] Fetched ${gameLogs?.length || 0} game logs`);

    // Aggregate team totals from player stats by game date
    const teamGameTotals: Record<string, { date: string; points: number }[]> = {};
    
    gameLogs?.forEach(log => {
      const team = log.opponent;
      const gameDate = log.game_date;
      
      if (!teamGameTotals[team]) teamGameTotals[team] = [];
      
      // Find or create game entry for this team on this date
      let gameEntry = teamGameTotals[team].find(g => g.date === gameDate);
      if (!gameEntry) {
        gameEntry = { date: gameDate, points: 0 };
        teamGameTotals[team].push(gameEntry);
      }
      gameEntry.points += log.points || 0;
    });

    // Calculate stats for each team
    const teamStats: Record<string, { 
      avgPoints: number; 
      medianPoints: number; 
      overHitRate: number;
      last5: number[];
      streak: { type: 'over' | 'under'; count: number } | null;
    }> = {};

    Object.entries(teamGameTotals).forEach(([team, games]) => {
      if (games.length < 5) return;
      
      // Sort by date descending and take last 5-10 games
      const sortedGames = games.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const last5 = sortedGames.slice(0, 5).map(g => g.points);
      
      // Calculate stats
      const avgPoints = last5.reduce((a, b) => a + b, 0) / last5.length;
      const sorted = [...last5].sort((a, b) => a - b);
      const medianPoints = sorted[Math.floor(sorted.length / 2)];
      
      // Calculate over/under hit rate (vs league average ~112 per team)
      const overHits = last5.filter(p => p > 112).length;
      const overHitRate = (overHits / 5) * 100;
      
      // Calculate streak
      let streakCount = 1;
      let streakType: 'over' | 'under' = last5[0] > 112 ? 'over' : 'under';
      for (let i = 1; i < last5.length; i++) {
        const currentType = last5[i] > 112 ? 'over' : 'under';
        if (currentType === streakType) {
          streakCount++;
        } else {
          break;
        }
      }
      
      teamStats[team] = { 
        avgPoints, 
        medianPoints, 
        overHitRate, 
        last5,
        streak: streakCount >= 3 ? { type: streakType, count: streakCount } : null
      };
    });

    console.log(`[calculate-line-value] Calculated stats for ${Object.keys(teamStats).length} teams`);

    // Fetch current odds snapshots - query multiple sport formats
    const { data: oddsSnapshots, error: oddsError } = await supabase
      .from('odds_snapshots')
      .select('*')
      .in('sport', ['basketball_nba', 'NBA', sport.toLowerCase()])
      .eq('market_type', 'totals')
      .gte('commence_time', new Date().toISOString())
      .order('commence_time', { ascending: true })
      .limit(50);

    if (oddsError) {
      console.error('Error fetching odds:', oddsError);
    }

    console.log(`[calculate-line-value] Fetched ${oddsSnapshots?.length || 0} odds snapshots`);

    // Helper function to find team stats with fuzzy matching
    const findTeamStats = (teamName: string) => {
      if (!teamName) return null;
      
      const normalizedSearch = teamName.toLowerCase().trim();
      
      // Try exact match first
      for (const [team, stats] of Object.entries(teamStats)) {
        if (team.toLowerCase() === normalizedSearch) return { team, stats };
      }
      
      // Try partial match
      for (const [team, stats] of Object.entries(teamStats)) {
        const normalizedTeam = team.toLowerCase();
        if (normalizedTeam.includes(normalizedSearch) || normalizedSearch.includes(normalizedTeam)) {
          return { team, stats };
        }
        // Match on city or nickname
        const parts = normalizedSearch.split(' ');
        if (parts.some(part => normalizedTeam.includes(part) && part.length > 3)) {
          return { team, stats };
        }
      }
      
      return null;
    };

    // Calculate edges
    const edges: LineEdge[] = [];

    oddsSnapshots?.forEach(odds => {
      const homeMatch = findTeamStats(odds.home_team || '');
      const awayMatch = findTeamStats(odds.away_team || '');

      if (!homeMatch || !awayMatch) {
        console.log(`[calculate-line-value] No stats found for ${odds.home_team} vs ${odds.away_team}`);
        return;
      }

      const { stats: homeStats } = homeMatch;
      const { stats: awayStats } = awayMatch;

      // Calculate combined expected total
      const expectedTotal = homeStats.avgPoints + awayStats.avgPoints;
      const medianTotal = homeStats.medianPoints + awayStats.medianPoints;
      const bookLine = odds.point || 220;
      
      // Calculate edge
      const edgeAmount = Math.abs(medianTotal - bookLine);
      
      if (edgeAmount >= 3) {
        const edgeType = medianTotal > bookLine ? 'over' : 'under';
        const combinedHitRate = edgeType === 'over' 
          ? (homeStats.overHitRate + awayStats.overHitRate) / 2
          : (100 - homeStats.overHitRate + 100 - awayStats.overHitRate) / 2;
        
        // Format game time
        const gameTime = odds.commence_time 
          ? new Date(odds.commence_time).toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true,
              timeZone: 'America/New_York'
            })
          : '';
        
        edges.push({
          id: odds.id,
          description: `${odds.away_team} @ ${odds.home_team}`,
          sport,
          bookLine,
          medianLine: Math.round(medianTotal),
          edgeAmount: Math.round(edgeAmount * 10) / 10,
          edgeType,
          confidence: Math.min(edgeAmount / 10, 1),
          historicalHitRate: combinedHitRate,
          recommendation: combinedHitRate >= 60 ? 'STRONG' : combinedHitRate >= 50 ? 'LEAN' : 'CAUTION',
          homeTeam: odds.home_team,
          awayTeam: odds.away_team,
          homeAvg: homeStats.avgPoints,
          awayAvg: awayStats.avgPoints,
          homeLast5: homeStats.last5,
          awayLast5: awayStats.last5,
          homeStreak: homeStats.streak,
          awayStreak: awayStats.streak,
          gameTime,
        });
      }
    });

    // If no odds snapshots, still provide team stats for display
    if (!oddsSnapshots || oddsSnapshots.length === 0) {
      console.log('[calculate-line-value] No odds found, returning team stats only');
    }

    // Fetch historical accuracy for different edge sizes
    const { data: historicalEdges } = await supabase
      .from('line_movements')
      .select('sport, recommendation, outcome_correct, new_price, point_change')
      .eq('outcome_verified', true)
      .in('sport', ['basketball_nba', 'NBA'])
      .not('recommendation', 'is', null)
      .limit(500);

    // Calculate EV by edge size
    const evByEdgeSize: Record<string, { hits: number; total: number }> = {
      'small': { hits: 0, total: 0 },    // 3-5 pts
      'medium': { hits: 0, total: 0 },   // 5-8 pts
      'large': { hits: 0, total: 0 },    // 8+ pts
    };

    historicalEdges?.forEach(h => {
      const edge = Math.abs(h.point_change || 0);
      const bucket = edge >= 8 ? 'large' : edge >= 5 ? 'medium' : 'small';
      evByEdgeSize[bucket].total++;
      if (h.outcome_correct) evByEdgeSize[bucket].hits++;
    });

    // Sort edges by edge amount (bigger = better)
    edges.sort((a, b) => b.edgeAmount - a.edgeAmount);

    console.log(`[calculate-line-value] Found ${edges.length} line value edges`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        edges: edges.slice(0, 10),
        teamStats: Object.keys(teamStats).length,
        evByEdgeSize: Object.fromEntries(
          Object.entries(evByEdgeSize).map(([k, v]) => [
            k, 
            { ...v, hitRate: v.total > 0 ? Math.round((v.hits / v.total) * 100) : 0 }
          ])
        ),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error calculating line values:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error), edges: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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
    console.log(`Calculating line values for ${sport}...`);

    // Fetch last 5 games for each team from player game logs
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .order('game_date', { ascending: false })
      .limit(1000);

    if (logsError) {
      console.error('Error fetching game logs:', logsError);
      throw logsError;
    }

    // Aggregate team totals from player stats
    const teamGames: Record<string, { date: string; points: number }[]> = {};
    
    gameLogs?.forEach(log => {
      // Group by date and opponent to reconstruct game totals
      const key = `${log.opponent}_${log.game_date}`;
      if (!teamGames[log.opponent]) teamGames[log.opponent] = [];
      
      // Add player points to team total
      const existingGame = teamGames[log.opponent].find(g => g.date === log.game_date);
      if (existingGame) {
        existingGame.points += log.points || 0;
      } else {
        teamGames[log.opponent].push({
          date: log.game_date,
          points: log.points || 0,
        });
      }
    });

    // Calculate median and average for each team
    const teamStats: Record<string, { 
      avgPoints: number; 
      medianPoints: number; 
      overHitRate: number;
      last5: number[];
    }> = {};

    Object.entries(teamGames).forEach(([team, games]) => {
      if (games.length < 5) return;
      
      // Sort by date descending and take last 5
      const sortedGames = games.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const last5 = sortedGames.slice(0, 5).map(g => g.points);
      
      // Calculate stats
      const avgPoints = last5.reduce((a, b) => a + b, 0) / last5.length;
      const sorted = [...last5].sort((a, b) => a - b);
      const medianPoints = sorted[Math.floor(sorted.length / 2)];
      
      // Calculate over hit rate (vs league average ~112)
      const overHits = last5.filter(p => p > 112).length;
      const overHitRate = (overHits / 5) * 100;
      
      teamStats[team] = { avgPoints, medianPoints, overHitRate, last5 };
    });

    // Fetch current odds snapshots
    const { data: oddsSnapshots, error: oddsError } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('sport', sport === 'NBA' ? 'basketball_nba' : sport.toLowerCase())
      .eq('market_type', 'totals')
      .order('snapshot_time', { ascending: false })
      .limit(50);

    if (oddsError) {
      console.error('Error fetching odds:', oddsError);
    }

    // Calculate edges
    const edges: LineEdge[] = [];

    oddsSnapshots?.forEach(odds => {
      const homeTeamLower = odds.home_team?.toLowerCase() || '';
      const awayTeamLower = odds.away_team?.toLowerCase() || '';
      
      // Find team stats
      const homeStats = Object.entries(teamStats).find(([team]) => 
        homeTeamLower.includes(team.toLowerCase()) || team.toLowerCase().includes(homeTeamLower)
      )?.[1];
      
      const awayStats = Object.entries(teamStats).find(([team]) => 
        awayTeamLower.includes(team.toLowerCase()) || team.toLowerCase().includes(awayTeamLower)
      )?.[1];

      if (!homeStats || !awayStats) return;

      // Calculate combined expected total
      const expectedTotal = homeStats.avgPoints + awayStats.avgPoints;
      const medianTotal = homeStats.medianPoints + awayStats.medianPoints;
      const bookLine = odds.point || 220; // Default NBA total
      
      // Calculate edge
      const edgeAmount = Math.abs(medianTotal - bookLine);
      
      if (edgeAmount >= 3) { // Only significant edges
        const edgeType = medianTotal > bookLine ? 'over' : 'under';
        const combinedHitRate = edgeType === 'over' 
          ? (homeStats.overHitRate + awayStats.overHitRate) / 2
          : (100 - homeStats.overHitRate + 100 - awayStats.overHitRate) / 2;
        
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
        });
      }
    });

    // Fetch moneyline value from verified outcomes
    const { data: mlOutcomes, error: mlError } = await supabase
      .from('line_movements')
      .select('sport, recommendation, outcome_correct, new_price')
      .eq('outcome_verified', true)
      .eq('sport', sport === 'NBA' ? 'basketball_nba' : sport.toLowerCase())
      .not('recommendation', 'is', null);

    if (mlError) {
      console.error('Error fetching ML outcomes:', mlError);
    }

    // Calculate EV for different odds ranges
    const evByRange: Record<string, { wins: number; losses: number; avgOdds: number }> = {};
    
    mlOutcomes?.forEach(outcome => {
      const odds = outcome.new_price || -110;
      const range = odds >= 150 ? 'underdog' : odds <= -150 ? 'favorite' : 'even';
      
      if (!evByRange[range]) evByRange[range] = { wins: 0, losses: 0, avgOdds: 0 };
      
      if (outcome.outcome_correct) {
        evByRange[range].wins++;
      } else {
        evByRange[range].losses++;
      }
      evByRange[range].avgOdds = (evByRange[range].avgOdds + odds) / 2;
    });

    // Sort edges by confidence
    edges.sort((a, b) => b.confidence - a.confidence);

    console.log(`Found ${edges.length} line value edges`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        edges: edges.slice(0, 10),
        teamStats: Object.keys(teamStats).length,
        evAnalysis: evByRange,
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

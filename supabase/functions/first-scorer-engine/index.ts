import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FirstScorerAnalysis {
  game_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  game_time: string;
  prop_type: string;
  selection: string;
  odds: number;
  implied_probability: number;
  ai_probability: number;
  edge: number;
  confidence_score: number;
  recommendation: string;
  analysis_factors: Record<string, any>;
}

// Convert American odds to implied probability
function oddsToProb(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { sport = 'NBA', gameId, selections } = await req.json().catch(() => ({}));
    
    console.log(`[First Scorer Engine] Analyzing ${sport} first scorer props...`);
    
    const analyses: FirstScorerAnalysis[] = [];
    const errors: string[] = [];

    // === TEAM FIRST TO SCORE ANALYSIS ===
    if (!selections || selections.length === 0) {
      // Get team pace data to estimate who scores first
      let paceData: any[] = [];
      
      if (sport === 'NBA') {
        const { data: nbaTeams } = await supabase
          .from('nba_team_pace_projections')
          .select('*')
          .order('pace_rating', { ascending: false });
        paceData = nbaTeams || [];
      } else if (sport === 'NHL') {
        const { data: nhlTeams } = await supabase
          .from('nhl_team_pace_stats')
          .select('*')
          .order('shots_for_per_game', { ascending: false });
        paceData = nhlTeams || [];
      }
      
      // Get upcoming games from fatigue or unified props
      const { data: upcomingGames } = await supabase
        .from('nba_fatigue_scores')
        .select('event_id, home_team, away_team, game_time')
        .gte('game_time', new Date().toISOString())
        .order('game_time')
        .limit(10);
      
      for (const game of upcomingGames || []) {
        const homeTeamPace = paceData.find(t => 
          t.team_name?.toLowerCase().includes(game.home_team?.toLowerCase()) ||
          game.home_team?.toLowerCase().includes(t.team_name?.toLowerCase())
        );
        const awayTeamPace = paceData.find(t => 
          t.team_name?.toLowerCase().includes(game.away_team?.toLowerCase()) ||
          game.away_team?.toLowerCase().includes(t.team_name?.toLowerCase())
        );
        
        // Simple model: faster pace team has slight edge, home team has slight edge
        const homePaceFactor = homeTeamPace?.pace_rating || homeTeamPace?.shots_for_per_game || 100;
        const awayPaceFactor = awayTeamPace?.pace_rating || awayTeamPace?.shots_for_per_game || 100;
        
        // Home court advantage ~2-3% for first score
        const homeAdvantage = 0.52;
        const paceRatio = homePaceFactor / (homePaceFactor + awayPaceFactor);
        
        const homeFirstProb = (homeAdvantage * 0.6) + (paceRatio * 0.4);
        const awayFirstProb = 1 - homeFirstProb;
        
        // Create analysis for home team first
        analyses.push({
          game_id: game.event_id,
          sport,
          home_team: game.home_team,
          away_team: game.away_team,
          game_time: game.game_time,
          prop_type: 'team_first_score',
          selection: game.home_team,
          odds: -110, // Default line
          implied_probability: 0.5238,
          ai_probability: homeFirstProb,
          edge: (homeFirstProb - 0.5238) * 100,
          confidence_score: 55 + Math.abs(homeFirstProb - 0.5) * 50,
          recommendation: homeFirstProb > 0.54 ? 'PICK' : homeFirstProb < 0.48 ? 'FADE' : 'PASS',
          analysis_factors: {
            home_pace: homePaceFactor,
            away_pace: awayPaceFactor,
            home_advantage_factor: homeAdvantage,
            pace_ratio: paceRatio,
          },
        });
        
        // Create analysis for away team first
        analyses.push({
          game_id: game.event_id,
          sport,
          home_team: game.home_team,
          away_team: game.away_team,
          game_time: game.game_time,
          prop_type: 'team_first_score',
          selection: game.away_team,
          odds: -110,
          implied_probability: 0.5238,
          ai_probability: awayFirstProb,
          edge: (awayFirstProb - 0.5238) * 100,
          confidence_score: 55 + Math.abs(awayFirstProb - 0.5) * 50,
          recommendation: awayFirstProb > 0.54 ? 'PICK' : awayFirstProb < 0.48 ? 'FADE' : 'PASS',
          analysis_factors: {
            home_pace: homePaceFactor,
            away_pace: awayPaceFactor,
            away_advantage_factor: 1 - homeAdvantage,
            pace_ratio: 1 - paceRatio,
          },
        });
      }
    }
    
    // === PLAYER FIRST SCORER ANALYSIS ===
    if (selections && selections.length > 0) {
      for (const sel of selections) {
        const { playerName, gameId: selGameId, odds: selOdds } = sel;
        
        // Get player's recent scoring data
        let playerLogs: any[] = [];
        
        if (sport === 'NBA') {
          const { data: logs } = await supabase
            .from('nba_player_game_logs')
            .select('*')
            .eq('player_name', playerName)
            .order('game_date', { ascending: false })
            .limit(20);
          playerLogs = logs || [];
        } else if (sport === 'NHL') {
          const { data: logs } = await supabase
            .from('nhl_player_game_logs')
            .select('*')
            .eq('player_name', playerName)
            .order('game_date', { ascending: false })
            .limit(20);
          playerLogs = logs || [];
        }
        
        if (playerLogs.length < 5) {
          errors.push(`Insufficient data for ${playerName}`);
          continue;
        }
        
        // Calculate first scorer probability factors
        const avgPoints = playerLogs.reduce((sum, log) => sum + (log.points || 0), 0) / playerLogs.length;
        const avgMinutes = playerLogs.reduce((sum, log) => sum + (log.minutes_played || 0), 0) / playerLogs.length;
        
        // Higher usage = more likely to score first
        // Guards typically score first more than bigs
        // Higher minutes = more opportunities
        
        // Base probability for any player scoring first is ~1/10 = 10%
        const baseProb = 0.10;
        
        // Adjust based on scoring rate (points per game relative to team average ~110)
        const scoringFactor = avgPoints / 22; // 22 ppg = elite scorer
        
        // Adjust based on minutes (more minutes = more opportunity)
        const minutesFactor = avgMinutes / 35; // 35 min = heavy minutes
        
        // Combined probability
        const aiProb = Math.min(0.25, baseProb * scoringFactor * minutesFactor);
        
        const impliedProb = selOdds ? oddsToProb(selOdds) : 0.10;
        const edge = (aiProb - impliedProb) * 100;
        
        analyses.push({
          game_id: selGameId || 'unknown',
          sport,
          home_team: '',
          away_team: '',
          game_time: new Date().toISOString(),
          prop_type: 'player_first_scorer',
          selection: playerName,
          odds: selOdds || 1000,
          implied_probability: impliedProb,
          ai_probability: aiProb,
          edge,
          confidence_score: 50 + Math.min(25, playerLogs.length * 2),
          recommendation: edge > 2 ? 'PICK' : edge < -2 ? 'FADE' : 'PASS',
          analysis_factors: {
            avg_points: avgPoints,
            avg_minutes: avgMinutes,
            scoring_factor: scoringFactor,
            minutes_factor: minutesFactor,
            games_analyzed: playerLogs.length,
          },
        });
      }
    }
    
    // Store analyses in database
    if (analyses.length > 0) {
      const { error: insertError } = await supabase
        .from('first_scorer_props')
        .upsert(
          analyses.map(a => ({
            ...a,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            is_active: true,
          })),
          { onConflict: 'game_id,prop_type,selection' }
        );
      
      if (insertError) {
        console.error('[First Scorer Engine] Insert error:', insertError);
        errors.push(insertError.message);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[First Scorer Engine] Complete: ${analyses.length} analyses in ${duration}ms`);

    // Log job history
    await supabase.from('cron_job_history').insert({
      job_name: 'first-scorer-engine',
      status: errors.length > 0 ? 'partial' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { analysesGenerated: analyses.length, sport, errors: errors.slice(0, 5) },
    });

    return new Response(
      JSON.stringify({
        success: true,
        analysesGenerated: analyses.length,
        duration,
        analyses: analyses.slice(0, 10),
        errors: errors.slice(0, 5),
        message: `Generated ${analyses.length} first scorer analyses`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[First Scorer Engine] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
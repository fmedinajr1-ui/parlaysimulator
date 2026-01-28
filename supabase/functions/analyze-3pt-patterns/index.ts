import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🎯 Starting 3PT Pattern Analysis...');

    // 1. Analyze recorded winning outcomes
    const { data: winningOutcomes } = await supabase
      .from('user_parlay_outcomes')
      .select('*')
      .eq('outcome', 'won');

    const playerSuccessMap: Record<string, { hits: number; lines: number[] }> = {};

    (winningOutcomes || []).forEach(outcome => {
      const legs = outcome.legs as Array<{ player: string; line: number }>;
      legs.forEach(leg => {
        if (!playerSuccessMap[leg.player]) {
          playerSuccessMap[leg.player] = { hits: 0, lines: [] };
        }
        playerSuccessMap[leg.player].hits++;
        playerSuccessMap[leg.player].lines.push(leg.line);
      });
    });

    console.log(`📊 Analyzed ${winningOutcomes?.length || 0} winning parlays`);

    // 2. Find consistent 3PT shooters from game logs
    const { data: consistentShooters } = await supabase
      .from('player_season_stats')
      .select('player_name, threes_avg, threes_std_dev, games_played')
      .gte('threes_avg', 2.0)
      .lte('threes_std_dev', 1.5)
      .gte('games_played', 10)
      .order('threes_std_dev', { ascending: true })
      .limit(20);

    console.log(`🏀 Found ${consistentShooters?.length || 0} consistent shooters`);

    // 3. Get elite matchup data
    const { data: eliteMatchups } = await supabase
      .from('v_3pt_matchup_favorites')
      .select('*')
      .eq('matchup_tier', 'ELITE_MATCHUP')
      .limit(50);

    console.log(`🔥 Found ${eliteMatchups?.length || 0} elite matchups`);

    // 4. Cross-reference with today's slate
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    
    const { data: todaysPicks } = await supabase
      .from('category_sweet_spots')
      .select('*')
      .eq('analysis_date', today)
      .eq('category', 'THREE_POINT_SHOOTER')
      .gte('l10_hit_rate', 0.90);

    console.log(`📅 Today's 3PT picks: ${todaysPicks?.length || 0}`);

    // 5. Build recommendations
    const recommendations: Array<{
      player: string;
      line: number;
      score: number;
      reasons: string[];
    }> = [];

    (todaysPicks || []).forEach(pick => {
      const score = 0;
      const reasons: string[] = [];
      let finalScore = pick.confidence_score || 0.8;

      // Check if player has winning history
      const playerHistory = playerSuccessMap[pick.player_name];
      if (playerHistory && playerHistory.hits >= 2) {
        finalScore += 0.5;
        reasons.push(`${playerHistory.hits}x winner in your parlays`);
      }

      // Check consistency
      const shooter = consistentShooters?.find(
        s => s.player_name.toLowerCase() === pick.player_name.toLowerCase()
      );
      if (shooter && shooter.threes_std_dev <= 1.0) {
        finalScore += 0.3;
        reasons.push(`Ultra-consistent (σ=${shooter.threes_std_dev.toFixed(2)})`);
      }

      // Check for elite matchup today
      const matchup = eliteMatchups?.find(
        m => m.player_name.toLowerCase() === pick.player_name.toLowerCase()
      );
      if (matchup) {
        finalScore += 0.4;
        reasons.push(`Elite H2H vs ${matchup.opponent} (${matchup.avg_3pt_vs_team.toFixed(1)} avg)`);
      }

      // L10 floor protection
      if (pick.l10_min >= 2) {
        finalScore += 0.2;
        reasons.push(`Strong floor (L10 min: ${pick.l10_min})`);
      }

      if (reasons.length > 0) {
        recommendations.push({
          player: pick.player_name,
          line: pick.actual_line || pick.recommended_line,
          score: finalScore,
          reasons,
        });
      }
    });

    // Sort by score
    recommendations.sort((a, b) => b.score - a.score);

    const result = {
      analyzed_at: new Date().toISOString(),
      winning_players: Object.entries(playerSuccessMap)
        .sort((a, b) => b[1].hits - a[1].hits)
        .slice(0, 10)
        .map(([player, data]) => ({ player, ...data })),
      consistent_shooters: consistentShooters?.slice(0, 10) || [],
      elite_matchups: eliteMatchups?.slice(0, 10) || [],
      todays_recommendations: recommendations.slice(0, 6),
      summary: {
        total_winning_parlays: winningOutcomes?.length || 0,
        consistent_shooters_found: consistentShooters?.length || 0,
        elite_matchups_found: eliteMatchups?.length || 0,
        todays_picks: todaysPicks?.length || 0,
      },
    };

    console.log('✅ Pattern analysis complete');
    console.log(`📈 Generated ${recommendations.length} recommendations`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in 3PT pattern analysis:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

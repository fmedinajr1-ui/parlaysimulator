import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AccuracyFilter {
  sport: string;
  recommendation: string;
  minAccuracy: number;
  signalType: string;
}

// High-accuracy signal filters based on historical data
const ACCURACY_FILTERS: AccuracyFilter[] = [
  { sport: 'nhl', recommendation: 'pick', minAccuracy: 60, signalType: 'nhl_sharp_pick' },
  { sport: 'nba', recommendation: 'fade', minAccuracy: 54, signalType: 'nba_sharp_fade' },
  { sport: 'ncaab', recommendation: 'fade', minAccuracy: 51, signalType: 'ncaab_sharp_fade' },
  { sport: 'nfl', recommendation: 'caution', minAccuracy: 58, signalType: 'nfl_caution' },
];

// Low-accuracy signals to EXCLUDE
const EXCLUDED_SIGNALS = [
  { sport: 'nba', recommendation: 'pick' },   // 33% - losing signal
  { sport: 'nfl', recommendation: 'pick' },   // 31% - losing signal
  { sport: 'ncaab', recommendation: 'pick' }, // Below 50%
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting best bets scan...');

    const bestBets: any[] = [];
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // 1. Scan NHL Sharp PICK signals (61%+ accuracy)
    const { data: nhlSharp, error: nhlError } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%nhl%')
      .eq('is_sharp_action', true)
      .eq('is_primary_record', true)
      .eq('recommendation', 'pick')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.6)
      .order('authenticity_confidence', { ascending: false })
      .limit(5);

    if (nhlError) {
      console.error('NHL scan error:', nhlError);
    } else if (nhlSharp) {
      console.log(`Found ${nhlSharp.length} NHL sharp PICK signals`);
      for (const signal of nhlSharp) {
        bestBets.push({
          event_id: signal.event_id,
          signal_type: 'nhl_sharp_pick',
          sport: signal.sport,
          description: signal.description,
          prediction: signal.recommendation,
          odds: signal.new_price,
          accuracy_at_time: 61.11
        });
      }
    }

    // 2. Scan NBA Sharp FADE signals (54%+ accuracy)
    const { data: nbaFade, error: nbaError } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%nba%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'fade')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.5)
      .order('authenticity_confidence', { ascending: false })
      .limit(5);

    if (nbaError) {
      console.error('NBA scan error:', nbaError);
    } else if (nbaFade) {
      console.log(`Found ${nbaFade.length} NBA sharp FADE signals`);
      for (const signal of nbaFade) {
        bestBets.push({
          event_id: signal.event_id,
          signal_type: 'nba_sharp_fade',
          sport: signal.sport,
          description: signal.description,
          prediction: 'fade',
          odds: signal.new_price,
          accuracy_at_time: 54.47
        });
      }
    }

    // 3. Scan NCAAB FADE signals (52%+ accuracy)
    const { data: ncaabFade, error: ncaabError } = await supabase
      .from('line_movements')
      .select('*')
      .ilike('sport', '%ncaab%')
      .eq('is_primary_record', true)
      .eq('recommendation', 'fade')
      .gte('commence_time', now)
      .gte('authenticity_confidence', 0.5)
      .order('trap_score', { ascending: false })
      .limit(5);

    if (ncaabError) {
      console.error('NCAAB scan error:', ncaabError);
    } else if (ncaabFade) {
      console.log(`Found ${ncaabFade.length} NCAAB FADE signals`);
      for (const signal of ncaabFade) {
        bestBets.push({
          event_id: signal.event_id,
          signal_type: 'ncaab_sharp_fade',
          sport: signal.sport,
          description: signal.description,
          prediction: 'fade',
          odds: signal.new_price,
          accuracy_at_time: 51.89
        });
      }
    }

    // 4. Scan NBA Fatigue Edge games (20+ differential)
    const { data: fatigueGames, error: fatigueError } = await supabase
      .from('fatigue_edge_tracking')
      .select('*')
      .gte('fatigue_differential', 20)
      .gte('game_date', today)
      .order('fatigue_differential', { ascending: false })
      .limit(5);

    if (fatigueError) {
      console.error('Fatigue scan error:', fatigueError);
    } else if (fatigueGames) {
      console.log(`Found ${fatigueGames.length} high fatigue differential games`);
      for (const game of fatigueGames) {
        bestBets.push({
          event_id: game.event_id,
          signal_type: 'nba_fatigue_edge',
          sport: 'basketball_nba',
          description: `${game.away_team} @ ${game.home_team}`,
          prediction: game.recommended_side,
          accuracy_at_time: 54.2
        });
      }
    }

    // 5. Log best bets to tracking table
    if (bestBets.length > 0) {
      const { error: insertError } = await supabase
        .from('best_bets_log')
        .upsert(
          bestBets.map(bet => ({
            event_id: bet.event_id,
            signal_type: bet.signal_type,
            sport: bet.sport,
            description: bet.description,
            prediction: bet.prediction,
            odds: bet.odds,
            accuracy_at_time: bet.accuracy_at_time,
            created_at: now
          })),
          { onConflict: 'event_id,signal_type' }
        );

      if (insertError) {
        console.error('Error logging best bets:', insertError);
      } else {
        console.log(`Logged ${bestBets.length} best bets`);
      }
    }

    // 6. Calculate current accuracy stats
    const { data: accuracyStats } = await supabase
      .from('line_movements')
      .select('sport, recommendation, outcome_correct')
      .eq('outcome_verified', true)
      .in('recommendation', ['pick', 'fade', 'caution']);

    const stats: Record<string, { wins: number; total: number }> = {};
    
    if (accuracyStats) {
      for (const row of accuracyStats) {
        const key = `${row.sport?.split('_').pop() || 'unknown'}_${row.recommendation}`;
        if (!stats[key]) {
          stats[key] = { wins: 0, total: 0 };
        }
        stats[key].total++;
        if (row.outcome_correct) {
          stats[key].wins++;
        }
      }
    }

    const accuracySummary = Object.entries(stats).map(([key, data]) => ({
      signal: key,
      accuracy: data.total > 0 ? ((data.wins / data.total) * 100).toFixed(2) + '%' : 'N/A',
      sample: data.total
    }));

    console.log('Scan complete. Accuracy summary:', accuracySummary);

    return new Response(
      JSON.stringify({
        success: true,
        bestBets: bestBets.length,
        signals: {
          nhl_sharp_pick: nhlSharp?.length || 0,
          nba_sharp_fade: nbaFade?.length || 0,
          ncaab_sharp_fade: ncaabFade?.length || 0,
          nba_fatigue: fatigueGames?.length || 0
        },
        accuracy: accuracySummary,
        timestamp: now
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Scan error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

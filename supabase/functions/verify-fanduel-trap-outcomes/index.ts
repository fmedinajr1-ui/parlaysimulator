import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🔍 FanDuel Trap Outcome Verification starting...');
    
    // Get pending trap analyses from completed games
    const cutoffTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago
    
    const { data: pendingTraps, error: fetchError } = await supabase
      .from('fanduel_trap_analysis')
      .select('*')
      .eq('outcome', 'pending')
      .lt('commence_time', cutoffTime)
      .gte('trap_score', 40) // Only verify high-confidence traps
      .order('commence_time', { ascending: true })
      .limit(100);
    
    if (fetchError) {
      throw new Error(`Failed to fetch pending traps: ${fetchError.message}`);
    }
    
    console.log(`📊 Found ${pendingTraps?.length || 0} pending trap analyses to verify`);
    
    if (!pendingTraps || pendingTraps.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending trap analyses to verify',
        verified: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    let verified = 0;
    let fadeWins = 0;
    let fadeLosses = 0;
    
    // Group by event for efficient processing
    const eventGroups = pendingTraps.reduce((acc, trap) => {
      if (!acc[trap.event_id]) {
        acc[trap.event_id] = [];
      }
      acc[trap.event_id].push(trap);
      return acc;
    }, {} as Record<string, any[]>);
    
    for (const [eventId, traps] of Object.entries(eventGroups)) {
      try {
        // Get the sport from first trap
        const trapArray = traps as any[];
        const sport = trapArray[0].sport;
        
        // Fetch completed game scores
        const scoresUrl = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${oddsApiKey}&daysFrom=3&eventIds=${eventId}`;
        const scoresResponse = await fetch(scoresUrl);
        
        if (!scoresResponse.ok) {
          console.log(`⚠️ Could not fetch scores for ${eventId}`);
          continue;
        }
        
        const scores = await scoresResponse.json();
        const game = scores.find((s: any) => s.id === eventId);
        
        if (!game || !game.completed) {
          console.log(`⏳ Game ${eventId} not completed yet`);
          continue;
        }
        
        // Determine winner
        const homeScore = game.scores?.find((s: any) => s.name === game.home_team)?.score;
        const awayScore = game.scores?.find((s: any) => s.name === game.away_team)?.score;
        
        if (homeScore === undefined || awayScore === undefined) {
          console.log(`⚠️ Missing scores for ${eventId}`);
          continue;
        }
        
        const winner = homeScore > awayScore ? game.home_team : game.away_team;
        const totalPoints = homeScore + awayScore;
        const spread = homeScore - awayScore;
        
        // Process each trap for this event
        for (const trap of trapArray) {
          let fadeWon: boolean | null = null;
          
          // Determine if fade won based on market type
          if (trap.market_type === 'h2h') {
            // For moneyline, fade wins if the opposite side won
            const originalPick = trap.outcome_name;
            fadeWon = winner !== originalPick;
          } else if (trap.market_type === 'spreads') {
            // For spreads, need to check if the fade covered
            const point = trap.hourly_movements?.[0]?.point || 0;
            if (trap.movement_direction === 'shortened') {
              // Public was on the favorite, fade = underdog + points
              fadeWon = spread < point;
            } else {
              fadeWon = spread > point;
            }
          } else if (trap.market_type === 'totals') {
            // For totals, determine if fade hit
            const line = trap.hourly_movements?.[0]?.point || 0;
            if (trap.outcome_name.toLowerCase().includes('over')) {
              // Original pick was over, fade = under
              fadeWon = totalPoints < line;
            } else {
              fadeWon = totalPoints > line;
            }
          }
          
          if (fadeWon !== null) {
            // Update trap record
            await supabase
              .from('fanduel_trap_analysis')
              .update({
                outcome: fadeWon ? 'won' : 'lost',
                fade_won: fadeWon,
                outcome_verified_at: new Date().toISOString()
              })
              .eq('id', trap.id);
            
            verified++;
            if (fadeWon) fadeWins++;
            else fadeLosses++;
            
            console.log(`${fadeWon ? '✅' : '❌'} ${trap.description} - Fade ${fadeWon ? 'WON' : 'LOST'}`);
          }
        }
      } catch (eventError) {
        console.error(`Error verifying event ${eventId}:`, eventError);
      }
    }
    
    // Update accuracy metrics
    if (verified > 0) {
      // Get all verified traps for accuracy calculation
      const { data: allVerified } = await supabase
        .from('fanduel_trap_analysis')
        .select('sport, trap_score, signals_detected, fade_won, odds_for_fade')
        .neq('outcome', 'pending');
      
      if (allVerified && allVerified.length > 0) {
        // Calculate accuracy by sport
        const sportStats = allVerified.reduce((acc, trap) => {
          const sport = trap.sport || 'unknown';
          if (!acc[sport]) {
            acc[sport] = { total: 0, wins: 0, totalOdds: 0 };
          }
          acc[sport].total++;
          if (trap.fade_won) acc[sport].wins++;
          acc[sport].totalOdds += trap.odds_for_fade || 0;
          return acc;
        }, {} as Record<string, { total: number; wins: number; totalOdds: number }>);
        
        // Update accuracy metrics table
        for (const [sport, stats] of Object.entries(sportStats)) {
          const winRate = stats.wins / stats.total;
          const avgOdds = stats.totalOdds / stats.total;
          
          // Calculate ROI (assuming -110 standard)
          const roi = ((stats.wins * 0.91 - (stats.total - stats.wins)) / stats.total) * 100;
          
          await supabase
            .from('fanduel_trap_accuracy_metrics')
            .upsert({
              sport,
              trap_type: 'fade_public',
              signal_type: 'all',
              total_predictions: stats.total,
              verified_predictions: stats.total,
              correct_predictions: stats.wins,
              accuracy_rate: Math.round(winRate * 100 * 10) / 10,
              roi_percentage: Math.round(roi * 10) / 10,
              avg_trap_score: 50, // Will be calculated properly
              avg_odds: Math.round(avgOdds),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'sport,trap_type,signal_type'
            });
        }
        
        // Calculate accuracy by signal type
        const signalStats: Record<string, { total: number; wins: number }> = {};
        
        for (const trap of allVerified) {
          const signals = trap.signals_detected || [];
          for (const signal of signals) {
            if (!signalStats[signal]) {
              signalStats[signal] = { total: 0, wins: 0 };
            }
            signalStats[signal].total++;
            if (trap.fade_won) signalStats[signal].wins++;
          }
        }
        
        // Update signal-level accuracy
        for (const [signal, stats] of Object.entries(signalStats)) {
          const winRate = stats.wins / stats.total;
          const roi = ((stats.wins * 0.91 - (stats.total - stats.wins)) / stats.total) * 100;
          
          await supabase
            .from('fanduel_trap_accuracy_metrics')
            .upsert({
              sport: 'all',
              trap_type: 'fade_public',
              signal_type: signal,
              total_predictions: stats.total,
              verified_predictions: stats.total,
              correct_predictions: stats.wins,
              accuracy_rate: Math.round(winRate * 100 * 10) / 10,
              roi_percentage: Math.round(roi * 10) / 10,
              avg_trap_score: 60,
              avg_odds: -110,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'sport,trap_type,signal_type'
            });
        }
      }
    }
    
    // Log job completion
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-fanduel-trap-outcomes',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        verified,
        fadeWins,
        fadeLosses,
        winRate: verified > 0 ? Math.round((fadeWins / verified) * 100) : 0
      }
    });
    
    console.log(`✅ Verification complete! ${verified} verified, ${fadeWins} wins, ${fadeLosses} losses`);
    
    return new Response(JSON.stringify({
      success: true,
      verified,
      fadeWins,
      fadeLosses,
      winRate: verified > 0 ? Math.round((fadeWins / verified) * 100) : 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('FanDuel Trap Verification error:', error);
    return new Response(JSON.stringify({ 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

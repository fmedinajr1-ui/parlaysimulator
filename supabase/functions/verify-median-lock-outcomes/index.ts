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
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting MedianLock outcome verification...');

    // Get pending candidates from yesterday and earlier
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: pendingCandidates, error: candidatesError } = await supabase
      .from('median_lock_candidates')
      .select('*')
      .lte('slate_date', yesterdayStr)
      .or('outcome.is.null,outcome.eq.pending')
      .limit(100);

    if (candidatesError) {
      console.error('Error fetching pending candidates:', candidatesError);
      throw candidatesError;
    }

    console.log(`Found ${pendingCandidates?.length || 0} pending candidates to verify`);

    let verifiedCount = 0;
    let hitCount = 0;
    let missCount = 0;

    // Process each candidate
    for (const candidate of pendingCandidates || []) {
      try {
        // Fetch player's actual game log for that date
        const { data: gameLog, error: logError } = await supabase
          .from('nba_player_game_logs')
          .select('points, rebounds, assists, minutes_played')
          .eq('player_name', candidate.player_name)
          .eq('game_date', candidate.slate_date)
          .single();

        if (logError || !gameLog) {
          console.log(`No game log found for ${candidate.player_name} on ${candidate.slate_date}`);
          continue;
        }

        // Determine actual value based on prop type
        let actualValue: number | null = null;
        const propType = candidate.prop_type?.toLowerCase() || '';

        if (propType.includes('points')) {
          actualValue = gameLog.points;
        } else if (propType.includes('rebounds')) {
          actualValue = gameLog.rebounds;
        } else if (propType.includes('assists')) {
          actualValue = gameLog.assists;
        } else if (propType.includes('pra') || propType.includes('pts+reb+ast')) {
          actualValue = (gameLog.points || 0) + (gameLog.rebounds || 0) + (gameLog.assists || 0);
        }

        if (actualValue === null) {
          console.log(`Could not determine actual value for prop type: ${propType}`);
          continue;
        }

        // Determine outcome (assuming Over bets for MedianLock)
        const bookLine = candidate.book_line || 0;
        let outcome: string;
        
        if (actualValue > bookLine) {
          outcome = 'hit';
          hitCount++;
        } else if (actualValue === bookLine) {
          outcome = 'push';
        } else {
          outcome = 'miss';
          missCount++;
        }

        // Update candidate with outcome
        const { error: updateError } = await supabase
          .from('median_lock_candidates')
          .update({
            outcome,
            actual_value: actualValue,
            verified_at: new Date().toISOString(),
          })
          .eq('id', candidate.id);

        if (updateError) {
          console.error(`Error updating candidate ${candidate.id}:`, updateError);
          continue;
        }

        verifiedCount++;
        console.log(`Verified ${candidate.player_name}: ${actualValue} vs ${bookLine} = ${outcome}`);
      } catch (err) {
        console.error(`Error processing candidate ${candidate.id}:`, err);
      }
    }

    // Now verify pending slips
    const { data: pendingSlips, error: slipsError } = await supabase
      .from('median_lock_slips')
      .select('*')
      .lte('slate_date', yesterdayStr)
      .or('outcome.is.null,outcome.eq.pending')
      .limit(50);

    if (slipsError) {
      console.error('Error fetching pending slips:', slipsError);
    }

    let slipsVerified = 0;

    for (const slip of pendingSlips || []) {
      try {
        const legIds = slip.leg_ids || [];
        if (legIds.length === 0) continue;

        // Fetch outcomes for all legs
        const { data: legCandidates, error: legsError } = await supabase
          .from('median_lock_candidates')
          .select('id, outcome')
          .in('id', legIds);

        if (legsError || !legCandidates) continue;

        // Check if all legs have been verified
        const allVerified = legCandidates.every(l => l.outcome && l.outcome !== 'pending');
        if (!allVerified) continue;

        // Calculate slip outcome
        const legsHit = legCandidates.filter(l => l.outcome === 'hit').length;
        const allHit = legsHit === legCandidates.length;
        const hasPush = legCandidates.some(l => l.outcome === 'push');

        let slipOutcome: string;
        if (allHit) {
          slipOutcome = 'won';
        } else if (hasPush && legsHit === legCandidates.length - 1) {
          slipOutcome = 'push';
        } else {
          slipOutcome = 'lost';
        }

        // Update slip
        const { error: updateSlipError } = await supabase
          .from('median_lock_slips')
          .update({
            outcome: slipOutcome,
            legs_hit: legsHit,
            verified_at: new Date().toISOString(),
          })
          .eq('id', slip.id);

        if (!updateSlipError) {
          slipsVerified++;
          console.log(`Verified slip ${slip.id}: ${legsHit}/${legCandidates.length} legs hit = ${slipOutcome}`);
        }
      } catch (err) {
        console.error(`Error processing slip ${slip.id}:`, err);
      }
    }

    const summary = {
      candidatesVerified: verifiedCount,
      hits: hitCount,
      misses: missCount,
      hitRate: verifiedCount > 0 ? (hitCount / verifiedCount * 100).toFixed(1) : 0,
      slipsVerified,
    };

    console.log('Verification complete:', summary);

    return new Response(JSON.stringify({ 
      success: true, 
      summary,
      message: `Verified ${verifiedCount} candidates (${hitCount} hits, ${missCount} misses) and ${slipsVerified} slips`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Verification error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

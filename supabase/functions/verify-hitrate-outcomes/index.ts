import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HitRateParlay {
  id: string;
  legs: any[];
  expires_at: string;
  combined_probability: number;
  strategy_type: string;
  sport: string | null;
}

// Map prop types to stat types with better coverage
const PROP_TO_STAT_MAP: Record<string, string[]> = {
  'player_points': ['points'],
  'player_rebounds': ['rebounds'],
  'player_assists': ['assists'],
  'player_threes': ['threes_made', 'three_pointers_made'],
  'player_blocks': ['blocks'],
  'player_steals': ['steals'],
  'player_turnovers': ['turnovers'],
  'player_points_rebounds_assists': ['pra'],
  'player_points_rebounds': ['pr'],
  'player_points_assists': ['pa'],
  'player_rebounds_assists': ['ra'],
  'points': ['points'],
  'rebounds': ['rebounds'],
  'assists': ['assists'],
  'threes': ['threes_made'],
  'blocks': ['blocks'],
  'steals': ['steals'],
};

// Normalize player names for better matching
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.\-']/g, '')
    .replace(/jr$/i, '')
    .replace(/sr$/i, '')
    .replace(/ii$/i, '')
    .replace(/iii$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Get first and last name parts
function getNameParts(name: string): { first: string; last: string } {
  const normalized = normalizePlayerName(name);
  const parts = normalized.split(' ');
  return {
    first: parts[0] || '',
    last: parts[parts.length - 1] || ''
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const startTime = Date.now();

    console.log('[VerifyHitRate] Starting hit rate parlay outcome verification...');

    // Get expired parlays that haven't been settled - extended window to 3 days
    const now = new Date();
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('hitrate_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .lt('expires_at', now.toISOString())
      .order('expires_at', { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error('[VerifyHitRate] Error fetching pending parlays:', fetchError);
      throw fetchError;
    }

    if (!pendingParlays || pendingParlays.length === 0) {
      console.log('[VerifyHitRate] No pending hit rate parlays to verify');
      return new Response(
        JSON.stringify({ success: true, message: 'No pending parlays to verify', verified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[VerifyHitRate] Found ${pendingParlays.length} expired parlays to verify`);

    let verified = 0;
    let won = 0;
    let lost = 0;

    for (const parlay of pendingParlays as HitRateParlay[]) {
      try {
        const legResults: any[] = [];
        let legsVerified = 0;
        let legsWon = 0;

        for (const leg of parlay.legs) {
          const playerName = leg.player_name;
          const propType = leg.prop_type;
          const line = parseFloat(leg.line);
          const recommendedSide = leg.recommended_side;

          const nameParts = getNameParts(playerName);
          const statTypes = PROP_TO_STAT_MAP[propType] || [propType];

          let actualValue: number | null = null;
          let foundStats = false;

          // Calculate date range: from parlay expiry to 3 days after
          const expiryDate = new Date(parlay.expires_at);
          const startDate = new Date(expiryDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const endDate = new Date(expiryDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

          // Try player_stats_cache with improved matching
          for (const statType of statTypes) {
            if (foundStats) break;

            const { data: stats } = await supabase
              .from('player_stats_cache')
              .select('*')
              .or(`player_name.ilike.%${nameParts.first}%${nameParts.last}%,player_name.ilike.%${nameParts.last}%${nameParts.first}%`)
              .eq('stat_type', statType)
              .gte('game_date', startDate)
              .lte('game_date', endDate)
              .order('game_date', { ascending: false })
              .limit(1);

            if (stats && stats.length > 0) {
              actualValue = stats[0].stat_value;
              foundStats = true;
              console.log(`[VerifyHitRate] Found stats for ${playerName}: ${statType} = ${actualValue}`);
            }
          }

          // Fallback to NBA game logs if basketball
          if (!foundStats && (parlay.sport?.includes('basketball') || parlay.sport?.includes('nba'))) {
            const { data: gameLogs } = await supabase
              .from('nba_player_game_logs')
              .select('*')
              .or(`player_name.ilike.%${nameParts.first}%${nameParts.last}%,player_name.ilike.%${nameParts.last}%`)
              .gte('game_date', startDate)
              .lte('game_date', endDate)
              .order('game_date', { ascending: false })
              .limit(1);

            if (gameLogs && gameLogs.length > 0) {
              const log = gameLogs[0];
              const baseStatType = statTypes[0];
              
              switch (baseStatType) {
                case 'points': actualValue = log.points; break;
                case 'rebounds': actualValue = log.rebounds; break;
                case 'assists': actualValue = log.assists; break;
                case 'threes_made': actualValue = log.threes_made; break;
                case 'blocks': actualValue = log.blocks; break;
                case 'steals': actualValue = log.steals; break;
                case 'turnovers': actualValue = log.turnovers; break;
                case 'pra': actualValue = (log.points || 0) + (log.rebounds || 0) + (log.assists || 0); break;
                case 'pr': actualValue = (log.points || 0) + (log.rebounds || 0); break;
                case 'pa': actualValue = (log.points || 0) + (log.assists || 0); break;
                case 'ra': actualValue = (log.rebounds || 0) + (log.assists || 0); break;
              }
              
              if (actualValue !== null) {
                foundStats = true;
                console.log(`[VerifyHitRate] Found NBA logs for ${playerName}: ${baseStatType} = ${actualValue}`);
              }
            }
          }

          // Determine leg outcome
          let legWon: boolean | null = null;
          if (actualValue !== null) {
            legsVerified++;
            if (actualValue === line) {
              legWon = null; // Push
            } else if (recommendedSide === 'over' || recommendedSide === 'Over') {
              legWon = actualValue > line;
            } else {
              legWon = actualValue < line;
            }
            if (legWon) legsWon++;
          }

          legResults.push({
            player_name: playerName,
            prop_type: propType,
            line,
            recommended_side: recommendedSide,
            actual_value: actualValue,
            won: legWon
          });
        }

        // Determine if we can settle this parlay
        const parlayAge = Date.now() - new Date(parlay.expires_at).getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const canSettle = legsVerified === parlay.legs.length || (parlayAge > threeDaysMs && legsVerified > 0);

        if (canSettle && legsVerified > 0) {
          // All legs must win for parlay to win
          const allVerifiedLegsWon = legResults.every(l => l.won === true || l.won === null);
          const anyLegLost = legResults.some(l => l.won === false);
          
          let outcome: string;
          if (anyLegLost) {
            outcome = 'lost';
            lost++;
          } else if (allVerifiedLegsWon && legsVerified === parlay.legs.length) {
            outcome = 'won';
            won++;
          } else {
            // Partial verification but old enough - assume loss for missing legs
            outcome = 'lost';
            lost++;
          }

          const { error: updateError } = await supabase
            .from('hitrate_parlays')
            .update({
              outcome,
              settled_at: new Date().toISOString(),
              result_details: legResults,
              actual_win_rate: legsVerified > 0 ? legsWon / legsVerified : 0
            })
            .eq('id', parlay.id);

          if (updateError) {
            console.error(`[VerifyHitRate] Error updating parlay ${parlay.id}:`, updateError);
          } else {
            verified++;
            console.log(`[VerifyHitRate] Settled parlay ${parlay.id} as ${outcome} (${legsWon}/${legsVerified} legs won)`);
          }
        } else {
          console.log(`[VerifyHitRate] Cannot settle parlay ${parlay.id} yet: ${legsVerified}/${parlay.legs.length} legs verified`);
        }
      } catch (legError) {
        console.error(`[VerifyHitRate] Error processing parlay ${parlay.id}:`, legError);
      }
    }

    // Update accuracy metrics with improved grouping
    if (verified > 0) {
      console.log('[VerifyHitRate] Updating hitrate accuracy metrics...');

      const { data: allSettled } = await supabase
        .from('hitrate_parlays')
        .select('strategy_type, sport, outcome, combined_probability, total_odds')
        .in('outcome', ['won', 'lost']);

      if (allSettled && allSettled.length > 0) {
        const grouped: Record<string, any> = {};

        for (const stat of allSettled) {
          const key = `${stat.strategy_type}|${stat.sport || 'all'}|all`;
          if (!grouped[key]) {
            grouped[key] = {
              strategy_type: stat.strategy_type,
              sport: stat.sport,
              total: 0,
              won: 0,
              lost: 0,
              probSum: 0,
              oddsSum: 0
            };
          }
          grouped[key].total++;
          grouped[key].probSum += stat.combined_probability || 0;
          grouped[key].oddsSum += stat.total_odds || 1;
          if (stat.outcome === 'won') grouped[key].won++;
          else grouped[key].lost++;
        }

        for (const key in grouped) {
          const g = grouped[key];
          const winRate = g.total > 0 ? (g.won / g.total) * 100 : 0;
          const avgPredicted = g.total > 0 ? (g.probSum / g.total) * 100 : 0;
          const avgOdds = g.total > 0 ? g.oddsSum / g.total : 1;
          const calibrationFactor = avgPredicted > 0 ? winRate / avgPredicted : 1;

          await supabase
            .from('hitrate_accuracy_metrics')
            .upsert({
              strategy_type: g.strategy_type,
              sport: g.sport,
              prop_type: null,
              total_parlays: g.total,
              total_won: g.won,
              total_lost: g.lost,
              win_rate: Math.round(winRate * 10) / 10,
              avg_predicted_probability: Math.round(avgPredicted * 10) / 10,
              avg_actual_probability: Math.round(winRate * 10) / 10,
              calibration_factor: Math.round(calibrationFactor * 100) / 100,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'strategy_type,sport,prop_type'
            });
        }
      }
    }

    const duration = Date.now() - startTime;

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-hitrate-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { verified, won, lost, pending: pendingParlays.length - verified }
    });

    console.log(`[VerifyHitRate] Verification complete: ${verified} settled (${won} won, ${lost} lost)`);

    return new Response(
      JSON.stringify({
        success: true,
        verified,
        won,
        lost,
        pending: pendingParlays.length - verified,
        duration
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[VerifyHitRate] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

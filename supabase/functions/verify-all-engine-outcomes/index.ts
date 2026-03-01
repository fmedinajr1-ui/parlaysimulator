import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map prop types to their corresponding stat columns in nba_player_game_logs
const PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'player_points_rebounds': ['points', 'rebounds'],
  'player_points_assists': ['points', 'assists'],
  'player_rebounds_assists': ['rebounds', 'assists'],
  'player_points_rebounds_assists': ['points', 'rebounds', 'assists'],
  'points': 'points',
  'rebounds': 'rebounds',
  'assists': 'assists',
  'threes': 'threes_made',
  'blocks': 'blocks',
  'steals': 'steals',
  'pts+reb': ['points', 'rebounds'],
  'pts+ast': ['points', 'assists'],
  'reb+ast': ['rebounds', 'assists'],
  'pts+reb+ast': ['points', 'rebounds', 'assists'],
  'pra': ['points', 'rebounds', 'assists'],
  'pr': ['points', 'rebounds'],
  'pa': ['points', 'assists'],
  'ra': ['rebounds', 'assists'],
};

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateActualValue(gameLog: any, propType: string): number | null {
  const normalizedProp = propType.toLowerCase().replace(/\s+/g, '_');
  const statKey = PROP_TO_STAT_MAP[normalizedProp];
  
  if (!statKey) {
    console.log(`[verify-all] Unknown prop type: ${propType}`);
    return null;
  }
  
  if (Array.isArray(statKey)) {
    let total = 0;
    for (const key of statKey) {
      const value = gameLog[key];
      if (value === null || value === undefined) return null;
      total += Number(value);
    }
    return total;
  } else {
    const value = gameLog[statKey];
    return value !== null && value !== undefined ? Number(value) : null;
  }
}

function determineOutcome(actualValue: number, line: number, side: string): 'won' | 'lost' | 'push' {
  if (actualValue === line) return 'push';
  
  const wentOver = actualValue > line;
  const betOver = side.toLowerCase() === 'over';
  
  if ((wentOver && betOver) || (!wentOver && !betOver)) {
    return 'won';
  }
  return 'lost';
}

// Strict date validation: only match picks against game logs from the same date
function validateGameLogDate(gameLog: any, expectedDate: string): boolean {
  if (!gameLog || !expectedDate) return false;
  const logDate = gameLog.game_date;
  if (!logDate) return false;
  return logDate === expectedDate;
}

interface VerificationResult {
  engine: string;
  verified: number;
  partial: number;
  won: number;
  lost: number;
  pushes: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[verify-all] Starting multi-engine outcome verification with partial support...');

    // Get date range (last 3 days)
    const today = new Date();
    const dates: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    // Step 1: Fetch all game logs for the date range
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .in('game_date', dates);

    if (logsError) {
      console.error('[verify-all] Error fetching game logs:', logsError);
      throw logsError;
    }

    console.log(`[verify-all] Loaded ${gameLogs?.length || 0} game logs for dates: ${dates.join(', ')}`);

    // Create lookup map
    const logMap = new Map<string, any>();
    for (const log of (gameLogs || [])) {
      const key = `${normalizePlayerName(log.player_name)}_${log.game_date}`;
      logMap.set(key, log);
    }

    const results: VerificationResult[] = [];

    // ========== VERIFY RISK ENGINE PICKS ==========
    console.log('[verify-all] Verifying Risk Engine picks...');
    
    const { data: riskPicks, error: riskError } = await supabase
      .from('nba_risk_engine_picks')
      .select('id, player_name, prop_type, line, side, game_date, outcome')
      .in('game_date', dates)
      .or('outcome.is.null,outcome.eq.pending');

    if (riskError) throw riskError;

    let riskResult: VerificationResult = { engine: 'risk', verified: 0, partial: 0, won: 0, lost: 0, pushes: 0 };

    for (const pick of (riskPicks || [])) {
      const normalizedPlayer = normalizePlayerName(pick.player_name);
      const lookupKey = `${normalizedPlayer}_${pick.game_date}`;
      const gameLog = logMap.get(lookupKey);

      // Strict date validation: only match if game log date equals pick's game date
      if (!gameLog || !validateGameLogDate(gameLog, pick.game_date)) {
        if (gameLog) {
          console.log(`[verify-all] Risk: Skipping ${pick.player_name} - game log date ${gameLog.game_date} != pick date ${pick.game_date}`);
        }
        continue;
      }

      const actualValue = calculateActualValue(gameLog, pick.prop_type);
      if (actualValue === null) continue;

      const outcome = determineOutcome(actualValue, pick.line, pick.side);
      
      await supabase
        .from('nba_risk_engine_picks')
        .update({ outcome, actual_value: actualValue, settled_at: new Date().toISOString() })
        .eq('id', pick.id);

      if (outcome === 'won') riskResult.won++;
      else if (outcome === 'lost') riskResult.lost++;
      else riskResult.pushes++;
      riskResult.verified++;

      console.log(`[verify-all] Risk: ${pick.player_name} ${pick.prop_type} ${pick.side} ${pick.line} → ${actualValue} = ${outcome}`);
    }

    results.push(riskResult);

    // ========== VERIFY SHARP AI PARLAYS (WITH PARTIAL SUPPORT) ==========
    console.log('[verify-all] Verifying Sharp AI parlays with partial support...');

    const { data: sharpParlays, error: sharpError } = await supabase
      .from('sharp_ai_parlays')
      .select('id, parlay_date, legs, outcome, verified_legs_count')
      .in('parlay_date', dates)
      .or('outcome.is.null,outcome.eq.pending,outcome.eq.partial');

    if (sharpError) throw sharpError;

    let sharpResult: VerificationResult = { engine: 'sharp', verified: 0, partial: 0, won: 0, lost: 0, pushes: 0 };

    for (const parlay of (sharpParlays || [])) {
      const legs = parlay.legs as any[];
      if (!legs || legs.length === 0) continue;

      let allHit = true;
      let anyMiss = false;
      let anyPush = false;
      let verifiedCount = 0;
      const legResults: any[] = [];

      for (const leg of legs) {
        const playerName = leg.player_name || leg.player || '';
        const propType = leg.prop_type || leg.market || leg.prop || '';
        const line = leg.line || leg.target || 0;
        const side = leg.side || leg.pick || 'over';

        const normalizedPlayer = normalizePlayerName(playerName);
        const lookupKey = `${normalizedPlayer}_${parlay.parlay_date}`;
        const gameLog = logMap.get(lookupKey);

        // Strict date validation: only match if game log date equals parlay's date
        if (!gameLog || !validateGameLogDate(gameLog, parlay.parlay_date)) {
          if (gameLog) {
            console.log(`[verify-all] Sharp: Skipping ${playerName} - game log date ${gameLog.game_date} != parlay date ${parlay.parlay_date}`);
          }
          legResults.push({ ...leg, outcome: 'pending' });
          continue;
        }

        const actualValue = calculateActualValue(gameLog, propType);
        if (actualValue === null) {
          legResults.push({ ...leg, outcome: 'pending' });
          continue;
        }

        const legOutcome = determineOutcome(actualValue, line, side);
        legResults.push({ ...leg, outcome: legOutcome, actual_value: actualValue });
        verifiedCount++;

        if (legOutcome === 'lost') {
          anyMiss = true;
          allHit = false;
        } else if (legOutcome === 'push') {
          anyPush = true;
        }

        console.log(`[verify-all] Sharp leg: ${playerName} ${propType} ${side} ${line} → ${actualValue} = ${legOutcome}`);
      }

      const allVerified = verifiedCount === legs.length;
      const hasVerifiedLegs = verifiedCount > 0;

      // Determine parlay outcome
      let parlayOutcome: string;
      if (anyMiss) {
        // Early bust detection: if ANY leg misses, parlay is lost
        parlayOutcome = 'lost';
        sharpResult.lost++;
        sharpResult.verified++;
        console.log(`[verify-all] Sharp parlay ${parlay.id} → EARLY BUST (lost detected)`);
      } else if (allVerified) {
        if (anyPush && allHit) {
          parlayOutcome = 'push';
          sharpResult.pushes++;
        } else {
          parlayOutcome = 'won';
          sharpResult.won++;
        }
        sharpResult.verified++;
        console.log(`[verify-all] Sharp parlay ${parlay.id} → ${parlayOutcome}`);
      } else if (hasVerifiedLegs) {
        parlayOutcome = 'partial';
        sharpResult.partial++;
        console.log(`[verify-all] Sharp parlay ${parlay.id} → PARTIAL (${verifiedCount}/${legs.length} verified)`);
      } else {
        parlayOutcome = 'pending';
        continue; // Skip update if nothing verified
      }

      // Always save leg results and verified count
      const updateData: any = {
        legs: legResults,
        verified_legs_count: verifiedCount,
      };

      // Set final outcome and settled_at for fully resolved parlays
      if (anyMiss || allVerified) {
        updateData.outcome = parlayOutcome;
        updateData.settled_at = new Date().toISOString();
      } else if (hasVerifiedLegs) {
        updateData.outcome = 'partial';
      }

      await supabase
        .from('sharp_ai_parlays')
        .update(updateData)
        .eq('id', parlay.id);
    }

    results.push(sharpResult);

    // ========== VERIFY HEAT PARLAYS (WITH PARTIAL SUPPORT) ==========
    console.log('[verify-all] Verifying Heat parlays with partial support...');

    const { data: heatParlays, error: heatError } = await supabase
      .from('heat_parlays')
      .select('id, parlay_date, leg_1, leg_2, outcome, verified_legs_count')
      .in('parlay_date', dates)
      .or('outcome.is.null,outcome.eq.pending,outcome.eq.partial');

    if (heatError) throw heatError;

    let heatResult: VerificationResult = { engine: 'heat', verified: 0, partial: 0, won: 0, lost: 0, pushes: 0 };

    for (const parlay of (heatParlays || [])) {
      const legs = [parlay.leg_1, parlay.leg_2].filter(Boolean) as any[];
      if (legs.length === 0) continue;

      let allHit = true;
      let anyMiss = false;
      let anyPush = false;
      let verifiedCount = 0;
      const updatedLegs: any[] = [];

      for (const leg of legs) {
        const playerName = leg.player_name || leg.player || '';
        const propType = leg.market_type || leg.prop_type || '';
        const line = leg.line || 0;
        const side = leg.side || 'over';

        const normalizedPlayer = normalizePlayerName(playerName);
        const lookupKey = `${normalizedPlayer}_${parlay.parlay_date}`;
        const gameLog = logMap.get(lookupKey);

        // Strict date validation: only match if game log date equals parlay's date
        if (!gameLog || !validateGameLogDate(gameLog, parlay.parlay_date)) {
          if (gameLog) {
            console.log(`[verify-all] Heat: Skipping ${playerName} - game log date ${gameLog.game_date} != parlay date ${parlay.parlay_date}`);
          }
          updatedLegs.push({ ...leg, outcome: 'pending' });
          continue;
        }

        const actualValue = calculateActualValue(gameLog, propType);
        if (actualValue === null) {
          updatedLegs.push({ ...leg, outcome: 'pending' });
          continue;
        }

        const legOutcome = determineOutcome(actualValue, line, side);
        updatedLegs.push({ ...leg, outcome: legOutcome, actual_value: actualValue });
        verifiedCount++;

        if (legOutcome === 'lost') {
          anyMiss = true;
          allHit = false;
        } else if (legOutcome === 'push') {
          anyPush = true;
        }

        console.log(`[verify-all] Heat leg: ${playerName} ${propType} ${side} ${line} → ${actualValue} = ${legOutcome}`);
      }

      const allVerified = verifiedCount === legs.length;
      const hasVerifiedLegs = verifiedCount > 0;

      // Determine parlay outcome
      let parlayOutcome: string;
      if (anyMiss) {
        // Early bust detection
        parlayOutcome = 'lost';
        heatResult.lost++;
        heatResult.verified++;
        console.log(`[verify-all] Heat parlay ${parlay.id} → EARLY BUST (lost detected)`);
      } else if (allVerified) {
        if (anyPush && allHit) {
          parlayOutcome = 'push';
          heatResult.pushes++;
        } else {
          parlayOutcome = 'won';
          heatResult.won++;
        }
        heatResult.verified++;
        console.log(`[verify-all] Heat parlay ${parlay.id} → ${parlayOutcome}`);
      } else if (hasVerifiedLegs) {
        parlayOutcome = 'partial';
        heatResult.partial++;
        console.log(`[verify-all] Heat parlay ${parlay.id} → PARTIAL (${verifiedCount}/${legs.length} verified)`);
      } else {
        parlayOutcome = 'pending';
        continue;
      }

      // Build update data
      const updateData: any = {
        verified_legs_count: verifiedCount,
      };
      if (updatedLegs[0]) updateData.leg_1 = updatedLegs[0];
      if (updatedLegs[1]) updateData.leg_2 = updatedLegs[1];

      if (anyMiss || allVerified) {
        updateData.outcome = parlayOutcome;
        updateData.settled_at = new Date().toISOString();
      } else if (hasVerifiedLegs) {
        updateData.outcome = 'partial';
      }

      await supabase
        .from('heat_parlays')
        .update(updateData)
        .eq('id', parlay.id);
    }

    results.push(heatResult);

    // ========== VERIFY MISPRICED LINES ==========
    console.log('[verify-all] Verifying Mispriced Lines picks...');
    
    const { data: mispricedPicks, error: mispricedError } = await supabase
      .from('mispriced_lines')
      .select('id, player_name, prop_type, book_line, signal, analysis_date, outcome')
      .in('analysis_date', dates)
      .or('outcome.is.null,outcome.eq.pending');

    if (mispricedError) {
      console.error('[verify-all] Error fetching mispriced lines:', mispricedError);
    }

    let mispricedResult: VerificationResult = { engine: 'mispriced', verified: 0, partial: 0, won: 0, lost: 0, pushes: 0 };

    for (const pick of (mispricedPicks || [])) {
      const normalizedPlayer = normalizePlayerName(pick.player_name);
      const lookupKey = `${normalizedPlayer}_${pick.analysis_date}`;
      const gameLog = logMap.get(lookupKey);

      if (!gameLog || !validateGameLogDate(gameLog, pick.analysis_date)) {
        continue;
      }

      // NULL-line guard: skip if book_line is missing
      if (pick.book_line === null || pick.book_line === undefined) {
        console.log(`[verify-all] Mispriced: Skipping ${pick.player_name} - no book_line`);
        continue;
      }

      const actualValue = calculateActualValue(gameLog, pick.prop_type);
      if (actualValue === null) continue;

      // signal is 'OVER' or 'UNDER'
      const side = (pick.signal || 'OVER').toLowerCase();
      const outcome = determineOutcome(actualValue, pick.book_line, side);
      
      await supabase
        .from('mispriced_lines')
        .update({ outcome, actual_value: actualValue, settled_at: new Date().toISOString() })
        .eq('id', pick.id);

      if (outcome === 'won') mispricedResult.won++;
      else if (outcome === 'lost') mispricedResult.lost++;
      else mispricedResult.pushes++;
      mispricedResult.verified++;

      console.log(`[verify-all] Mispriced: ${pick.player_name} ${pick.prop_type} ${side} ${pick.book_line} → ${actualValue} = ${outcome}`);
    }

    results.push(mispricedResult);

    // ========== VERIFY HIGH CONVICTION RESULTS ==========
    console.log('[verify-all] Verifying High Conviction picks...');
    
    const { data: hcPicks, error: hcError } = await supabase
      .from('high_conviction_results')
      .select('id, player_name, prop_type, current_line, signal, analysis_date, outcome')
      .in('analysis_date', dates)
      .or('outcome.is.null,outcome.eq.pending');

    if (hcError) {
      console.error('[verify-all] Error fetching high conviction results:', hcError);
    }

    let hcResult: VerificationResult = { engine: 'high_conviction', verified: 0, partial: 0, won: 0, lost: 0, pushes: 0 };

    for (const pick of (hcPicks || [])) {
      const normalizedPlayer = normalizePlayerName(pick.player_name);
      const lookupKey = `${normalizedPlayer}_${pick.analysis_date}`;
      const gameLog = logMap.get(lookupKey);

      if (!gameLog || !validateGameLogDate(gameLog, pick.analysis_date)) {
        continue;
      }

      // NULL-line guard: skip if current_line is missing
      if (pick.current_line === null || pick.current_line === undefined) {
        console.log(`[verify-all] HighConviction: Skipping ${pick.player_name} - no current_line`);
        continue;
      }

      const actualValue = calculateActualValue(gameLog, pick.prop_type);
      if (actualValue === null) continue;

      // signal is 'OVER' or 'UNDER'
      const side = (pick.signal || 'OVER').toLowerCase();
      const outcome = determineOutcome(actualValue, pick.current_line, side);
      
      await supabase
        .from('high_conviction_results')
        .update({ outcome, actual_value: actualValue, settled_at: new Date().toISOString() })
        .eq('id', pick.id);

      if (outcome === 'won') hcResult.won++;
      else if (outcome === 'lost') hcResult.lost++;
      else hcResult.pushes++;
      hcResult.verified++;

      console.log(`[verify-all] HighConviction: ${pick.player_name} ${pick.prop_type} ${side} ${pick.current_line} → ${actualValue} = ${outcome}`);
    }

    results.push(hcResult);

    // Log to cron job history
    const totalVerified = results.reduce((sum, r) => sum + r.verified, 0);
    const totalPartial = results.reduce((sum, r) => sum + r.partial, 0);
    const totalWon = results.reduce((sum, r) => sum + r.won, 0);
    const totalLost = results.reduce((sum, r) => sum + r.lost, 0);
    const totalPushes = results.reduce((sum, r) => sum + r.pushes, 0);

    await supabase.from('cron_job_history').insert({
      job_name: 'verify-all-engine-outcomes',
      status: 'success',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: { results, totalVerified, totalPartial, totalWon, totalLost, totalPushes }
    });

    console.log(`[verify-all] Complete: ${totalVerified} verified, ${totalPartial} partial (${totalWon}W/${totalLost}L/${totalPushes}P)`);

    return new Response(JSON.stringify({
      success: true,
      results,
      summary: {
        verified: totalVerified,
        partial: totalPartial,
        won: totalWon,
        lost: totalLost,
        pushes: totalPushes,
        winRate: totalVerified > 0 ? ((totalWon / (totalWon + totalLost)) * 100).toFixed(1) : '0'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('[verify-all] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

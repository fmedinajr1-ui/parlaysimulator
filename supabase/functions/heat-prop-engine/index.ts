import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// MODULE 2: SIGNAL DETECTION CONSTANTS
// ============================================================================
const SIGNALS = {
  JUICE_DIVERGENCE: 20,       // Price ≥20 cents, NO line move
  LINE_MOVE_AGAINST_PUBLIC: 20, // Tickets ≥65% one side, line opposite
  EARLY_SHARP_SNAP: 25,       // Meaningful move within 10min of open
  MULTI_BOOK_CONFIRMATION: 15, // ≥3 books same direction in 30min
  PROMO_TRAP: -20,            // Promo + public heavy + inflated line
  LATE_CHASE: -10             // Heavy movement in final 60min with tickets
};

// Signal label thresholds
function getSignalLabel(score: number): string {
  if (score >= 80) return 'STRONG_SHARP';
  if (score >= 60) return 'SHARP_LEAN';
  if (score >= 40) return 'NEUTRAL';
  return 'PUBLIC_TRAP';
}

// ============================================================================
// MODULE 3: STAT-TYPE SAFETY FILTER
// ============================================================================
const STAT_SAFETY_RULES: Record<string, { prefer: string[], avoid: string[] }> = {
  basketball_nba: {
    prefer: ['rebounds', 'assists', '3pt_attempts', 'turnovers', 'steals', 'blocks'],
    avoid: ['points', '3pt_made', 'fantasy_points', 'pra', 'double_double']
  },
  icehockey_nhl: {
    prefer: ['shots_on_goal', 'blocked_shots', 'hits', 'faceoffs_won'],
    avoid: ['points', 'goals', 'power_play_points']
  },
  soccer: {
    prefer: ['passes', 'tackles', 'interceptions', 'shots', 'crosses'],
    avoid: ['goals', 'anytime_scorer', 'first_scorer']
  },
  tennis: {
    prefer: ['aces', 'double_faults', 'games_won', 'total_sets'],
    avoid: ['set_winner', 'tiebreak']
  }
};

// Star players with role-based exceptions
const NEVER_FADE_PRA = [
  'jaylen brown', 'jayson tatum', 'devin booker',
  'luka doncic', 'nikola jokic', 'giannis antetokounmpo'
];

// ============================================================================
// MODULE 4: ROLE/ROTATION VALIDATION
// ============================================================================
function passesRoleValidation(
  sport: string,
  side: string,
  projectedMinutes: number | null,
  playerRoleTag: string | null,
  playerName: string,
  marketType: string
): { passes: boolean; reason?: string } {
  const lowerName = playerName.toLowerCase();
  
  // NBA minutes filter
  if (sport === 'basketball_nba' && side === 'over') {
    if (projectedMinutes && projectedMinutes < 24) {
      return { passes: false, reason: `Projected ${projectedMinutes} minutes < 24 min threshold` };
    }
  }
  
  // Never fade PRA for certain stars
  if (NEVER_FADE_PRA.includes(lowerName) && side === 'under') {
    const praMarkets = ['points', 'rebounds', 'assists', 'pra'];
    if (praMarkets.includes(marketType.toLowerCase())) {
      return { passes: false, reason: `Never fade ${playerName} ${marketType} under` };
    }
  }
  
  return { passes: true };
}

function passesStatSafety(sport: string, marketType: string): { passes: boolean; reason?: string } {
  const rules = STAT_SAFETY_RULES[sport];
  if (!rules) return { passes: true };
  
  const lowerMarket = marketType.toLowerCase();
  
  // Check if in avoid list
  for (const avoided of rules.avoid) {
    if (lowerMarket.includes(avoided)) {
      return { passes: false, reason: `${marketType} is a high-variance stat type` };
    }
  }
  
  return { passes: true };
}

// ============================================================================
// MODULE 5: TIME-WEIGHTED CONFIDENCE DECAY
// ============================================================================
function calculateTimeDecay(hoursToStart: number, signalLabel: string): number {
  if (hoursToStart > 6) return 0;
  if (hoursToStart >= 2 && hoursToStart <= 6) return -3;
  if (hoursToStart < 2 && signalLabel !== 'STRONG_SHARP') return -6;
  return 0;
}

// ============================================================================
// MODULE 2: SIGNAL SCORING
// ============================================================================
function calculateMarketSignalScore(
  lineDelta: number,
  priceDelta: number,
  publicPctTickets: number | null,
  promoFlag: boolean,
  hoursToGame: number,
  multiBookCount: number
): { score: number; signals: string[] } {
  let score = 50; // Base score
  const signals: string[] = [];
  
  // A) JUICE DIVERGENCE: Price moves ≥20 cents with NO line move
  if (Math.abs(priceDelta) >= 20 && Math.abs(lineDelta) < 0.5) {
    score += SIGNALS.JUICE_DIVERGENCE;
    signals.push('JUICE_DIVERGENCE');
  }
  
  // B) LINE MOVE AGAINST PUBLIC
  if (publicPctTickets && publicPctTickets >= 65 && Math.abs(lineDelta) >= 0.5) {
    // Assuming line moved against public (would need direction data)
    score += SIGNALS.LINE_MOVE_AGAINST_PUBLIC;
    signals.push('LINE_MOVE_AGAINST_PUBLIC');
  }
  
  // C) EARLY SHARP SNAP (12-24h is optimal)
  if (hoursToGame >= 12 && hoursToGame <= 24 && Math.abs(lineDelta) >= 0.5) {
    score += SIGNALS.EARLY_SHARP_SNAP;
    signals.push('EARLY_SHARP_SNAP');
  }
  
  // D) MULTI-BOOK CONFIRMATION
  if (multiBookCount >= 3) {
    score += SIGNALS.MULTI_BOOK_CONFIRMATION;
    signals.push('MULTI_BOOK_CONFIRMATION');
  }
  
  // E) PROMO TRAP
  if (promoFlag && publicPctTickets && publicPctTickets >= 60) {
    score += SIGNALS.PROMO_TRAP;
    signals.push('PROMO_TRAP');
  }
  
  // F) LATE CHASE
  if (hoursToGame < 1 && publicPctTickets && publicPctTickets >= 60) {
    score += SIGNALS.LATE_CHASE;
    signals.push('LATE_CHASE');
  }
  
  return { score: Math.max(0, Math.min(100, score)), signals };
}

// ============================================================================
// BASE ROLE SCORE (0-50)
// ============================================================================
function calculateBaseRoleScore(
  sport: string,
  marketType: string,
  playerRoleTag: string | null
): number {
  const rules = STAT_SAFETY_RULES[sport];
  if (!rules) return 25;
  
  const lowerMarket = marketType.toLowerCase();
  
  // Higher score for preferred stats
  for (const preferred of rules.prefer) {
    if (lowerMarket.includes(preferred)) {
      return 40 + (playerRoleTag === 'star' ? 10 : 0);
    }
  }
  
  // Lower score for avoided stats
  for (const avoided of rules.avoid) {
    if (lowerMarket.includes(avoided)) {
      return 15;
    }
  }
  
  return 25; // Neutral
}

// ============================================================================
// MODULE 6: PARLAY BUILDING
// ============================================================================
interface ParlayLeg {
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  book_name: string;
  final_score: number;
  signal_label: string;
  reason: string;
  event_id: string;
  sport: string;
}

function buildParlays(
  eligibleProps: any[],
  parlayType: 'CORE' | 'UPSIDE'
): { leg_1: ParlayLeg; leg_2: ParlayLeg; summary: string; risk_level: string } | null {
  const minScore = parlayType === 'CORE' ? 78 : 70;
  
  // Filter by score threshold
  let candidates = eligibleProps.filter(p => p.final_score >= minScore);
  
  // CORE: Reject PUBLIC_TRAP
  if (parlayType === 'CORE') {
    candidates = candidates.filter(p => p.signal_label !== 'PUBLIC_TRAP');
  }
  
  // UPSIDE: Allow ONE higher-variance leg if STRONG_SHARP or SHARP_LEAN
  // (stat safety already filtered, but we can relax for upside)
  
  // Sort by final_score descending
  candidates.sort((a, b) => b.final_score - a.final_score);
  
  if (candidates.length < 2) return null;
  
  // Select two legs from different games
  let leg1 = candidates[0];
  let leg2 = candidates.find(c => 
    c.event_id !== leg1.event_id && 
    c.player_name !== leg1.player_name
  );
  
  // If no different game, allow same game with low correlation
  if (!leg2) {
    leg2 = candidates.find(c => c.player_name !== leg1.player_name);
  }
  
  if (!leg2) return null;
  
  const formatLeg = (p: any): ParlayLeg => ({
    player_name: p.player_name,
    market_type: p.market_type,
    line: p.latest_line,
    side: p.side,
    book_name: p.book_name,
    final_score: p.final_score,
    signal_label: p.signal_label,
    reason: generateLegReason(p),
    event_id: p.event_id,
    sport: p.sport
  });
  
  return {
    leg_1: formatLeg(leg1),
    leg_2: formatLeg(leg2),
    summary: parlayType === 'CORE' 
      ? 'Low-variance volume stats with strong market signals' 
      : 'Higher upside with sharp-confirmed legs',
    risk_level: parlayType === 'CORE' ? 'Low' : 'Med'
  };
}

function generateLegReason(prop: any): string {
  const parts: string[] = [];
  
  if (prop.signal_label === 'STRONG_SHARP') {
    parts.push('Strong sharp action detected');
  } else if (prop.signal_label === 'SHARP_LEAN') {
    parts.push('Sharp lean confirmed');
  }
  
  if (prop.line_delta && Math.abs(prop.line_delta) >= 0.5) {
    const dir = prop.line_delta > 0 ? 'up' : 'down';
    parts.push(`Line moved ${Math.abs(prop.line_delta).toFixed(1)} ${dir}`);
  }
  
  const rules = STAT_SAFETY_RULES[prop.sport];
  if (rules) {
    const lowerMarket = prop.market_type.toLowerCase();
    for (const pref of rules.prefer) {
      if (lowerMarket.includes(pref)) {
        parts.push(`Volume stat (${pref})`);
        break;
      }
    }
  }
  
  return parts.length > 0 ? parts.join('; ') : 'Meets all validation rules';
}

// ============================================================================
// MAIN ENGINE
// ============================================================================
async function runHeatEngine(supabase: any, action: string, sport?: string) {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  
  console.log(`[Heat Prop Engine] Running action: ${action}, sport: ${sport || 'all'}, date: ${today}`);
  
  if (action === 'scan' || action === 'ingest') {
    // Fetch props from nba_risk_engine_picks as source data
    // Filter by mode='full_slate' and no rejection_reason (these are approved picks)
    const { data: picks, error: picksError } = await supabase
      .from('nba_risk_engine_picks')
      .select('*')
      .gte('game_date', today)
      .eq('mode', 'full_slate')
      .is('rejection_reason', null);
    
    if (picksError) {
      console.error('Error fetching picks:', picksError);
      return { success: false, error: picksError.message };
    }
    
    console.log(`[Heat Engine] Found ${picks?.length || 0} approved picks`);
    
    if (!picks || picks.length === 0) {
      return { 
        success: true, 
        message: 'No approved picks available',
        processed: 0
      };
    }
    
    // Process each pick and upsert to heat_prop_tracker
    const trackerUpserts: any[] = [];
    
    for (const pick of picks) {
      const hoursToGame = pick.game_date 
        ? (new Date(pick.game_date).getTime() - now.getTime()) / (1000 * 60 * 60)
        : 24;
      
      // Map fields from nba_risk_engine_picks schema
      const sport = 'basketball_nba';
      const side = pick.side?.toLowerCase() || 'over';
      const lineDelta = (pick.current_line && pick.line) ? (pick.current_line - pick.line) : 0;
      const priceDelta = 0; // Not available in source
      const projectedMinutes = pick.avg_minutes || null;
      const roleTag = pick.player_role || null;
      
      // Calculate signals
      const { score: signalScore, signals } = calculateMarketSignalScore(
        lineDelta,
        priceDelta,
        null, // public_pct not available
        false, // is_promo not available
        hoursToGame,
        1 // confirming_books default
      );
      
      // Calculate base role score
      const baseRoleScore = calculateBaseRoleScore(
        sport,
        pick.prop_type,
        roleTag
      );
      
      // Calculate time decay
      const signalLabel = getSignalLabel(signalScore);
      const timeDecay = calculateTimeDecay(hoursToGame, signalLabel);
      
      // Final score
      const finalScore = baseRoleScore + signalScore + timeDecay;
      
      // Validation
      const statSafety = passesStatSafety(sport, pick.prop_type);
      const roleValidation = passesRoleValidation(
        sport,
        side,
        projectedMinutes,
        roleTag,
        pick.player_name,
        pick.prop_type
      );
      
      // Eligibility
      const isEligibleCore = finalScore >= 78 && 
        statSafety.passes && 
        roleValidation.passes && 
        signalLabel !== 'PUBLIC_TRAP';
      
      const isEligibleUpside = finalScore >= 70 && 
        roleValidation.passes &&
        (signalLabel === 'STRONG_SHARP' || signalLabel === 'SHARP_LEAN' || statSafety.passes);
      
      trackerUpserts.push({
        event_id: pick.event_id || `${pick.player_name}-${pick.prop_type}-${today}`,
        sport: sport,
        league: 'NBA',
        start_time_utc: pick.game_date || new Date(now.getTime() + hoursToGame * 60 * 60 * 1000).toISOString(),
        home_team: null, // Not available in source
        away_team: null, // Not available in source
        player_name: pick.player_name,
        market_type: pick.prop_type,
        opening_line: pick.line,
        opening_price: pick.odds || -110,
        opening_time: now.toISOString(),
        latest_line: pick.line + lineDelta,
        latest_price: (pick.odds || -110) + priceDelta,
        latest_time: now.toISOString(),
        line_delta: lineDelta,
        price_delta: priceDelta,
        update_count: 1,
        projected_minutes: pick.projected_minutes,
        player_role_tag: pick.role_tag,
        market_signal_score: signalScore,
        signal_label: signalLabel,
        base_role_score: baseRoleScore,
        final_score: finalScore,
        passes_stat_safety: statSafety.passes,
        passes_role_validation: roleValidation.passes,
        is_eligible_core: isEligibleCore,
        is_eligible_upside: isEligibleUpside,
        book_name: pick.bookmaker || 'fanduel',
        side: pick.pick_side?.toLowerCase() || 'over',
        updated_at: now.toISOString()
      });
    }
    
    // Upsert to tracker
    if (trackerUpserts.length > 0) {
      const { error: upsertError } = await supabase
        .from('heat_prop_tracker')
        .upsert(trackerUpserts, {
          onConflict: 'event_id,player_name,market_type,book_name,side'
        });
      
      if (upsertError) {
        console.error('Error upserting tracker:', upsertError);
        return { success: false, error: upsertError.message };
      }
    }
    
    console.log(`[Heat Engine] Upserted ${trackerUpserts.length} props to tracker`);
    
    return {
      success: true,
      processed: trackerUpserts.length,
      eligible_core: trackerUpserts.filter(t => t.is_eligible_core).length,
      eligible_upside: trackerUpserts.filter(t => t.is_eligible_upside).length
    };
  }
  
  if (action === 'build') {
    // Fetch eligible props from tracker
    const { data: eligibleProps, error: fetchError } = await supabase
      .from('heat_prop_tracker')
      .select('*')
      .gte('start_time_utc', today)
      .or('is_eligible_core.eq.true,is_eligible_upside.eq.true')
      .order('final_score', { ascending: false });
    
    if (fetchError) {
      console.error('Error fetching eligible props:', fetchError);
      return { success: false, error: fetchError.message };
    }
    
    console.log(`[Heat Engine] Found ${eligibleProps?.length || 0} eligible props`);
    
    if (!eligibleProps || eligibleProps.length < 2) {
      // Clear today's parlays
      await supabase.from('heat_parlays').delete().eq('parlay_date', today);
      await supabase.from('heat_watchlist').delete().eq('watchlist_date', today);
      await supabase.from('heat_do_not_bet').delete().eq('dnb_date', today);
      
      return {
        success: true,
        message: 'NO CORE PLAY TODAY - insufficient eligible props',
        core_parlay: null,
        upside_parlay: null,
        watchlist: [],
        do_not_bet: []
      };
    }
    
    // Build CORE parlay
    const coreParlay = buildParlays(
      eligibleProps.filter((p: any) => p.is_eligible_core),
      'CORE'
    );
    
    // Build UPSIDE parlay
    const upsideParlay = buildParlays(
      eligibleProps.filter((p: any) => p.is_eligible_upside),
      'UPSIDE'
    );
    
    // Build Watchlist (top 5 approaching entry)
    const watchlistCandidates = eligibleProps
      .filter((p: any) => p.final_score >= 65 && p.final_score < 78)
      .slice(0, 5)
      .map((p: any) => ({
        watchlist_date: today,
        player_name: p.player_name,
        market_type: p.market_type,
        line: p.latest_line,
        side: p.side,
        sport: p.sport,
        event_id: p.event_id,
        signal_label: p.signal_label,
        approaching_entry: p.final_score >= 73,
        final_score: p.final_score,
        reason: `Score ${p.final_score}/100, needs ${78 - p.final_score} more for CORE`
      }));
    
    // Build Do-Not-Bet list (PUBLIC_TRAP flagged)
    const { data: allTracked } = await supabase
      .from('heat_prop_tracker')
      .select('*')
      .gte('start_time_utc', today)
      .eq('signal_label', 'PUBLIC_TRAP')
      .order('final_score', { ascending: true })
      .limit(5);
    
    const dnbList = (allTracked || []).map((p: any) => ({
      dnb_date: today,
      player_name: p.player_name,
      market_type: p.market_type,
      line: p.latest_line,
      side: p.side,
      sport: p.sport,
      event_id: p.event_id,
      trap_reason: `PUBLIC_TRAP - Score ${p.final_score}/100, signals: ${p.signal_label}`,
      final_score: p.final_score
    }));
    
    // Save parlays
    const parlaysToSave: any[] = [];
    
    if (coreParlay) {
      parlaysToSave.push({
        parlay_date: today,
        parlay_type: 'CORE',
        leg_1: coreParlay.leg_1,
        leg_2: coreParlay.leg_2,
        summary: coreParlay.summary,
        risk_level: coreParlay.risk_level,
        no_bet_flags: [],
        engine_version: 'v1'
      });
    }
    
    if (upsideParlay) {
      parlaysToSave.push({
        parlay_date: today,
        parlay_type: 'UPSIDE',
        leg_1: upsideParlay.leg_1,
        leg_2: upsideParlay.leg_2,
        summary: upsideParlay.summary,
        risk_level: upsideParlay.risk_level,
        no_bet_flags: [],
        engine_version: 'v1'
      });
    }
    
    // Clear and insert
    await supabase.from('heat_parlays').delete().eq('parlay_date', today);
    await supabase.from('heat_watchlist').delete().eq('watchlist_date', today);
    await supabase.from('heat_do_not_bet').delete().eq('dnb_date', today);
    
    if (parlaysToSave.length > 0) {
      await supabase.from('heat_parlays').insert(parlaysToSave);
    }
    
    if (watchlistCandidates.length > 0) {
      await supabase.from('heat_watchlist').insert(watchlistCandidates);
    }
    
    if (dnbList.length > 0) {
      await supabase.from('heat_do_not_bet').insert(dnbList);
    }
    
    return {
      success: true,
      core_parlay: coreParlay,
      upside_parlay: upsideParlay,
      watchlist: watchlistCandidates,
      do_not_bet: dnbList
    };
  }
  
  if (action === 'fetch') {
    // Fetch today's parlays
    const { data: parlays } = await supabase
      .from('heat_parlays')
      .select('*')
      .eq('parlay_date', today);
    
    const { data: watchlist } = await supabase
      .from('heat_watchlist')
      .select('*')
      .eq('watchlist_date', today)
      .order('final_score', { ascending: false });
    
    const { data: dnb } = await supabase
      .from('heat_do_not_bet')
      .select('*')
      .eq('dnb_date', today);
    
    const coreParlay = parlays?.find((p: any) => p.parlay_type === 'CORE');
    const upsideParlay = parlays?.find((p: any) => p.parlay_type === 'UPSIDE');
    
    return {
      success: true,
      core_parlay: coreParlay || null,
      upside_parlay: upsideParlay || null,
      watchlist: watchlist || [],
      do_not_bet: dnb || []
    };
  }
  
  return { success: false, error: 'Invalid action' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action = 'fetch', sport } = body;

    console.log(`[Heat Prop Engine] Request: ${action}, sport: ${sport || 'all'}`);

    const result = await runHeatEngine(supabase, action, sport);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Heat Prop Engine] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

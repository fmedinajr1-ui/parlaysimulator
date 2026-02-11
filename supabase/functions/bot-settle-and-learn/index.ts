/**
 * bot-settle-and-learn (v3 - Pipeline Fix)
 * 
 * Settles yesterday's parlays, updates category weights based on outcomes,
 * syncs weights from category_sweet_spots verified outcomes, and tracks activation progress.
 * 
 * v3 changes:
 * - Removed inline verify-sweet-spot-outcomes call (handled by separate cron)
 * - Added date guard: only settle parlays where parlay_date < today ET
 * - Batch leg lookups instead of individual queries
 * - Team leg settlement via aggregated game scores
 * 
 * Runs 3x daily via cron (6 AM, 12 PM, 6 PM ET).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Learning constants
const WEIGHT_BOOST_BASE = 0.02;
const WEIGHT_BOOST_STREAK = 0.005;
const WEIGHT_PENALTY_BASE = 0.03;
const WEIGHT_PENALTY_STREAK = 0.01;
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 1.5;

const BLOCK_STREAK_THRESHOLD = -5;
const BLOCK_HIT_RATE_THRESHOLD = 35;
const BLOCK_MIN_SAMPLES = 20;

// Team-related categories
const TEAM_CATEGORIES = ['SHARP_SPREAD', 'UNDER_TOTAL', 'OVER_TOTAL', 'ML_UNDERDOG', 'ML_FAVORITE'];

interface BotLeg {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  line: number;
  side: string;
  category: string;
  weight: number;
  hit_rate: number;
  outcome?: string;
  actual_value?: number;
  type?: string;
  home_team?: string;
  away_team?: string;
  bet_type?: string;
}

interface RecentOutcome {
  category: string;
  recommended_side: string;
  outcome: string;
  settled_at: string;
}

function isTeamLeg(leg: BotLeg): boolean {
  return leg.type === 'team' ||
    TEAM_CATEGORIES.includes(leg.category ?? '') ||
    (!!leg.home_team && !!leg.away_team);
}

function adjustWeight(
  currentWeight: number,
  hit: boolean,
  currentStreak: number
): { newWeight: number; blocked: boolean; newStreak: number; blockReason?: string } {
  let newStreak = currentStreak;
  
  if (hit) {
    newStreak = Math.max(1, currentStreak + 1);
    const boost = WEIGHT_BOOST_BASE + (Math.max(0, newStreak - 1) * WEIGHT_BOOST_STREAK);
    return {
      newWeight: Math.min(currentWeight + boost, MAX_WEIGHT),
      blocked: false,
      newStreak,
    };
  } else {
    newStreak = Math.min(-1, currentStreak - 1);
    const absStreak = Math.abs(newStreak);
    const penalty = WEIGHT_PENALTY_BASE + ((absStreak - 1) * WEIGHT_PENALTY_STREAK);
    const newWeight = currentWeight - penalty;
    
    if (newStreak <= BLOCK_STREAK_THRESHOLD) {
      return { 
        newWeight: 0, blocked: true, newStreak,
        blockReason: `${absStreak} consecutive misses`,
      };
    }
    
    if (newWeight < MIN_WEIGHT) {
      return { 
        newWeight: 0, blocked: true, newStreak,
        blockReason: 'Weight dropped below minimum threshold',
      };
    }
    return { newWeight: Math.max(newWeight, MIN_WEIGHT), blocked: false, newStreak };
  }
}

// Settle a team leg by looking up final scores from game logs
async function settleTeamLeg(
  supabase: any,
  leg: BotLeg,
  parlayDate: string
): Promise<{ outcome: string; actual_value: number | null }> {
  const homeTeam = leg.home_team;
  const awayTeam = leg.away_team;
  
  if (!homeTeam || !awayTeam) {
    return { outcome: 'no_data', actual_value: null };
  }

  // Query game logs for players on these teams to aggregate scores
  // Search in a 3-day window around parlay date
  // Try both NBA and NCAAB tables
  const windowEnd = new Date(parlayDate + 'T12:00:00Z');
  windowEnd.setDate(windowEnd.getDate() + 2);
  const windowEndStr = windowEnd.toISOString().split('T')[0];

  // Detect sport from leg data (default to NBA)
  const legSport = (leg as any).sport || '';
  const isNCAAB = legSport.includes('ncaab') || legSport.includes('college');
  const logTable = isNCAAB ? 'ncaab_player_game_logs' : 'nba_player_game_logs';

  const { data: homeLogs } = await supabase
    .from(logTable)
    .select('points, game_date, team')
    .ilike('team', `%${homeTeam}%`)
    .gte('game_date', parlayDate)
    .lte('game_date', windowEndStr)
    .limit(20);

  const { data: awayLogs } = await supabase
    .from(logTable)
    .select('points, game_date, team')
    .ilike('team', `%${awayTeam}%`)
    .gte('game_date', parlayDate)
    .lte('game_date', windowEndStr)
    .limit(20);

  // If NCAAB returned no data, fallback to NBA table (and vice versa)
  let homeLogsResult = homeLogs;
  let awayLogsResult = awayLogs;
  if ((!homeLogs || homeLogs.length === 0) && (!awayLogs || awayLogs.length === 0)) {
    const fallbackTable = isNCAAB ? 'nba_player_game_logs' : 'ncaab_player_game_logs';
    const { data: fbHome } = await supabase
      .from(fallbackTable)
      .select('points, game_date, team')
      .ilike('team', `%${homeTeam}%`)
      .gte('game_date', parlayDate)
      .lte('game_date', windowEndStr)
      .limit(20);
    const { data: fbAway } = await supabase
      .from(fallbackTable)
      .select('points, game_date, team')
      .ilike('team', `%${awayTeam}%`)
      .gte('game_date', parlayDate)
      .lte('game_date', windowEndStr)
      .limit(20);
    homeLogsResult = fbHome;
    awayLogsResult = fbAway;
  }

  if ((!homeLogsResult || homeLogsResult.length === 0) && (!awayLogsResult || awayLogsResult.length === 0)) {
    return { outcome: 'no_data', actual_value: null };
  }

  // Sum points per team from individual player logs
  const homeScore = (homeLogsResult || []).reduce((sum: number, log: any) => sum + (Number(log.points) || 0), 0);
  const awayScore = (awayLogsResult || []).reduce((sum: number, log: any) => sum + (Number(log.points) || 0), 0);

  if (homeScore === 0 && awayScore === 0) {
    return { outcome: 'no_data', actual_value: null };
  }

  const betType = leg.bet_type || leg.prop_type || '';
  const side = (leg.side || '').toLowerCase();
  const line = leg.line || 0;

  // Total
  if (betType === 'total' || leg.category === 'OVER_TOTAL' || leg.category === 'UNDER_TOTAL') {
    const combinedScore = homeScore + awayScore;
    if (combinedScore === line) return { outcome: 'push', actual_value: combinedScore };
    if (side === 'over' || side === 'o' || leg.category === 'OVER_TOTAL') {
      return { outcome: combinedScore > line ? 'hit' : 'miss', actual_value: combinedScore };
    }
    return { outcome: combinedScore < line ? 'hit' : 'miss', actual_value: combinedScore };
  }

  // Spread
  if (betType === 'spread' || leg.category === 'SHARP_SPREAD') {
    const margin = homeScore - awayScore;
    const actualMargin = side === 'away' ? -margin : margin;
    if (actualMargin + line === 0) return { outcome: 'push', actual_value: margin };
    return { outcome: actualMargin + line > 0 ? 'hit' : 'miss', actual_value: margin };
  }

  // Moneyline
  if (betType === 'moneyline' || leg.category === 'ML_UNDERDOG' || leg.category === 'ML_FAVORITE') {
    if (homeScore === awayScore) return { outcome: 'push', actual_value: 0 };
    const homeWon = homeScore > awayScore;
    if (side === 'home') return { outcome: homeWon ? 'hit' : 'miss', actual_value: homeScore - awayScore };
    return { outcome: !homeWon ? 'hit' : 'miss', actual_value: awayScore - homeScore };
  }

  return { outcome: 'no_data', actual_value: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const todayET = getEasternDate();

    // Accept targetDate and force flag from request body
    let targetDates: string[] = [];
    let forceSettle = false;
    try {
      const body = await req.json();
      if (body.date) {
        targetDates = [body.date];
      }
      if (body.force === true) {
        forceSettle = true;
      }
    } catch {
      // No body - use defaults
    }

    if (targetDates.length === 0) {
      // Only settle PAST dates — not today (games may still be in progress)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(yesterday);
      
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const twoDaysAgoStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(twoDaysAgo);
      
      targetDates = [twoDaysAgoStr, yesterdayStr];
    }

    // Date guard: filter out today's date to prevent premature settlement
    // Skip guard when force=true (for manual triggers after games are done)
    if (!forceSettle) {
      targetDates = targetDates.filter(d => d < todayET);
    }

    if (targetDates.length === 0) {
      console.log('[Bot Settle] All target dates are today or future — skipping settlement');
      return new Response(
        JSON.stringify({ success: true, parlaysSettled: 0, message: 'No past dates to settle' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Bot Settle] Processing parlays for dates: ${targetDates.join(', ')} (today ET: ${todayET})`);

    // NOTE: verify-sweet-spot-outcomes is handled by separate cron — no inline call needed

    // 1. Get pending parlays from target dates
    const { data: pendingParlays, error: parlaysError } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .in('parlay_date', targetDates)
      .eq('outcome', 'pending');

    if (parlaysError) throw parlaysError;

    if (!pendingParlays || pendingParlays.length === 0) {
      console.log('[Bot Settle] No pending parlays to settle');
      return new Response(
        JSON.stringify({ success: true, parlaysSettled: 0, message: 'No pending parlays' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Bot Settle] Found ${pendingParlays.length} pending parlays`);

    // 2. Batch fetch all leg IDs from category_sweet_spots at once
    const allPlayerLegIds: string[] = [];
    for (const parlay of pendingParlays) {
      const legs = (Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs)) as BotLeg[];
      for (const leg of legs) {
        if (!isTeamLeg(leg) && leg.id) {
          allPlayerLegIds.push(leg.id);
        }
      }
    }

    // Batch query for all player leg outcomes at once
    const sweetSpotMap = new Map<string, { outcome: string; actual_value: number | null }>();
    if (allPlayerLegIds.length > 0) {
      // Supabase IN filter supports up to ~1000 items, chunk if needed
      const chunks = [];
      for (let i = 0; i < allPlayerLegIds.length; i += 500) {
        chunks.push(allPlayerLegIds.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        const { data: sweetSpots } = await supabase
          .from('category_sweet_spots')
          .select('id, outcome, actual_value')
          .in('id', chunk);
        
        if (sweetSpots) {
          for (const ss of sweetSpots) {
            sweetSpotMap.set(ss.id, { outcome: ss.outcome, actual_value: ss.actual_value });
          }
        }
      }
    }

    console.log(`[Bot Settle] Batch loaded ${sweetSpotMap.size} sweet spot outcomes for ${allPlayerLegIds.length} player legs`);

    // 3. Load category weights for learning
    const { data: categoryWeights, error: weightsError } = await supabase
      .from('bot_category_weights')
      .select('*');

    if (weightsError) throw weightsError;

    const weightMap = new Map<string, any>();
    (categoryWeights || []).forEach((w: any) => {
      weightMap.set(w.category, w);
    });

    // 4. Process each parlay — track P&L per parlay_date (not run date)
    let parlaysSettled = 0;
    let parlaysWon = 0;
    let parlaysLost = 0;
    let totalProfitLoss = 0;
    const categoryUpdates = new Map<string, { hits: number; misses: number }>();
    // Track P&L per parlay_date for correct date attribution
    const pnlByDate = new Map<string, { won: number; lost: number; profitLoss: number }>();

    for (const parlay of pendingParlays) {
      const legs = (Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs)) as BotLeg[];
      let legsHit = 0;
      let legsMissed = 0;
      let legsVoided = 0;
      const updatedLegs: BotLeg[] = [];

      for (const leg of legs) {
        let legOutcome = 'pending';
        let actualValue: number | null = null;

        if (isTeamLeg(leg)) {
          const teamResult = await settleTeamLeg(supabase, leg, parlay.parlay_date);
          legOutcome = teamResult.outcome;
          actualValue = teamResult.actual_value;
        } else {
          const sweetSpot = sweetSpotMap.get(leg.id);
          if (sweetSpot) {
            if (sweetSpot.outcome === 'hit') {
              legOutcome = 'hit';
            } else if (sweetSpot.outcome === 'miss') {
              legOutcome = 'miss';
            } else if (sweetSpot.outcome === 'no_data') {
              legOutcome = 'void';
            } else {
              legOutcome = 'pending';
            }
            actualValue = sweetSpot.actual_value;
          }
        }

        if (legOutcome === 'hit') legsHit++;
        else if (legOutcome === 'miss') legsMissed++;
        else if (legOutcome === 'void' || legOutcome === 'no_data') legsVoided++;

        updatedLegs.push({ ...leg, outcome: legOutcome, actual_value: actualValue ?? undefined });

        if ((legOutcome === 'hit' || legOutcome === 'miss') && leg.category) {
          const existing = categoryUpdates.get(leg.category) || { hits: 0, misses: 0 };
          if (legOutcome === 'hit') existing.hits++;
          else existing.misses++;
          categoryUpdates.set(leg.category, existing);
        }
      }

      const activeLegCount = legs.length - legsVoided;
      let outcome = 'pending';
      let profitLoss = 0;
      
      if (activeLegCount === 0 || legsVoided > legs.length / 2) {
        outcome = 'void';
        parlaysSettled++;
      } else if (legsHit + legsMissed === activeLegCount) {
        if (legsMissed === 0) {
          outcome = 'won';
          const odds = parlay.expected_odds || 500;
          const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
          const payout = (parlay.simulated_stake || 10) * decimalOdds;
          profitLoss = payout - (parlay.simulated_stake || 10);
          parlaysWon++;
        } else {
          outcome = 'lost';
          profitLoss = -(parlay.simulated_stake || 10);
          parlaysLost++;
        }
        parlaysSettled++;
        totalProfitLoss += profitLoss;
      }

      // Accumulate P&L under the parlay's own date, not the run date
      if (outcome === 'won' || outcome === 'lost') {
        const dateKey = parlay.parlay_date;
        const existing = pnlByDate.get(dateKey) || { won: 0, lost: 0, profitLoss: 0 };
        if (outcome === 'won') existing.won++;
        else existing.lost++;
        existing.profitLoss += profitLoss;
        pnlByDate.set(dateKey, existing);
      }

      await supabase
        .from('bot_daily_parlays')
        .update({
          legs: updatedLegs,
          outcome,
          legs_hit: legsHit,
          legs_missed: legsMissed,
          profit_loss: profitLoss,
          simulated_payout: outcome === 'won' ? profitLoss + (parlay.simulated_stake || 10) : (outcome === 'lost' ? 0 : null),
          settled_at: outcome !== 'pending' ? new Date().toISOString() : null,
        })
        .eq('id', parlay.id);
    }

    console.log(`[Bot Settle] Settled ${parlaysSettled} parlays (${parlaysWon}W ${parlaysLost}L)`);
    console.log(`[Bot Settle] P&L by date: ${JSON.stringify(Object.fromEntries(pnlByDate))}`);

    // 5. Update category weights based on outcomes
    const weightChanges: Array<{ category: string; oldWeight: number; newWeight: number; delta: number }> = [];
    
    for (const [category, stats] of categoryUpdates) {
      const existing = weightMap.get(category);
      if (!existing) continue;

      const oldWeight = existing.weight;
      let currentWeight = existing.weight;
      let currentStreak = existing.current_streak;

      for (let i = 0; i < stats.hits; i++) {
        const result = adjustWeight(currentWeight, true, currentStreak);
        currentWeight = result.newWeight;
        currentStreak = result.newStreak;
      }

      for (let i = 0; i < stats.misses; i++) {
        const result = adjustWeight(currentWeight, false, currentStreak);
        currentWeight = result.newWeight;
        currentStreak = result.newStreak;
      }

      if (currentWeight !== oldWeight) {
        weightChanges.push({ category, oldWeight, newWeight: currentWeight, delta: currentWeight - oldWeight });
      }

      await supabase
        .from('bot_category_weights')
        .update({
          weight: currentWeight,
          is_blocked: currentWeight === 0,
          block_reason: currentWeight === 0 ? 'Weight dropped below threshold' : null,
          current_streak: currentStreak,
          best_streak: Math.max(existing.best_streak || 0, currentStreak > 0 ? currentStreak : 0),
          worst_streak: Math.min(existing.worst_streak || 0, currentStreak < 0 ? currentStreak : 0),
          total_picks: (existing.total_picks || 0) + stats.hits + stats.misses,
          total_hits: (existing.total_hits || 0) + stats.hits,
          current_hit_rate: ((existing.total_hits || 0) + stats.hits) / 
                           ((existing.total_picks || 0) + stats.hits + stats.misses) * 100,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    }

    // 6. Update activation status — write P&L to each parlay_date, not today
    // This ensures Feb 9 parlays settled on Feb 10 show up on Feb 9 in the calendar
    let isProfitableDay = false;
    let newConsecutive = 0;
    let isRealModeReady = false;
    let newBankroll = 0;

    // Process each date that had settlements
    const datesToProcess = pnlByDate.size > 0 ? [...pnlByDate.keys()] : [];

    for (const dateKey of datesToProcess) {
      const datePnL = pnlByDate.get(dateKey)!;
      
      // Get the previous day's status for bankroll chaining
      const { data: prevStatus } = await supabase
        .from('bot_activation_status')
        .select('*')
        .lt('check_date', dateKey)
        .order('check_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevConsecutive = prevStatus?.consecutive_profitable_days || 0;
      const prevBankroll = prevStatus?.simulated_bankroll || 1000;

      // Check if there's already an entry for this date
      const { data: existingEntry } = await supabase
        .from('bot_activation_status')
        .select('*')
        .eq('check_date', dateKey)
        .maybeSingle();

      // Accumulate P&L across multiple runs
      const accumulatedPnL = (existingEntry?.daily_profit_loss || 0) + datePnL.profitLoss;
      const accumulatedWon = (existingEntry?.parlays_won || 0) + datePnL.won;
      const accumulatedLost = (existingEntry?.parlays_lost || 0) + datePnL.lost;
      const accumulatedBankroll = existingEntry 
        ? (existingEntry.simulated_bankroll || prevBankroll) + datePnL.profitLoss
        : prevBankroll + datePnL.profitLoss;
      const dateIsProfitable = accumulatedPnL > 0;
      const dateConsecutive = dateIsProfitable ? prevConsecutive + 1 : 0;
      const dateIsRealModeReady = dateConsecutive >= 3 && 
                              (accumulatedWon / Math.max(1, accumulatedWon + accumulatedLost)) >= 0.60;

      if (existingEntry) {
        await supabase
          .from('bot_activation_status')
          .update({
            parlays_won: accumulatedWon,
            parlays_lost: accumulatedLost,
            daily_profit_loss: accumulatedPnL,
            is_profitable_day: dateIsProfitable,
            consecutive_profitable_days: dateConsecutive,
            is_real_mode_ready: dateIsRealModeReady,
            simulated_bankroll: accumulatedBankroll,
            activated_at: dateIsRealModeReady && !existingEntry.is_real_mode_ready 
              ? new Date().toISOString() 
              : existingEntry.activated_at,
          })
          .eq('id', existingEntry.id);
      } else {
        await supabase
          .from('bot_activation_status')
          .insert({
            check_date: dateKey,
            parlays_won: datePnL.won,
            parlays_lost: datePnL.lost,
            daily_profit_loss: datePnL.profitLoss,
            is_profitable_day: datePnL.profitLoss > 0,
            consecutive_profitable_days: datePnL.profitLoss > 0 ? prevConsecutive + 1 : 0,
            is_real_mode_ready: dateIsRealModeReady,
            simulated_bankroll: prevBankroll + datePnL.profitLoss,
            activated_at: dateIsRealModeReady ? new Date().toISOString() : null,
          });
      }

      // Track latest values for Telegram notification
      isProfitableDay = dateIsProfitable;
      newConsecutive = dateConsecutive;
      isRealModeReady = dateIsRealModeReady;
      newBankroll = accumulatedBankroll;
    }

    // If no dates had settlements, still set defaults for downstream
    if (datesToProcess.length === 0) {
      const { data: latestStatus } = await supabase
        .from('bot_activation_status')
        .select('*')
        .order('check_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      newBankroll = latestStatus?.simulated_bankroll || 1000;
      newConsecutive = latestStatus?.consecutive_profitable_days || 0;
      isRealModeReady = latestStatus?.is_real_mode_ready || false;
    }

    // 7. Update strategy performance
    if (parlaysSettled > 0) {
      const { data: strategy } = await supabase
        .from('bot_strategies')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (strategy) {
        const newTimesWon = (strategy.times_won || 0) + parlaysWon;
        const newTimesUsed = strategy.times_used || 0;
        const newWinRate = newTimesUsed > 0 ? newTimesWon / newTimesUsed : 0;

        await supabase
          .from('bot_strategies')
          .update({
            times_won: newTimesWon,
            win_rate: newWinRate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', strategy.id);
      }
    }

    console.log(`[Bot Settle] Complete. P/L: $${totalProfitLoss}, Consecutive: ${newConsecutive}`);

    // 8. Sync weights from recently settled category_sweet_spots (last 24h)
    let sweetSpotSynced = 0;
    try {
      const yesterday24h = new Date();
      yesterday24h.setHours(yesterday24h.getHours() - 24);
      
      const { data: recentOutcomes, error: recentError } = await supabase
        .from('category_sweet_spots')
        .select('category, recommended_side, outcome, settled_at')
        .gte('settled_at', yesterday24h.toISOString())
        .not('outcome', 'is', null);

      if (!recentError && recentOutcomes && recentOutcomes.length > 0) {
        const outcomeMap = new Map<string, { hits: number; misses: number }>();
        
        for (const outcome of recentOutcomes as RecentOutcome[]) {
          const key = `${outcome.category}__${outcome.recommended_side || 'over'}`;
          let stats = outcomeMap.get(key);
          if (!stats) {
            stats = { hits: 0, misses: 0 };
            outcomeMap.set(key, stats);
          }
          if (outcome.outcome === 'hit') stats.hits++;
          else if (outcome.outcome === 'miss') stats.misses++;
        }

        for (const [key, stats] of outcomeMap) {
          const [category, side] = key.split('__');
          
          const { data: existingWeight } = await supabase
            .from('bot_category_weights')
            .select('*')
            .eq('category', category)
            .eq('side', side)
            .maybeSingle();

          if (existingWeight && !existingWeight.is_blocked) {
            let currentWeight = existingWeight.weight || 1.0;
            let currentStreak = existingWeight.current_streak || 0;
            let blocked = false;
            let blockReason: string | null = null;

            for (let i = 0; i < stats.hits; i++) {
              const result = adjustWeight(currentWeight, true, currentStreak);
              currentWeight = result.newWeight;
              currentStreak = result.newStreak;
            }

            for (let i = 0; i < stats.misses; i++) {
              const result = adjustWeight(currentWeight, false, currentStreak);
              currentWeight = result.newWeight;
              currentStreak = result.newStreak;
              if (result.blocked) {
                blocked = true;
                blockReason = result.blockReason || 'Weight dropped below threshold';
              }
            }

            const newTotalPicks = (existingWeight.total_picks || 0) + stats.hits + stats.misses;
            const newTotalHits = (existingWeight.total_hits || 0) + stats.hits;
            const newHitRate = newTotalPicks > 0 ? (newTotalHits / newTotalPicks) * 100 : 0;

            if (newTotalPicks >= BLOCK_MIN_SAMPLES && newHitRate < BLOCK_HIT_RATE_THRESHOLD) {
              blocked = true;
              blockReason = `Hit rate ${newHitRate.toFixed(1)}% below ${BLOCK_HIT_RATE_THRESHOLD}% with ${newTotalPicks} samples`;
              currentWeight = 0;
            }

            await supabase
              .from('bot_category_weights')
              .update({
                weight: currentWeight,
                is_blocked: blocked,
                block_reason: blockReason,
                current_streak: currentStreak,
                best_streak: Math.max(existingWeight.best_streak || 0, currentStreak > 0 ? currentStreak : 0),
                worst_streak: Math.min(existingWeight.worst_streak || 0, currentStreak < 0 ? currentStreak : 0),
                total_picks: newTotalPicks,
                total_hits: newTotalHits,
                current_hit_rate: newHitRate,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingWeight.id);

            sweetSpotSynced++;
          }
        }
        
        console.log(`[Bot Settle] Synced ${sweetSpotSynced} categories from ${recentOutcomes.length} sweet spot outcomes`);
      }
    } catch (syncError) {
      console.error('[Bot Settle] Sweet spot sync error:', syncError);
    }

    // 9. Trigger calibration
    try {
      await fetch(`${supabaseUrl}/functions/v1/calibrate-bot-weights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ fullRebuild: false }),
      });
      console.log('[Bot Settle] Calibration triggered');
    } catch (calibrateError) {
      console.error('[Bot Settle] Calibration trigger failed:', calibrateError);
    }

    // 10. Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'settlement_complete',
      message: `Settled ${parlaysSettled} parlays: ${parlaysWon}W ${parlaysLost}L | Synced ${sweetSpotSynced} categories`,
      metadata: { 
        parlaysWon,
        parlaysLost,
        totalProfitLoss,
        consecutiveDays: newConsecutive,
        isRealModeReady,
        newBankroll,
        sweetSpotSynced,
        categoryUpdates: Array.from(categoryUpdates.entries()).map(([cat, stats]) => ({
          category: cat, hits: stats.hits, misses: stats.misses,
        })),
      },
      severity: isProfitableDay ? 'success' : 'warning',
    });

    // 11. Gather strategy info and send Telegram
    let activeStrategyName: string | undefined;
    let activeStrategyWinRate: number | undefined;
    let blockedCategories: string[] = [];

    try {
      const { data: activeStrategy } = await supabase
        .from('bot_strategies')
        .select('strategy_name, win_rate')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (activeStrategy) {
        activeStrategyName = activeStrategy.strategy_name;
        activeStrategyWinRate = activeStrategy.win_rate ?? undefined;
      }

      const { data: blockedRows } = await supabase
        .from('bot_category_weights')
        .select('category, side')
        .eq('is_blocked', true)
        .limit(10);

      if (blockedRows) {
        blockedCategories = blockedRows.map(r => `${r.category}_${r.side}`);
      }
    } catch (stratError) {
      console.error('[Bot Settle] Strategy/blocked query error:', stratError);
    }

    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: isRealModeReady ? 'activation_ready' : 'settlement_complete',
          data: {
            parlaysWon,
            parlaysLost,
            profitLoss: totalProfitLoss,
            consecutiveDays: newConsecutive,
            bankroll: newBankroll,
            isRealModeReady,
            sweetSpotSynced,
            winRate: parlaysWon + parlaysLost > 0 
              ? Math.round((parlaysWon / (parlaysWon + parlaysLost)) * 100) 
              : 0,
            weightChanges,
            strategyName: activeStrategyName,
            strategyWinRate: activeStrategyWinRate,
            blockedCategories,
          },
        }),
      });
      console.log('[Bot Settle] Telegram notification sent');
    } catch (telegramError) {
      console.error('[Bot Settle] Telegram notification failed:', telegramError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        parlaysSettled,
        parlaysWon,
        parlaysLost,
        totalProfitLoss,
        isProfitableDay,
        consecutiveProfitDays: newConsecutive,
        isRealModeReady,
        newBankroll,
        sweetSpotSynced,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Bot Settle] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

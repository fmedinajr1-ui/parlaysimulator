/**
 * bot-curated-pipeline
 * 
 * Automated version of the manual curation workflow:
 * 1. Query defense rankings for today's games
 * 2. Filter to PRIME targets (rank 20-30)
 * 3. Pull all props for players in those matchups
 * 4. Cross-reference with multiple engines (sweet spots, mispriced, high-conviction)
 * 5. Stack into 3/5/8/13-leg tickets with SAFE/BALANCED/GREAT_ODDS role assignments
 * 6. Insert into bot_daily_parlays and broadcast via bot-send-telegram
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function americanToDecimal(odds: number): number {
  if (odds > 0) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function getEasternDateRange(): { today: string; startUtc: string; endUtc: string } {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const [year, month, day] = today.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
  return { today, startUtc: startDate.toISOString(), endUtc: endDate.toISOString() };
}

interface CuratedLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  odds: number;
  l10_hit_rate: number;
  l10_avg: number;
  role: 'SAFE' | 'BALANCED' | 'GREAT_ODDS';
  defense_rank: number | null;
  engine_count: number;
  engines: string[];
  sport: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const broadcast = body.broadcast !== false; // default true
    const { today, startUtc, endUtc } = getEasternDateRange();

    console.log(`[CuratedPipeline] Starting for ${today}`);

    // === STEP 1: Get today's games ===
    const { data: rawGames } = await supabase
      .from('game_bets')
      .select('home_team, away_team, game_id, sport')
      .eq('sport', 'basketball_nba')
      .gte('commence_time', startUtc)
      .lte('commence_time', endUtc);

    const seenEvents = new Set<string>();
    const games = (rawGames || []).filter(g => {
      if (seenEvents.has(g.game_id)) return false;
      seenEvents.add(g.game_id);
      return true;
    });
    console.log(`[CuratedPipeline] Found ${games.length} NBA games`);

    if (games.length === 0) {
      return new Response(JSON.stringify({ success: false, reason: 'No games today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === STEP 2: Load defense rankings ===
    const { data: defenseData } = await supabase
      .from('team_defense_rankings')
      .select('team_abbreviation, overall_rank, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank')
      .eq('is_current', true);

    const defenseMap = new Map<string, any>();
    for (const row of (defenseData || [])) {
      defenseMap.set((row.team_abbreviation || '').toUpperCase(), row);
    }

    // === STEP 3: Load sweet spots (engine 1) ===
    const { data: sweetSpots } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_line, recommended_side, l10_hit_rate, l10_avg, confidence_score, actual_line, bookmaker, l3_avg')
      .eq('is_active', true)
      .eq('analysis_date', today);

    // === STEP 4: Load mispriced lines (engine 2) ===
    const { data: mispricedLines } = await supabase
      .from('mispriced_lines')
      .select('player_name, prop_type, book_line, signal, edge_pct, player_avg_l10, confidence_tier, over_price, under_price')
      .eq('scan_date', today);

    // === STEP 5: Load high conviction results (engine 3) ===
    const { data: convictionResults } = await supabase
      .from('high_conviction_results')
      .select('player_name, prop_type, signal, edge_pct, conviction_score, current_line, player_avg, engines')
      .eq('analysis_date', today);

    // === STEP 6: Load unified props for live odds ===
    const { data: unifiedProps } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, over_price, under_price, l10_avg, l10_hit_rate')
      .eq('is_active', true)
      .gte('updated_at', startUtc);

    console.log(`[CuratedPipeline] Data loaded: ${(sweetSpots || []).length} sweet spots, ${(mispricedLines || []).length} mispriced, ${(convictionResults || []).length} conviction, ${(unifiedProps || []).length} unified props`);

    // === STEP 7: Build multi-engine player map ===
    const playerMap = new Map<string, {
      engines: Set<string>;
      bestHitRate: number;
      bestLine: number;
      bestSide: string;
      bestOdds: number;
      l10Avg: number;
      defenseRank: number | null;
      propType: string;
    }>();

    const normalizeKey = (name: string, prop: string) =>
      `${name.toLowerCase().replace(/[^a-z ]/g, '').trim()}|${prop.toLowerCase().replace('player_', '')}`;

    // Sweet spots
    for (const ss of (sweetSpots || [])) {
      // v11.0: Universal recency decline filter — block NULL L3 picks
      const l3Avg = ss.l3_avg ?? null;
      const l10Avg = ss.l10_avg || 0;
      const recSide = (ss.recommended_side || 'over').toLowerCase();
      if (l3Avg === null) {
        console.log(`[L3Gate] Skipped ${ss.player_name} ${ss.prop_type}: no L3 data`);
        continue;
      }
      if (l10Avg > 0) {
        const declineRatio = l3Avg / l10Avg;
        if (recSide === 'over' && declineRatio < 0.75) continue;
        if (recSide === 'under' && declineRatio > 1.25) continue;
      }

      const key = normalizeKey(ss.player_name, ss.prop_type);
      const hr = (ss.l10_hit_rate || 0) <= 1 ? (ss.l10_hit_rate || 0) * 100 : (ss.l10_hit_rate || 0);
      const existing = playerMap.get(key) || {
        engines: new Set<string>(), bestHitRate: 0, bestLine: 0, bestSide: 'over',
        bestOdds: -110, l10Avg: 0, defenseRank: null, propType: ss.prop_type,
      };
      existing.engines.add('sweet_spot');
      if (hr > existing.bestHitRate) {
        existing.bestHitRate = hr;
        existing.bestLine = ss.recommended_line || ss.actual_line || 0;
        existing.bestSide = recSide;
        existing.l10Avg = l10Avg;
      }
      playerMap.set(key, existing);
    }

    // Mispriced lines
    for (const ml of (mispricedLines || [])) {
      const propClean = (ml.prop_type || '').replace('player_', '');
      const key = normalizeKey(ml.player_name, propClean);
      const existing = playerMap.get(key) || {
        engines: new Set<string>(), bestHitRate: 0, bestLine: 0, bestSide: 'over',
        bestOdds: -110, l10Avg: 0, defenseRank: null, propType: propClean,
      };
      existing.engines.add('mispriced');
      if (!existing.bestLine) {
        existing.bestLine = ml.book_line || 0;
        existing.bestSide = (ml.signal || 'OVER').toLowerCase();
        existing.l10Avg = ml.player_avg_l10 || 0;
      }
      const odds = existing.bestSide === 'over' ? (ml.over_price || -110) : (ml.under_price || -110);
      if (odds) existing.bestOdds = odds;
      playerMap.set(key, existing);
    }

    // High conviction
    for (const hc of (convictionResults || [])) {
      const propClean = (hc.prop_type || '').replace('player_', '');
      const key = normalizeKey(hc.player_name, propClean);
      const existing = playerMap.get(key) || {
        engines: new Set<string>(), bestHitRate: 0, bestLine: 0, bestSide: 'over',
        bestOdds: -110, l10Avg: 0, defenseRank: null, propType: propClean,
      };
      existing.engines.add('high_conviction');
      if (!existing.bestLine) {
        existing.bestLine = hc.current_line || 0;
        existing.bestSide = (hc.signal || 'OVER').toLowerCase();
        existing.l10Avg = hc.player_avg || 0;
      }
      playerMap.set(key, existing);
    }

    // Enrich with unified props (live odds + L10 data)
    for (const up of (unifiedProps || [])) {
      const propClean = (up.prop_type || '').replace('player_', '');
      const key = normalizeKey(up.player_name, propClean);
      const existing = playerMap.get(key);
      if (!existing) continue;
      existing.engines.add('unified_props');
      const hr = (up.l10_hit_rate || 0) <= 1 ? (up.l10_hit_rate || 0) * 100 : (up.l10_hit_rate || 0);
      if (hr > existing.bestHitRate) existing.bestHitRate = hr;
      if (up.l10_avg) existing.l10Avg = up.l10_avg;
      if (up.current_line) existing.bestLine = up.current_line;
      const odds = existing.bestSide === 'over' ? (up.over_price || -110) : (up.under_price || -110);
      if (odds) existing.bestOdds = odds;
    }

    // === MINUTES VOLATILITY GATE ===
    const curatedPlayerNames = [...new Set([...playerMap.keys()].map(k => k.split('|')[0]))];
    const curVolMap = new Map<string, { isVolatile: boolean; cv: number; avgMin: number }>();
    if (curatedPlayerNames.length > 0) {
      const { data: curMinLogs } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, min')
        .in('player_name', curatedPlayerNames.map(n => n.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')))
        .order('game_date', { ascending: false })
        .limit(curatedPlayerNames.length * 10);

      const curMinByPlayer = new Map<string, number[]>();
      for (const row of (curMinLogs || [])) {
        const name = (row.player_name || '').toLowerCase().trim();
        if (!name) continue;
        const mins = typeof row.min === 'string' ? parseFloat(row.min) : (row.min ? parseFloat(String(row.min)) : 0);
        if (mins <= 0) continue;
        const existing = curMinByPlayer.get(name) || [];
        if (existing.length < 10) { existing.push(mins); curMinByPlayer.set(name, existing); }
      }

      for (const [name, minutes] of curMinByPlayer) {
        if (minutes.length < 3) continue;
        const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
        const variance = minutes.reduce((s, m) => s + (m - avg) ** 2, 0) / minutes.length;
        const cv = Math.sqrt(variance) / (avg || 1);
        curVolMap.set(name, { isVolatile: cv > 0.20, cv, avgMin: avg });
      }
      const curVolCount = [...curVolMap.values()].filter(v => v.isVolatile).length;
      console.log(`[CuratedPipeline] Minutes volatility: ${curVolMap.size} players, ${curVolCount} volatile (CV>20%)`);
    }

    // === STEP 8: Filter to multi-engine consensus picks with 65%+ L10 ===
    const curatedLegs: CuratedLeg[] = [];

    for (const [key, data] of playerMap) {
      // Require at least 2 engines
      if (data.engines.size < 2) continue;
      // Require 65%+ L10 hit rate
      if (data.bestHitRate < 65) continue;
      // Require a valid line
      if (!data.bestLine) continue;

      const [playerName] = key.split('|');
      const displayName = playerName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      // Minutes volatility penalty: reduce effective hit rate for volatile players
      const vol = curVolMap.get(playerName.toLowerCase().trim());
      if (vol?.isVolatile) {
        // Apply -5% hit rate penalty for volatile players — may push them below threshold
        const penalizedRate = data.bestHitRate - 5;
        if (penalizedRate < 65) {
          console.log(`[CuratedPipeline] ⚠️ VOLATILE SKIP: ${displayName} — ${data.bestHitRate.toFixed(0)}% HR penalized to ${penalizedRate.toFixed(0)}% (CV ${(vol.cv * 100).toFixed(0)}%)`);
          continue;
        }
      }

      // Assign role
      let role: 'SAFE' | 'BALANCED' | 'GREAT_ODDS' = 'BALANCED';
      if (data.bestHitRate >= 80) role = 'SAFE';
      else if (data.bestOdds >= 120) role = 'GREAT_ODDS';
      else if (data.bestHitRate >= 70) role = 'SAFE';

      curatedLegs.push({
        player_name: displayName,
        prop_type: data.propType,
        line: data.bestLine,
        side: data.bestSide,
        odds: data.bestOdds,
        l10_hit_rate: data.bestHitRate,
        l10_avg: data.l10Avg,
        role,
        defense_rank: data.defenseRank,
        engine_count: data.engines.size,
        engines: Array.from(data.engines),
        sport: 'basketball_nba',
      });
    }

    // Sort by engine count (desc), then hit rate (desc)
    curatedLegs.sort((a, b) => {
      if (b.engine_count !== a.engine_count) return b.engine_count - a.engine_count;
      return b.l10_hit_rate - a.l10_hit_rate;
    });

    console.log(`[CuratedPipeline] Curated ${curatedLegs.length} multi-engine consensus legs (2+ engines, 65%+ L10)`);

    if (curatedLegs.length < 3) {
      console.log(`[CuratedPipeline] Not enough curated legs (${curatedLegs.length}), aborting`);
      return new Response(JSON.stringify({
        success: false,
        reason: `Only ${curatedLegs.length} legs passed curation filters`,
        legs: curatedLegs,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // === STEP 9: Build tickets (3/5/8/13-leg) ===
    const tickets: any[] = [];
    const buildTicket = (legCount: number, tier: string, label: string) => {
      if (curatedLegs.length < legCount) return;
      const selected = curatedLegs.slice(0, legCount);
      const legs = selected.map((leg, idx) => ({
        leg_number: idx + 1,
        player_name: leg.player_name,
        prop_type: leg.prop_type,
        side: leg.side,
        line: leg.line,
        odds: leg.odds,
        l10_hit_rate: leg.l10_hit_rate,
        l10_avg: leg.l10_avg,
        leg_role: leg.role,
        engine_count: leg.engine_count,
        engines: leg.engines,
        outcome: 'pending',
      }));

      const combinedDecimal = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
      const combinedAmerican = decimalToAmerican(combinedDecimal);
      const stake = tier === 'standard' ? 10 : tier === 'mid_tier' ? 10 : tier === 'high_roller' ? 5 : 2;
      const payout = Math.round(stake * combinedDecimal);

      tickets.push({
        parlay_date: today,
        strategy_name: 'curated_pipeline',
        tier,
        leg_count: legs.length,
        legs,
        expected_odds: combinedAmerican,
        combined_probability: 1 / combinedDecimal,
        simulated_stake: stake,
        simulated_payout: payout,
        profit_loss: null,
        outcome: 'pending',
        approval_status: 'approved',
        is_simulated: true,
        selection_rationale: `${label}: ${legs.length}-leg curated pipeline | ${legs.map(l => `${l.player_name} ${l.side.toUpperCase()} ${l.line} ${l.prop_type}`).join(', ')}`,
      });

      console.log(`[CuratedPipeline] ✅ ${label}: ${legs.length} legs | +${combinedAmerican} | $${stake} → $${payout}`);
    };

    buildTicket(3, 'standard', 'Standard');
    buildTicket(5, 'mid_tier', 'Mid-Tier');
    buildTicket(8, 'high_roller', 'High Roller');
    buildTicket(Math.min(curatedLegs.length, 13), 'mega_jackpot', 'Mega Jackpot');

    // === STEP 10: Insert tickets ===
    const { data: inserted, error: insertError } = await supabase
      .from('bot_daily_parlays')
      .insert(tickets)
      .select('id, tier, expected_odds, leg_count, simulated_stake, simulated_payout, legs');

    if (insertError) throw insertError;
    console.log(`[CuratedPipeline] Inserted ${inserted.length} tickets`);

    // === STEP 11: Broadcast via Telegram ===
    if (broadcast && inserted.length > 0) {
      const telegramTickets = inserted.map((row: any) => {
        const legs = Array.isArray(row.legs) ? row.legs : [];
        return {
          tier: row.tier,
          combinedOdds: Math.abs(row.expected_odds),
          stake: row.simulated_stake,
          payout: row.simulated_payout,
          legs: legs.map((leg: any, idx: number) => ({
            leg: idx + 1,
            player: leg.player_name,
            side: (leg.side || 'over').toUpperCase().charAt(0),
            line: leg.line,
            prop: (leg.prop_type || '').replace('player_', ''),
            odds: leg.odds > 0 ? `+${leg.odds}` : `${leg.odds}`,
            market_type: 'player_prop',
            l10_hit_rate: leg.l10_hit_rate,
            engine_count: leg.engine_count,
          })),
        };
      });

      const telegramPayload = {
        type: 'mega_lottery_v2',
        data: {
          date: today,
          ticketCount: inserted.length,
          scanned: `${curatedLegs.length} curated`,
          events: `${games.length} NBA games`,
          exoticProps: 0,
          teamBets: 0,
          tickets: telegramTickets,
        },
      };

      const telegramResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(telegramPayload),
      });

      const telegramResult = await telegramResp.json();
      console.log(`[CuratedPipeline] Telegram broadcast:`, telegramResult);
    }

    return new Response(JSON.stringify({
      success: true,
      date: today,
      curatedLegsTotal: curatedLegs.length,
      ticketsCreated: inserted.length,
      tickets: inserted.map((r: any) => ({
        id: r.id,
        tier: r.tier,
        odds: r.expected_odds,
        legs: r.leg_count,
        stake: r.simulated_stake,
        payout: r.simulated_payout,
      })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[CuratedPipeline] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

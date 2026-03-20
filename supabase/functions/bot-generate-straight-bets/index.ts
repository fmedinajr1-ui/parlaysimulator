/**
 * bot-generate-straight-bets — Individual pick generator
 * 
 * Queries sweet spot / unified props pool and generates individual straight bets
 * for picks with high L10 hit rates. Sends Telegram broadcast.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const PROP_LABELS: Record<string, string> = {
  threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
  steals: 'STL', blocks: 'BLK', turnovers: 'TO', pra: 'PRA',
  pts_rebs: 'P+R', pts_asts: 'P+A', rebs_asts: 'R+A',
  three_pointers_made: '3PT', player_points: 'PTS', player_rebounds: 'REB',
  player_assists: 'AST', player_threes: '3PT',
};

/**
 * Kelly Criterion staking: stake = bankroll × (hit_rate × 1.91 - 1) / 0.91
 * Capped at 5% of bankroll, floored at $25
 */
function getKellyStake(hitRate: number, bankroll: number): number {
  const p = hitRate / 100;
  const edge = (p * 1.91 - 1) / 0.91; // Kelly fraction at -110 odds
  if (edge <= 0) return 25; // minimum bet even with thin edge
  const raw = bankroll * edge * 0.5; // half-Kelly for safety
  const capped = Math.min(raw, bankroll * 0.05); // max 5% of bankroll
  return Math.max(25, Math.round(capped));
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
    const today = body.date || getEasternDate();
    const minHitRate = body.min_hit_rate ?? 70;
    const maxPicks = body.max_picks ?? 15;
    const bankroll = body.bankroll ?? 5000; // default bankroll for Kelly sizing

    console.log(`[StraightBets] Generating for ${today} | minHitRate=${minHitRate} | maxPicks=${maxPicks} | bankroll=${bankroll}`);

    console.log(`[StraightBets] Generating for ${today} | minHitRate=${minHitRate} | maxPicks=${maxPicks}`);

    // Check for existing straight bets today
    const { count: existing } = await supabase
      .from('bot_straight_bets')
      .select('*', { count: 'exact', head: true })
      .eq('bet_date', today);

    if ((existing || 0) > 0) {
      console.log(`[StraightBets] Already generated ${existing} bets for ${today}`);
      return new Response(JSON.stringify({ success: true, message: `Already generated ${existing} bets`, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Query sweet spots with high hit rates
    const { data: sweetSpots, error: ssErr } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_line, recommended_side, l10_hit_rate, confidence_score, l10_avg, category')
      .eq('is_active', true)
      .eq('analysis_date', today)
      .gte('l10_hit_rate', minHitRate / 100)
      .not('recommended_line', 'is', null)
      .order('l10_hit_rate', { ascending: false });

    if (ssErr) throw ssErr;

    // Also check daily pick pool
    const { data: poolPicks, error: poolErr } = await supabase
      .from('bot_daily_pick_pool')
      .select('player_name, prop_type, recommended_line, recommended_side, l10_hit_rate, composite_score')
      .eq('pick_date', today)
      .gte('l10_hit_rate', minHitRate)
      .order('l10_hit_rate', { ascending: false });

    if (poolErr) throw poolErr;

    // Combine and deduplicate by player+prop
    const seen = new Set<string>();
    const candidates: Array<{
      player_name: string;
      prop_type: string;
      line: number;
      side: string;
      l10_hit_rate: number;
      composite_score: number;
      source: string;
    }> = [];

    for (const ss of (sweetSpots || [])) {
      const key = `${ss.player_name}|${ss.prop_type}|${ss.recommended_side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hr = (ss.l10_hit_rate || 0) <= 1 ? (ss.l10_hit_rate || 0) * 100 : (ss.l10_hit_rate || 0);
      candidates.push({
        player_name: ss.player_name,
        prop_type: ss.prop_type,
        line: ss.recommended_line,
        side: ss.recommended_side || 'OVER',
        l10_hit_rate: hr,
        composite_score: ss.confidence_score || 0,
        source: 'sweet_spot',
      });
    }

    for (const pp of (poolPicks || [])) {
      const key = `${pp.player_name}|${pp.prop_type}|${pp.recommended_side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hr = (pp.l10_hit_rate || 0) <= 1 ? (pp.l10_hit_rate || 0) * 100 : (pp.l10_hit_rate || 0);
      candidates.push({
        player_name: pp.player_name,
        prop_type: pp.prop_type,
        line: pp.recommended_line || 0,
        side: pp.recommended_side || 'OVER',
        l10_hit_rate: hr,
        composite_score: pp.composite_score || 0,
        source: 'pick_pool',
      });
    }

    // Sort by hit rate desc, take top N
    candidates.sort((a, b) => b.l10_hit_rate - a.l10_hit_rate);
    const selected = candidates.slice(0, maxPicks);

    if (selected.length === 0) {
      console.log('[StraightBets] No qualifying picks found');
      return new Response(JSON.stringify({ success: true, message: 'No qualifying picks', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert straight bets
    const betsToInsert = selected.map(s => ({
      bet_date: today,
      player_name: s.player_name,
      prop_type: s.prop_type,
      line: s.line,
      side: s.side,
      l10_hit_rate: s.l10_hit_rate,
      composite_score: s.composite_score,
      simulated_stake: getStake(s.l10_hit_rate),
      simulated_payout: Math.round(getStake(s.l10_hit_rate) * 0.91 * 100) / 100, // -110 odds payout
      american_odds: -110,
      source: s.source,
    }));

    const { error: insertErr } = await supabase
      .from('bot_straight_bets')
      .insert(betsToInsert);

    if (insertErr) throw insertErr;

    console.log(`[StraightBets] Inserted ${betsToInsert.length} straight bets`);

    // Build Telegram message
    const totalStake = betsToInsert.reduce((sum, b) => sum + b.simulated_stake, 0);
    let msg = `📊 *STRAIGHT BETS — ${today}*\n`;
    msg += `${betsToInsert.length} picks | $${totalStake} total risk\n\n`;

    for (const b of betsToInsert) {
      const label = PROP_LABELS[b.prop_type] || b.prop_type;
      const arrow = b.side === 'OVER' ? '⬆️' : '⬇️';
      msg += `${arrow} *${b.player_name}* ${b.side} ${b.line} ${label}\n`;
      msg += `   L10: ${b.l10_hit_rate}% | Stake: $${b.simulated_stake}\n`;
    }

    msg += `\n_At 66%+ hit rate, EV = +$${Math.round(totalStake * 0.10)}/day_`;

    // Send via bot-send-telegram
    await supabase.functions.invoke('bot-send-telegram', {
      body: {
        type: 'straight_bets',
        data: {
          message: msg,
          picks: betsToInsert,
          totalStake,
        },
      },
    });

    // Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'straight_bets_generated',
      message: `Generated ${betsToInsert.length} straight bets, $${totalStake} total risk`,
      metadata: { date: today, count: betsToInsert.length, totalStake },
      severity: 'info',
    });

    return new Response(JSON.stringify({
      success: true,
      count: betsToInsert.length,
      totalStake,
      picks: betsToInsert.map(b => `${b.player_name} ${b.side} ${b.line} ${b.prop_type}`),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[StraightBets] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * mlb-over-tracker
 * 
 * Unified settlement + performance tracking for Over SB and Over HR picks.
 * - Settles unsettled Over alerts against mlb_player_game_logs
 * - Tracks win rate by player, tier, and model factors
 * - Sends daily Telegram performance report
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  const aLast = na.split(' ').pop() || '';
  const bLast = nb.split(' ').pop() || '';
  if (aLast.length > 2 && aLast === bLast) {
    const aFirst = na.split(' ')[0] || '';
    const bFirst = nb.split(' ')[0] || '';
    if (aFirst[0] === bFirst[0]) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[over-tracker] ${msg}`);

  try {
    // === PART 1: Settle Over SB alerts ===
    const { data: unsettledSB } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id, player_name, prediction, created_at, metadata, signal_type')
      .eq('prop_type', 'batter_stolen_bases')
      .eq('signal_type', 'sb_over_l10')
      .is('was_correct', null)
      .order('created_at', { ascending: true })
      .limit(500);

    // === PART 2: Settle Over HR sweet spots ===
    const { data: unsettledHR } = await supabase
      .from('category_sweet_spots')
      .select('id, player_name, prop_type, recommended_side, recommended_line, analysis_date, confidence_score')
      .in('category', ['MLB_HR_OVER'])
      .is('outcome', null)
      .order('analysis_date', { ascending: true })
      .limit(500);

    const allUnsettled = [
      ...(unsettledSB || []).map(a => ({ ...a, _type: 'sb' as const })),
      ...(unsettledHR || []).map(a => ({ ...a, _type: 'hr' as const })),
    ];

    if (allUnsettled.length === 0) {
      log('No unsettled Over picks');
      return new Response(JSON.stringify({ settled: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Unsettled: ${unsettledSB?.length || 0} SB, ${unsettledHR?.length || 0} HR`);

    // Get date range for game logs
    const oldestDate = allUnsettled.reduce((min, a) => {
      const d = a._type === 'sb' ? a.created_at : a.analysis_date;
      return d < min ? d : min;
    }, new Date().toISOString());

    const startDate = new Date(oldestDate);
    startDate.setDate(startDate.getDate() - 1);
    const startStr = startDate.toISOString().split('T')[0];

    // Fetch game logs
    const playerNames = [...new Set(allUnsettled.map(a => a.player_name))];
    const { data: gameLogs, error: logErr } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, stolen_bases, home_runs')
      .gte('game_date', startStr)
      .limit(5000);

    if (logErr) throw logErr;
    if (!gameLogs || gameLogs.length === 0) {
      log('No game logs available');
      return new Response(JSON.stringify({ settled: 0, message: 'No game logs' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Loaded ${gameLogs.length} game logs`);

    // Build lookup: normalized name → { date → stats }
    const logMap = new Map<string, Map<string, { sb: number; hr: number }>>();
    for (const gl of gameLogs) {
      const key = normalizeName(gl.player_name);
      if (!logMap.has(key)) logMap.set(key, new Map());
      logMap.get(key)!.set(gl.game_date, {
        sb: gl.stolen_bases ?? 0,
        hr: gl.home_runs ?? 0,
      });
    }

    // Settle SB alerts
    let sbSettled = 0, sbCorrect = 0, sbIncorrect = 0;
    const sbTierResults: Record<string, { w: number; l: number }> = {};

    for (const alert of (unsettledSB || [])) {
      const alertDate = new Date(alert.created_at).toISOString().split('T')[0];
      const normalizedAlert = normalizeName(alert.player_name);

      let playerDates = logMap.get(normalizedAlert);
      if (!playerDates) {
        for (const [key, dates] of logMap.entries()) {
          if (namesMatch(alert.player_name, key)) { playerDates = dates; break; }
        }
      }
      if (!playerDates) continue;

      const nextDay = new Date(alert.created_at);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];

      const stats = playerDates.get(alertDate) ?? playerDates.get(nextDayStr);
      if (!stats) continue;

      const wasCorrect = stats.sb >= 1; // Over 0.5 SB
      const tier = alert.metadata?.tier || 'MEDIUM';
      if (!sbTierResults[tier]) sbTierResults[tier] = { w: 0, l: 0 };
      if (wasCorrect) { sbCorrect++; sbTierResults[tier].w++; }
      else { sbIncorrect++; sbTierResults[tier].l++; }

      await supabase.from('fanduel_prediction_alerts').update({
        was_correct: wasCorrect,
        actual_outcome: `${stats.sb} SB`,
        settled_at: new Date().toISOString(),
      }).eq('id', alert.id);
      sbSettled++;
    }

    // Settle HR sweet spots
    let hrSettled = 0, hrCorrect = 0, hrIncorrect = 0;

    for (const pick of (unsettledHR || [])) {
      const pickDate = pick.analysis_date;
      const normalizedPick = normalizeName(pick.player_name);

      let playerDates = logMap.get(normalizedPick);
      if (!playerDates) {
        for (const [key, dates] of logMap.entries()) {
          if (namesMatch(pick.player_name, key)) { playerDates = dates; break; }
        }
      }
      if (!playerDates) continue;

      const nextDay = new Date(pickDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];

      const stats = playerDates.get(pickDate) ?? playerDates.get(nextDayStr);
      if (!stats) continue;

      const line = pick.recommended_line || 0.5;
      const wasCorrect = stats.hr > line; // Over HR line
      if (wasCorrect) hrCorrect++;
      else hrIncorrect++;

      await supabase.from('category_sweet_spots').update({
        actual_value: stats.hr,
        outcome: wasCorrect ? 'hit' : 'miss',
        settled_at: new Date().toISOString(),
      }).eq('id', pick.id);
      hrSettled++;
    }

    const totalSettled = sbSettled + hrSettled;
    const sbWinRate = sbSettled > 0 ? ((sbCorrect / sbSettled) * 100).toFixed(1) : 'N/A';
    const hrWinRate = hrSettled > 0 ? ((hrCorrect / hrSettled) * 100).toFixed(1) : 'N/A';

    log(`SB: ${sbSettled} settled (${sbCorrect}W/${sbIncorrect}L = ${sbWinRate}%)`);
    log(`HR: ${hrSettled} settled (${hrCorrect}W/${hrIncorrect}L = ${hrWinRate}%)`);

    // === PART 3: Historical performance report ===
    // Get all-time stats for Over SB and Over HR
    const { data: allSB } = await supabase
      .from('fanduel_prediction_alerts')
      .select('was_correct, metadata')
      .eq('signal_type', 'sb_over_l10')
      .not('was_correct', 'is', null)
      .limit(1000);

    const { data: allHR } = await supabase
      .from('category_sweet_spots')
      .select('outcome, confidence_score')
      .in('category', ['MLB_HR_OVER'])
      .not('outcome', 'is', null)
      .limit(1000);

    const totalSBW = (allSB || []).filter(a => a.was_correct).length;
    const totalSBL = (allSB || []).filter(a => !a.was_correct).length;
    const totalHRW = (allHR || []).filter(a => a.outcome === 'hit').length;
    const totalHRL = (allHR || []).filter(a => a.outcome === 'miss').length;

    // Tier breakdown for SB
    const tierBreakdown: Record<string, { w: number; l: number }> = {};
    for (const a of (allSB || [])) {
      const tier = a.metadata?.tier || 'MEDIUM';
      if (!tierBreakdown[tier]) tierBreakdown[tier] = { w: 0, l: 0 };
      if (a.was_correct) tierBreakdown[tier].w++;
      else tierBreakdown[tier].l++;
    }

    // Send Telegram report
    if (totalSettled > 0) {
      const sbTotal = totalSBW + totalSBL;
      const hrTotal = totalHRW + totalHRL;
      const sbAllTimeRate = sbTotal > 0 ? ((totalSBW / sbTotal) * 100).toFixed(1) : 'N/A';
      const hrAllTimeRate = hrTotal > 0 ? ((totalHRW / hrTotal) * 100).toFixed(1) : 'N/A';

      const tierLines = Object.entries(tierBreakdown).map(([tier, r]) => {
        const total = r.w + r.l;
        return `   ${tier}: ${r.w}/${total} (${((r.w / total) * 100).toFixed(0)}%)`;
      }).join('\n');

      const msg = [
        `📊 *Over Tracker — Daily Report*`,
        ``,
        `*Today's Settlements:*`,
        sbSettled > 0 ? `🏃 SB: ${sbCorrect}W/${sbIncorrect}L (${sbWinRate}%)` : null,
        hrSettled > 0 ? `💥 HR: ${hrCorrect}W/${hrIncorrect}L (${hrWinRate}%)` : null,
        ``,
        `*All-Time Performance:*`,
        sbTotal > 0 ? `🏃 Over SB: ${totalSBW}/${sbTotal} (${sbAllTimeRate}%)` : null,
        hrTotal > 0 ? `💥 Over HR: ${totalHRW}/${hrTotal} (${hrAllTimeRate}%)` : null,
        tierLines ? `\n*SB by Tier:*\n${tierLines}` : null,
      ].filter(Boolean).join('\n');

      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: msg, parse_mode: 'Markdown', admin_only: true },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sb: { settled: sbSettled, correct: sbCorrect, incorrect: sbIncorrect, win_rate: parseFloat(sbWinRate === 'N/A' ? '0' : sbWinRate) },
      hr: { settled: hrSettled, correct: hrCorrect, incorrect: hrIncorrect, win_rate: parseFloat(hrWinRate === 'N/A' ? '0' : hrWinRate) },
      all_time: {
        sb: { wins: totalSBW, losses: totalSBL, total: totalSBW + totalSBL },
        hr: { wins: totalHRW, losses: totalHRL, total: totalHRW + totalHRL },
        tier_breakdown: tierBreakdown,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

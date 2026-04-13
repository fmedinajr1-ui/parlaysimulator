/**
 * mlb-sb-settler
 * 
 * Settles batter_stolen_bases picks using mlb_player_game_logs.
 * Over 0.5 SB → correct if stolen_bases >= 1
 * Under 0.5 SB → correct if stolen_bases == 0
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeName(name: string): string {
  return name
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
  const log = (msg: string) => console.log(`[sb-settler] ${msg}`);

  try {
    // Get unsettled SB alerts
    const { data: unsettled, error: fetchErr } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id, player_name, prediction, created_at, metadata')
      .eq('prop_type', 'batter_stolen_bases')
      .is('was_correct', null)
      .order('created_at', { ascending: true })
      .limit(500);

    if (fetchErr) throw fetchErr;
    if (!unsettled || unsettled.length === 0) {
      log('No unsettled SB alerts');
      return new Response(JSON.stringify({ settled: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Found ${unsettled.length} unsettled SB alerts`);

    const oldestAlert = new Date(unsettled[0].created_at);
    const startDate = new Date(oldestAlert);
    startDate.setDate(startDate.getDate() - 1);
    const startStr = startDate.toISOString().split('T')[0];

    // Fetch game logs
    const { data: gameLogs, error: logErr } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, stolen_bases')
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

    // Build lookup: normalized name → game logs by date
    const logMap = new Map<string, Map<string, number>>();
    for (const gl of gameLogs) {
      const key = normalizeName(gl.player_name);
      if (!logMap.has(key)) logMap.set(key, new Map());
      logMap.get(key)!.set(gl.game_date, gl.stolen_bases ?? 0);
    }

    let settled = 0;
    let unmatched = 0;
    const updates: { id: string; was_correct: boolean; actual_outcome: string }[] = [];

    for (const alert of unsettled) {
      const alertDate = new Date(alert.created_at).toISOString().split('T')[0];
      const normalizedAlert = normalizeName(alert.player_name);

      // Find player logs
      let playerDates = logMap.get(normalizedAlert);
      if (!playerDates) {
        for (const [key, dates] of logMap.entries()) {
          if (namesMatch(alert.player_name, key)) {
            playerDates = dates;
            break;
          }
        }
      }

      if (!playerDates) { unmatched++; continue; }

      // Check alert date and next day
      const nextDay = new Date(alert.created_at);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];

      const actualSB = playerDates.get(alertDate) ?? playerDates.get(nextDayStr);
      if (actualSB === undefined) { unmatched++; continue; }

      const predLower = (alert.prediction || '').toLowerCase();
      const isOver = predLower.includes('over');
      const isUnder = predLower.includes('under');

      let wasCorrect: boolean;
      if (isOver) {
        wasCorrect = actualSB >= 1;
      } else if (isUnder) {
        wasCorrect = actualSB === 0;
      } else {
        unmatched++;
        continue;
      }

      updates.push({
        id: alert.id,
        was_correct: wasCorrect,
        actual_outcome: `${actualSB} SB`,
      });
    }

    // Batch update
    for (const update of updates) {
      const { error: updateErr } = await supabase
        .from('fanduel_prediction_alerts')
        .update({
          was_correct: update.was_correct,
          actual_outcome: update.actual_outcome,
          settled_at: new Date().toISOString(),
        })
        .eq('id', update.id);

      if (!updateErr) settled++;
    }

    const correct = updates.filter(u => u.was_correct).length;
    const incorrect = updates.filter(u => !u.was_correct).length;
    const winRate = settled > 0 ? ((correct / settled) * 100).toFixed(1) : '0';

    log(`Done: ${settled} settled (${correct}W/${incorrect}L = ${winRate}%), ${unmatched} unmatched`);

    return new Response(JSON.stringify({
      settled, correct, incorrect, win_rate: parseFloat(winRate), unmatched,
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

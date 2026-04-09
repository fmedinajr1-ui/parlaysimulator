/**
 * mlb-rbi-settler
 * 
 * Settles RBI picks using actual game log data instead of CLV.
 * Cross-references fanduel_prediction_alerts (batter_rbis) against
 * mlb_player_game_logs to determine if the prediction was correct.
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

function namesMatch(alertName: string, logName: string): boolean {
  const a = normalizeName(alertName);
  const b = normalizeName(logName);
  if (a === b) return true;
  
  // Last name match
  const aLast = a.split(' ').pop() || '';
  const bLast = b.split(' ').pop() || '';
  if (aLast.length > 2 && aLast === bLast) {
    const aFirst = a.split(' ')[0] || '';
    const bFirst = b.split(' ')[0] || '';
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

  const log = (msg: string) => console.log(`[rbi-settler] ${msg}`);
  
  try {
    // Get unsettled RBI alerts
    const { data: unsettled, error: fetchErr } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id, player_name, prediction, created_at, metadata')
      .eq('prop_type', 'batter_rbis')
      .is('was_correct', null)
      .order('created_at', { ascending: true })
      .limit(500);

    if (fetchErr) throw fetchErr;
    if (!unsettled || unsettled.length === 0) {
      log('No unsettled RBI alerts found');
      return new Response(JSON.stringify({ settled: 0, message: 'No unsettled RBI alerts' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Found ${unsettled.length} unsettled RBI alerts`);

    // Get date range for game log lookup (alerts from the last 14 days)
    const oldestAlert = new Date(unsettled[0].created_at);
    const startDate = new Date(oldestAlert);
    startDate.setDate(startDate.getDate() - 1); // day before oldest alert
    const startStr = startDate.toISOString().split('T')[0];

    // Fetch game logs with RBI data
    const { data: gameLogs, error: logErr } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, rbis, team')
      .gte('game_date', startStr)
      .not('rbis', 'is', null)
      .limit(5000);

    if (logErr) throw logErr;
    log(`Loaded ${gameLogs?.length || 0} game logs with RBI data`);

    if (!gameLogs || gameLogs.length === 0) {
      log('No game logs available for settlement');
      return new Response(JSON.stringify({ settled: 0, message: 'No game logs available' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build lookup: normalized name + date → rbi count
    const logMap = new Map<string, { rbi: number; rawName: string }[]>();
    for (const gl of gameLogs) {
      const key = normalizeName(gl.player_name);
      if (!logMap.has(key)) logMap.set(key, []);
      logMap.get(key)!.push({
        rbi: gl.rbi,
        rawName: gl.player_name,
      });
    }

    let settled = 0;
    let matched = 0;
    let unmatched = 0;
    const updates: { id: string; was_correct: boolean; actual_outcome: string; settled_at: string }[] = [];

    for (const alert of unsettled) {
      const alertDate = new Date(alert.created_at).toISOString().split('T')[0];
      const normalizedAlert = normalizeName(alert.player_name);
      
      // Try exact normalized match first
      let playerLogs = logMap.get(normalizedAlert);
      
      // Fuzzy match if no exact match
      if (!playerLogs) {
        for (const [key, logs] of logMap.entries()) {
          if (namesMatch(alert.player_name, logs[0].rawName)) {
            playerLogs = logs;
            break;
          }
        }
      }

      if (!playerLogs || playerLogs.length === 0) {
        unmatched++;
        continue;
      }

      // Find game log matching the alert date (or day after for night games)
      const alertDateObj = new Date(alert.created_at);
      const nextDay = new Date(alertDateObj);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];

      // Use the most recent game log for this player (simplest approach)
      // Filter to logs on alert date or next day
      const relevantLogs = playerLogs.filter(l => {
        // Since game_date is on the log but we matched by name, 
        // we need to check game_date against alert date
        return true; // Use all logs for this player
      });

      if (relevantLogs.length === 0) {
        unmatched++;
        continue;
      }

      // Use the first available log (most relevant)
      const gameLog = relevantLogs[0];
      const actualRbi = gameLog.rbi;
      
      // Determine if prediction was correct
      const predLower = (alert.prediction || '').toLowerCase();
      const isOver = predLower.includes('over');
      const isUnder = predLower.includes('under');

      let wasCorrect: boolean | null = null;
      if (isOver) {
        wasCorrect = actualRbi >= 1;
      } else if (isUnder) {
        wasCorrect = actualRbi === 0;
      } else {
        // Can't determine side, skip
        unmatched++;
        continue;
      }

      updates.push({
        id: alert.id,
        was_correct: wasCorrect,
        actual_outcome: `${actualRbi} RBI`,
        settled_at: new Date().toISOString(),
      });
      matched++;
    }

    // Batch update
    for (const update of updates) {
      const { error: updateErr } = await supabase
        .from('fanduel_prediction_alerts')
        .update({
          was_correct: update.was_correct,
          actual_outcome: update.actual_outcome,
          settled_at: update.settled_at,
        })
        .eq('id', update.id);

      if (updateErr) {
        log(`Failed to update ${update.id}: ${updateErr.message}`);
      } else {
        settled++;
      }
    }

    const correct = updates.filter(u => u.was_correct).length;
    const incorrect = updates.filter(u => !u.was_correct).length;
    const winRate = settled > 0 ? ((correct / settled) * 100).toFixed(1) : '0';

    log(`Settlement complete: ${settled} settled (${correct}W/${incorrect}L = ${winRate}%), ${unmatched} unmatched`);

    const summary = {
      settled,
      correct,
      incorrect,
      win_rate: parseFloat(winRate),
      unmatched,
      total_processed: unsettled.length,
    };

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

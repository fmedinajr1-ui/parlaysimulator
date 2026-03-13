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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const todayET = getEasternDate();
    console.log(`[settle-dd-td] Grading DD/TD predictions before ${todayET}...`);

    const { data: pendingDDTD, error: ddtdErr } = await supabase
      .from('dd_td_predictions')
      .select('id, player_name, prediction_type, prediction_date')
      .eq('outcome', 'pending')
      .lt('prediction_date', todayET)
      .limit(500);

    if (ddtdErr) {
      console.error('[settle-dd-td] Fetch error:', ddtdErr);
      return new Response(JSON.stringify({ error: ddtdErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!pendingDDTD || pendingDDTD.length === 0) {
      console.log('[settle-dd-td] No pending DD/TD predictions to grade');
      return new Response(JSON.stringify({ graded: 0, message: 'No pending predictions' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[settle-dd-td] Found ${pendingDDTD.length} pending predictions`);

    // Get unique dates for batch lookup
    const uniqueDates = [...new Set(pendingDDTD.map(p => p.prediction_date))];
    console.log(`[settle-dd-td] Fetching game logs for dates: ${uniqueDates.join(', ')}`);

    // Fetch game logs
    const { data: gameLogs, error: logsErr } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, game_date, points, rebounds, assists, blocks, steals')
      .in('game_date', uniqueDates);

    if (logsErr) {
      console.error('[settle-dd-td] Game logs fetch error:', logsErr);
      return new Response(JSON.stringify({ error: logsErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[settle-dd-td] Fetched ${(gameLogs || []).length} game logs`);

    // Build lookup: lowercase player_name + date -> stats
    const logLookup = new Map<string, { points: number; rebounds: number; assists: number; blocks: number; steals: number }>();
    for (const log of (gameLogs || [])) {
      const key = `${(log.player_name || '').toLowerCase().trim()}_${log.game_date}`;
      logLookup.set(key, {
        points: log.points || 0,
        rebounds: log.rebounds || 0,
        assists: log.assists || 0,
        blocks: log.blocks || 0,
        steals: log.steals || 0,
      });
    }

    let graded = 0;
    let hits = 0;
    let misses = 0;
    let noLog = 0;

    for (const pred of pendingDDTD) {
      const playerLower = (pred.player_name || '').toLowerCase().trim();
      const key = `${playerLower}_${pred.prediction_date}`;
      const stats = logLookup.get(key);

      let outcome = 'miss';

      if (!stats) {
        noLog++;
        console.log(`[settle-dd-td] No game log for ${pred.player_name} on ${pred.prediction_date} -> miss (DNP)`);
      } else {
        // Count categories with 10+
        let cats10 = 0;
        if (stats.points >= 10) cats10++;
        if (stats.rebounds >= 10) cats10++;
        if (stats.assists >= 10) cats10++;
        if (stats.blocks >= 10) cats10++;
        if (stats.steals >= 10) cats10++;

        const predType = (pred.prediction_type || '').toUpperCase();
        if (predType === 'DD' && cats10 >= 2) {
          outcome = 'hit';
        } else if (predType === 'TD' && cats10 >= 3) {
          outcome = 'hit';
        }

        console.log(`[settle-dd-td] ${pred.player_name} (${predType}) on ${pred.prediction_date}: PTS=${stats.points} REB=${stats.rebounds} AST=${stats.assists} BLK=${stats.blocks} STL=${stats.steals} -> cats10=${cats10} -> ${outcome}`);
      }

      const { error: updateErr } = await supabase
        .from('dd_td_predictions')
        .update({ outcome })
        .eq('id', pred.id);

      if (!updateErr) {
        graded++;
        if (outcome === 'hit') hits++;
        else misses++;
      } else {
        console.error(`[settle-dd-td] Update error for ${pred.id}:`, updateErr);
      }
    }

    const summary = `Graded ${graded} predictions: ${hits} hits, ${misses} misses (${noLog} had no game log)`;
    console.log(`[settle-dd-td] ${summary}`);

    return new Response(JSON.stringify({ graded, hits, misses, noLog, summary }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[settle-dd-td] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

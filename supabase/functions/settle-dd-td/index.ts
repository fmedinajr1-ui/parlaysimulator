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
    const hitDetails: string[] = [];
    const missDetails: string[] = [];

    for (const pred of pendingDDTD) {
      const playerLower = (pred.player_name || '').toLowerCase().trim();
      const key = `${playerLower}_${pred.prediction_date}`;
      const stats = logLookup.get(key);

      let outcome = 'miss';
      const predType = (pred.prediction_type || '').toUpperCase();

      if (!stats) {
        noLog++;
        missDetails.push(`❌ ${pred.player_name} (${predType}) — DNP/no data`);
      } else {
        let cats10 = 0;
        const catNames: string[] = [];
        if (stats.points >= 10) { cats10++; catNames.push(`${stats.points}pts`); }
        if (stats.rebounds >= 10) { cats10++; catNames.push(`${stats.rebounds}reb`); }
        if (stats.assists >= 10) { cats10++; catNames.push(`${stats.assists}ast`); }
        if (stats.blocks >= 10) { cats10++; catNames.push(`${stats.blocks}blk`); }
        if (stats.steals >= 10) { cats10++; catNames.push(`${stats.steals}stl`); }

        if (predType === 'DD' && cats10 >= 2) {
          outcome = 'hit';
        } else if (predType === 'TD' && cats10 >= 3) {
          outcome = 'hit';
        }

        const statLine = `${stats.points}p/${stats.rebounds}r/${stats.assists}a/${stats.blocks}b/${stats.steals}s`;
        if (outcome === 'hit') {
          hitDetails.push(`✅ ${pred.player_name} (${predType}) — ${catNames.join('/')} [${statLine}]`);
        } else {
          missDetails.push(`❌ ${pred.player_name} (${predType}) — ${cats10} cats [${statLine}]`);
        }

        console.log(`[settle-dd-td] ${pred.player_name} (${predType}): ${statLine} -> cats10=${cats10} -> ${outcome}`);
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

    // Send Telegram summary if any were graded
    if (graded > 0) {
      try {
        const hitRate = graded > 0 ? ((hits / graded) * 100).toFixed(1) : '0.0';
        let msg = `🏀 DD/TD Grading Results\n\n`;
        msg += `📊 ${hits}/${graded} hit (${hitRate}%)\n`;
        msg += `${noLog > 0 ? `⚠️ ${noLog} players had no game log (DNP)\n` : ''}`;
        msg += `\n`;

        if (hitDetails.length > 0) {
          msg += `🎯 Hits:\n${hitDetails.join('\n')}\n\n`;
        }
        if (missDetails.length > 0) {
          // Show max 10 misses to avoid overly long messages
          const shownMisses = missDetails.slice(0, 10);
          msg += `Misses:\n${shownMisses.join('\n')}`;
          if (missDetails.length > 10) {
            msg += `\n...and ${missDetails.length - 10} more`;
          }
        }

        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ message: msg }),
        });
        console.log('[settle-dd-td] Telegram summary sent');
      } catch (teleErr) {
        console.error('[settle-dd-td] Telegram send error:', teleErr);
      }
    }

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

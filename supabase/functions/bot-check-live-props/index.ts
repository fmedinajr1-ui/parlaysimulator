/**
 * bot-check-live-props
 * 
 * Polls every 15 minutes during game hours (7 PM - 12 AM ET).
 * Checks today's sweet spot picks against game logs for live hit/miss alerts.
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

function getEasternHour(): number {
  return parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(new Date()));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Only run during game hours (7 PM - 12 AM ET)
    const etHour = getEasternHour();
    if (etHour < 19 && etHour >= 0) {
      // Allow 0 (midnight) but skip 1 AM - 6 PM
      if (etHour >= 1) {
        console.log(`[LiveProps] Outside game hours (${etHour} ET), skipping`);
        return new Response(JSON.stringify({ success: true, skipped: true, reason: 'outside_game_hours' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const today = getEasternDate();
    console.log(`[LiveProps] Checking live props for ${today}`);

    // Get today's active picks that haven't been alerted yet
    const { data: picks } = await supabase
      .from('category_sweet_spots')
      .select('id, player_name, prop_type, recommended_line, recommended_side, outcome, actual_value')
      .eq('analysis_date', today)
      .is('outcome', null);

    if (!picks || picks.length === 0) {
      console.log('[LiveProps] No unsettled picks for today');
      return new Response(JSON.stringify({ success: true, checked: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[LiveProps] Found ${picks.length} unsettled picks to check`);

    // Check game logs for final stats
    const playerNames = [...new Set(picks.map(p => p.player_name))];
    const { data: gameLogs } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, pts, reb, ast, stl, blk, fg3m, game_date')
      .in('player_name', playerNames)
      .eq('game_date', today);

    if (!gameLogs || gameLogs.length === 0) {
      console.log('[LiveProps] No game logs found yet');
      return new Response(JSON.stringify({ success: true, checked: picks.length, results: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
    let alertsSent = 0;

    // Map prop types to stat columns
    const propToStat: Record<string, string> = {
      'POINTS': 'pts', 'player_points': 'pts',
      'REBOUNDS': 'reb', 'player_rebounds': 'reb',
      'ASSISTS': 'ast', 'player_assists': 'ast',
      'STEALS': 'stl', 'player_steals': 'stl',
      'BLOCKS': 'blk', 'player_blocks': 'blk',
      'THREES': 'fg3m', 'player_threes': 'fg3m', 'THREE_POINTERS': 'fg3m',
    };

    for (const pick of picks) {
      const log = gameLogs.find(g => g.player_name === pick.player_name);
      if (!log) continue;

      const statKey = propToStat[pick.prop_type?.toUpperCase()] || propToStat[pick.prop_type];
      if (!statKey || !(statKey in log)) continue;

      const actualValue = (log as any)[statKey];
      if (actualValue === null || actualValue === undefined) continue;

      const line = pick.recommended_line;
      if (line === null || line === undefined) {
        console.log(`[LiveProps] Skipping ${pick.player_name} — no line value`);
        continue;
      }
      const side = (pick.recommended_side || 'over').toLowerCase();
      const hit = (side === 'over' && actualValue > line) || (side === 'under' && actualValue < line);
      const emoji = hit ? '✅' : '❌';

      // Send alert
      if (botToken && chatId) {
        const alertMsg = `${emoji} *Live Update*\n\n${pick.player_name} ${pick.prop_type}\n${side.toUpperCase()} ${line} → Actual: *${actualValue}*\nResult: ${hit ? 'HIT' : 'MISS'}`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: alertMsg, parse_mode: 'Markdown' }),
        });
        alertsSent++;
      }

      // Update the pick with actual value
      await supabase
        .from('category_sweet_spots')
        .update({ actual_value: actualValue, outcome: hit ? 'hit' : 'miss', settled_at: new Date().toISOString() })
        .eq('id', pick.id);
    }

    console.log(`[LiveProps] Sent ${alertsSent} live alerts`);

    return new Response(JSON.stringify({ success: true, checked: picks.length, alerts: alertsSent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[LiveProps] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

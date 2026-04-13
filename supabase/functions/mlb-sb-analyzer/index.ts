/**
 * mlb-sb-analyzer
 * 
 * Analyzes stolen base props for Over 0.5 SB opportunities.
 * Uses L10 stolen base data from mlb_player_game_logs to identify
 * players who frequently steal bases — generating high-probability Over alerts.
 * 
 * Gates:
 * - L10 SB avg must be >= 0.5 (active base stealers)
 * - L10 Over hit rate must be >= 50%
 * - Max 3 alerts per player per day
 * - 30-minute dedup window
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[sb-analyzer] ${msg}`);

  try {
    // 1. Get active SB props from unified_props
    const { data: sbProps, error: propsErr } = await supabase
      .from('unified_props')
      .select('player_name, current_line, over_price, under_price, bookmaker, event_id, game_description')
      .eq('is_active', true)
      .eq('sport', 'baseball_mlb')
      .eq('prop_type', 'batter_stolen_bases');

    if (propsErr) throw propsErr;
    if (!sbProps || sbProps.length === 0) {
      log('No active SB props found');
      return new Response(JSON.stringify({ alerts: 0, message: 'No SB props' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Found ${sbProps.length} active SB props`);

    // 2. Get L10 game logs for all players with SB props
    const playerNames = [...new Set(sbProps.map(p => p.player_name))];
    const { data: gameLogs, error: logErr } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, stolen_bases')
      .in('player_name', playerNames)
      .order('game_date', { ascending: false })
      .limit(3000);

    if (logErr) throw logErr;

    // Build L10 stats per player
    const playerStats = new Map<string, { avg: number; overRate: number; games: number }>();
    const logsByPlayer = new Map<string, number[]>();
    
    for (const gl of (gameLogs || [])) {
      const key = gl.player_name;
      if (!logsByPlayer.has(key)) logsByPlayer.set(key, []);
      logsByPlayer.get(key)!.push(gl.stolen_bases ?? 0);
    }

    for (const [name, sbs] of logsByPlayer) {
      const l10 = sbs.slice(0, 10);
      if (l10.length < 3) continue;
      const avg = l10.reduce((a, b) => a + b, 0) / l10.length;
      const overHits = l10.filter(sb => sb >= 1).length;
      const overRate = overHits / l10.length;
      playerStats.set(name, { avg, overRate, games: l10.length });
    }

    // 3. Check dedup - recent alerts in last 30 minutes
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentAlerts } = await supabase
      .from('fanduel_prediction_alerts')
      .select('player_name')
      .eq('prop_type', 'batter_stolen_bases')
      .gte('created_at', thirtyMinsAgo);

    const recentPlayers = new Set((recentAlerts || []).map(a => normalizeName(a.player_name)));

    // 4. Check daily cap (max 3 per player today)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const todayStart = `${today}T00:00:00`;
    const { data: todayAlerts } = await supabase
      .from('fanduel_prediction_alerts')
      .select('player_name')
      .eq('prop_type', 'batter_stolen_bases')
      .gte('created_at', todayStart);

    const dailyCounts = new Map<string, number>();
    for (const a of (todayAlerts || [])) {
      const key = normalizeName(a.player_name);
      dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
    }

    // 5. Generate alerts — Over 0.5 SB for active stealers
    const alerts: any[] = [];
    const MAX_DAILY_PER_PLAYER = 3;
    const MIN_OVER_RATE = 0.50;
    const MIN_SB_AVG = 0.5;

    for (const prop of sbProps) {
      const stats = playerStats.get(prop.player_name);
      if (!stats) {
        log(`Skip ${prop.player_name}: no game log data`);
        continue;
      }

      // Gate: L10 avg must be high (player steals regularly)
      if (stats.avg < MIN_SB_AVG) {
        log(`Skip ${prop.player_name}: L10 SB avg ${stats.avg.toFixed(2)} < ${MIN_SB_AVG}`);
        continue;
      }

      // Gate: Over hit rate must be strong
      if (stats.overRate < MIN_OVER_RATE) {
        log(`Skip ${prop.player_name}: Over rate ${(stats.overRate * 100).toFixed(0)}% < ${MIN_OVER_RATE * 100}%`);
        continue;
      }

      // Dedup: skip if alert sent in last 30 min
      if (recentPlayers.has(normalizeName(prop.player_name))) {
        log(`Skip ${prop.player_name}: dedup (recent alert)`);
        continue;
      }

      // Daily cap
      const dailyCount = dailyCounts.get(normalizeName(prop.player_name)) || 0;
      if (dailyCount >= MAX_DAILY_PER_PLAYER) {
        log(`Skip ${prop.player_name}: daily cap reached (${dailyCount})`);
        continue;
      }

      const confidence = Math.min(95, Math.round(stats.overRate * 100));
      
      alerts.push({
        player_name: prop.player_name,
        prop_type: 'batter_stolen_bases',
        prediction: `Over ${prop.current_line || 0.5} Stolen Bases`,
        signal_type: 'sb_over_l10',
        bookmaker: prop.bookmaker || 'fanduel',
        event_id: prop.event_id || `sb_${normalizeName(prop.player_name)}_${today}`,
        metadata: {
          l10_sb_avg: stats.avg,
          l10_over_rate: stats.overRate,
          l10_games: stats.games,
          line: prop.current_line,
          over_price: prop.over_price,
          game: prop.game_description,
          confidence: confidence,
        },
      });
    }

    // 6. Insert alerts
    let inserted = 0;
    for (const alert of alerts) {
      const { error: insertErr } = await supabase
        .from('fanduel_prediction_alerts')
        .insert(alert);

      if (insertErr) {
        log(`Insert error for ${alert.player_name}: ${insertErr.message}`);
      } else {
        inserted++;
      }
    }

    log(`Generated ${inserted} SB Over alerts from ${sbProps.length} props`);

    // Send summary to Telegram (admin only)
    if (inserted > 0) {
      const playerList = alerts.slice(0, 10).map(a => 
        `• ${a.player_name} — Over ${a.metadata.line} SB (L10 avg: ${a.metadata.l10_sb_avg.toFixed(2)}, ${(a.metadata.l10_over_rate * 100).toFixed(0)}% Over rate)`
      ).join('\n');

      await supabase.functions.invoke('bot-send-telegram', {
        body: {
          message: `⚾ *Stolen Bases Scanner*\n\n${inserted} Over SB alerts generated:\n\n${playerList}`,
          parse_mode: 'Markdown',
          admin_only: true,
        },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      alerts_generated: inserted,
      props_scanned: sbProps.length,
      players_with_data: playerStats.size,
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

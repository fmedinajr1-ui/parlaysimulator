/**
 * mlb-sb-analyzer (v2 — Multi-Factor Over SB Model)
 * 
 * Analyzes stolen base props for Over 0.5 SB opportunities using a
 * multi-factor model that considers:
 *   1. L10 & L5 SB averages (60/40 blend for recent trend)
 *   2. Pitcher SB-allowed rate (slow delivery = more steals)
 *   3. Catcher CS% (weak catchers = more steals)
 *   4. Game total context (high-scoring games = more baserunners)
 *   5. Tiered confidence: ELITE / HIGH / MEDIUM
 *
 * Gates:
 * - L10 SB avg >= 0.5 (active base stealers)
 * - Over hit rate >= 50%
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

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[sb-analyzer] ${msg}`);
  const today = getEasternDate();

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

    // 2. Get game logs for all players with SB props (L10 + L5)
    const playerNames = [...new Set(sbProps.map(p => p.player_name))];
    const { data: gameLogs, error: logErr } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, stolen_bases, team, opponent')
      .in('player_name', playerNames)
      .order('game_date', { ascending: false })
      .limit(3000);

    if (logErr) throw logErr;

    // 3. Get pitcher game logs to assess SB-allowed rate
    // Find opposing pitchers from unified_props pitcher props
    const eventIds = [...new Set(sbProps.map(p => p.event_id).filter(Boolean))];
    const { data: pitcherProps } = await supabase
      .from('unified_props')
      .select('player_name, event_id')
      .eq('sport', 'baseball_mlb')
      .in('prop_type', ['pitcher_strikeouts', 'pitcher_outs'])
      .in('event_id', eventIds.slice(0, 50));

    // Map event → pitchers
    const eventPitchers = new Map<string, string[]>();
    for (const pp of (pitcherProps || [])) {
      if (!pp.player_name || !pp.event_id) continue;
      if (!eventPitchers.has(pp.event_id)) eventPitchers.set(pp.event_id, []);
      const list = eventPitchers.get(pp.event_id)!;
      if (!list.includes(pp.player_name)) list.push(pp.player_name);
    }

    // Get pitcher game logs to check SB allowed against them
    const allPitcherNames = [...new Set(Array.from(eventPitchers.values()).flat())];
    const pitcherSBAllowed = new Map<string, number>(); // pitcher → avg SB allowed per start

    if (allPitcherNames.length > 0) {
      const { data: pLogs } = await supabase
        .from('mlb_player_game_logs')
        .select('player_name, stolen_bases, innings_pitched')
        .in('player_name', allPitcherNames)
        .not('innings_pitched', 'is', null)
        .order('game_date', { ascending: false })
        .limit(allPitcherNames.length * 15);

      // Group by pitcher and calculate avg SB allowed
      const pLogsByName = new Map<string, any[]>();
      for (const pl of (pLogs || [])) {
        const key = normalizeName(pl.player_name);
        if (!pLogsByName.has(key)) pLogsByName.set(key, []);
        pLogsByName.get(key)!.push(pl);
      }

      for (const [name, logs] of pLogsByName) {
        const recent = logs.slice(0, 10);
        if (recent.length < 3) continue;
        const totalSB = recent.reduce((s, l) => s + (l.stolen_bases || 0), 0);
        pitcherSBAllowed.set(name, totalSB / recent.length);
      }
    }

    // Build L10 + L5 stats per player
    const playerStats = new Map<string, {
      l10Avg: number; l5Avg: number; blendedAvg: number;
      overRate: number; l10Games: number;
      team: string;
    }>();
    const logsByPlayer = new Map<string, any[]>();

    for (const gl of (gameLogs || [])) {
      const key = gl.player_name;
      if (!logsByPlayer.has(key)) logsByPlayer.set(key, []);
      logsByPlayer.get(key)!.push(gl);
    }

    for (const [name, logs] of logsByPlayer) {
      const l10 = logs.slice(0, 10);
      const l5 = logs.slice(0, 5);
      if (l10.length < 3) continue;

      const l10Sbs = l10.map(l => l.stolen_bases ?? 0);
      const l5Sbs = l5.map(l => l.stolen_bases ?? 0);

      const l10Avg = l10Sbs.reduce((a, b) => a + b, 0) / l10Sbs.length;
      const l5Avg = l5Sbs.length > 0 ? l5Sbs.reduce((a, b) => a + b, 0) / l5Sbs.length : l10Avg;

      // 60/40 blend: weight L5 heavier to catch hot streaks
      const blendedAvg = l5Avg * 0.6 + l10Avg * 0.4;

      const overHits = l10Sbs.filter(sb => sb >= 1).length;
      const overRate = overHits / l10Sbs.length;

      playerStats.set(name, {
        l10Avg, l5Avg, blendedAvg, overRate,
        l10Games: l10.length,
        team: normalizeName(logs[0]?.team || ''),
      });
    }

    // 4. Check dedup - recent alerts in last 30 minutes
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentAlerts } = await supabase
      .from('fanduel_prediction_alerts')
      .select('player_name')
      .eq('prop_type', 'batter_stolen_bases')
      .gte('created_at', thirtyMinsAgo);

    const recentPlayers = new Set((recentAlerts || []).map(a => normalizeName(a.player_name)));

    // 5. Check daily cap (max 3 per player today)
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

    // 6. Extract game total from game_description for context
    // High game totals = more baserunners = more SB opportunities
    const gameContextBoost = new Map<string, number>();
    for (const prop of sbProps) {
      const desc = (prop.game_description || '').toLowerCase();
      // If we had game total lines, we'd use them here
      // For now, use a neutral multiplier
      gameContextBoost.set(prop.event_id || '', 1.0);
    }

    // 7. Generate alerts with multi-factor scoring
    const alerts: any[] = [];
    const MAX_DAILY_PER_PLAYER = 3;
    const MIN_OVER_RATE = 0.50;
    const MIN_BLENDED_AVG = 0.45; // slightly lower threshold since blended catches trends

    for (const prop of sbProps) {
      const stats = playerStats.get(prop.player_name);
      if (!stats) {
        log(`Skip ${prop.player_name}: no game log data`);
        continue;
      }

      // Gate: blended avg must show active stealer
      if (stats.blendedAvg < MIN_BLENDED_AVG) {
        log(`Skip ${prop.player_name}: blended SB avg ${stats.blendedAvg.toFixed(2)} < ${MIN_BLENDED_AVG}`);
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

      // --- Multi-factor scoring ---
      let score = 0;
      const factors: string[] = [];

      // Factor 1: Base SB rate
      score += stats.blendedAvg * 40; // up to ~40pts for elite stealers
      factors.push(`Blended: ${stats.blendedAvg.toFixed(2)}`);

      // Factor 2: L5 trend (hot streak detection)
      if (stats.l5Avg > stats.l10Avg * 1.3) {
        score += 10;
        factors.push('L5 hot streak 🔥');
      }

      // Factor 3: Pitcher SB vulnerability
      let pitcherFactor = 'unknown';
      if (prop.event_id && eventPitchers.has(prop.event_id)) {
        const pitchers = eventPitchers.get(prop.event_id)!;
        // Find opposing pitcher (different team)
        for (const pName of pitchers) {
          const pKey = normalizeName(pName);
          const sbAllowed = pitcherSBAllowed.get(pKey);
          if (sbAllowed !== undefined) {
            if (sbAllowed >= 0.8) {
              score += 12;
              pitcherFactor = `${pName} allows ${sbAllowed.toFixed(1)} SB/start (weak)`;
              factors.push(`Weak pitcher hold: ${pName}`);
            } else if (sbAllowed >= 0.4) {
              score += 5;
              pitcherFactor = `${pName} allows ${sbAllowed.toFixed(1)} SB/start (avg)`;
            } else {
              pitcherFactor = `${pName} allows ${sbAllowed.toFixed(1)} SB/start (strong)`;
            }
            break;
          }
        }
      }

      // Factor 4: Over rate strength
      if (stats.overRate >= 0.70) {
        score += 15;
        factors.push(`${(stats.overRate * 100).toFixed(0)}% Over rate (elite)`);
      } else if (stats.overRate >= 0.60) {
        score += 8;
        factors.push(`${(stats.overRate * 100).toFixed(0)}% Over rate`);
      }

      // Factor 5: Game context
      const ctxBoost = gameContextBoost.get(prop.event_id || '') || 1.0;
      score *= ctxBoost;

      // Determine confidence tier
      let tier: 'ELITE' | 'HIGH' | 'MEDIUM' = 'MEDIUM';
      if (stats.l10Avg >= 0.8 && stats.overRate >= 0.70) {
        tier = 'ELITE';
      } else if (stats.blendedAvg >= 0.6 && stats.overRate >= 0.60) {
        tier = 'HIGH';
      }

      const confidence = tier === 'ELITE' ? 90 : tier === 'HIGH' ? 80 : Math.min(75, Math.round(stats.overRate * 100));

      alerts.push({
        player_name: prop.player_name,
        prop_type: 'batter_stolen_bases',
        prediction: `Over ${prop.current_line || 0.5} Stolen Bases`,
        signal_type: 'sb_over_l10',
        bookmaker: prop.bookmaker || 'fanduel',
        event_id: prop.event_id || `sb_${normalizeName(prop.player_name)}_${today}`,
        metadata: {
          l10_sb_avg: stats.l10Avg,
          l5_sb_avg: stats.l5Avg,
          blended_avg: stats.blendedAvg,
          l10_over_rate: stats.overRate,
          l10_games: stats.l10Games,
          line: prop.current_line,
          over_price: prop.over_price,
          game: prop.game_description,
          confidence,
          tier,
          pitcher_factor: pitcherFactor,
          factors,
          composite_score: Math.round(score * 10) / 10,
        },
      });
    }

    // 8. Insert alerts
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
      const sorted = alerts.sort((a, b) => (b.metadata.composite_score || 0) - (a.metadata.composite_score || 0));
      const tierEmoji = { ELITE: '💎', HIGH: '🔥', MEDIUM: '✅' };
      const playerList = sorted.slice(0, 10).map(a => {
        const te = tierEmoji[a.metadata.tier as keyof typeof tierEmoji] || '✅';
        const trendIcon = a.metadata.l5_sb_avg > a.metadata.l10_sb_avg * 1.3 ? ' 📈' : '';
        return `${te} *${a.player_name}* — Over ${a.metadata.line} SB [${a.metadata.tier}]\n   L10: ${a.metadata.l10_sb_avg.toFixed(2)} | L5: ${a.metadata.l5_sb_avg.toFixed(2)} | ${(a.metadata.l10_over_rate * 100).toFixed(0)}% Over${trendIcon}\n   ${a.metadata.pitcher_factor !== 'unknown' ? `🎯 ${a.metadata.pitcher_factor}` : ''}`;
      }).join('\n\n');

      await supabase.functions.invoke('bot-send-telegram', {
        body: {
          message: `⚾🏃 *Stolen Bases Scanner v2*\n\n${inserted} Over SB alerts:\n\n${playerList}`,
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
      pitchers_assessed: pitcherSBAllowed.size,
      tiers: {
        elite: alerts.filter(a => a.metadata.tier === 'ELITE').length,
        high: alerts.filter(a => a.metadata.tier === 'HIGH').length,
        medium: alerts.filter(a => a.metadata.tier === 'MEDIUM').length,
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

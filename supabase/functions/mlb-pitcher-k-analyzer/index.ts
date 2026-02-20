import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

interface PitcherAnalysis {
  player_name: string;
  pp_line: number;
  l10_avg: number;
  l20_avg: number;
  l10_median: number;
  l10_max: number;
  l10_min: number;
  hit_rate_over: number;
  edge_pct: number;
  signal: string;
  confidence_tier: string;
  games_analyzed: number;
  sport: string;
  team: string | null;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = getEasternDate();
    console.log(`[Pitcher K Analyzer] Starting analysis for ${today}`);

    // Fetch today's pitcher strikeout props from pp_snapshot
    // pitcher_strikeouts is unambiguous — no sport filter needed
    const { data: ppProps } = await supabase
      .from('pp_snapshot')
      .select('player_name, pp_line, team, sport')
      .eq('stat_type', 'pitcher_strikeouts')
      .eq('is_active', true)
      .order('captured_at', { ascending: false });

    // Also check mispriced_lines for any existing pitcher K entries from other analyzers
    const { data: existingMispriced } = await supabase
      .from('mispriced_lines')
      .select('player_name')
      .eq('prop_type', 'pitcher_strikeouts')
      .eq('analysis_date', today);

    // Deduplicate PP props by player (take latest)
    const seenPlayers = new Set<string>();
    const uniqueProps = (ppProps || []).filter(p => {
      const key = p.player_name.toLowerCase();
      if (seenPlayers.has(key)) return false;
      seenPlayers.add(key);
      return true;
    });

    console.log(`[Pitcher K Analyzer] Found ${uniqueProps.length} unique pitcher K props`);

    if (uniqueProps.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pitcher strikeout props found in pp_snapshot',
        analyzed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results: PitcherAnalysis[] = [];

    for (const prop of uniqueProps) {
      // Look up last 20 games with pitcher_strikeouts data
      const { data: gameLogs } = await supabase
        .from('mlb_player_game_logs')
        .select('pitcher_strikeouts, game_date')
        .eq('player_name', prop.player_name)
        .not('pitcher_strikeouts', 'is', null)
        .order('game_date', { ascending: false })
        .limit(20);

      if (!gameLogs || gameLogs.length < 3) {
        console.log(`[Pitcher K Analyzer] Skipping ${prop.player_name}: only ${gameLogs?.length || 0} games`);
        continue;
      }

      const allKs = gameLogs.map(g => g.pitcher_strikeouts as number);
      const l10Ks = allKs.slice(0, Math.min(10, allKs.length));
      const l20Ks = allKs;

      const l10Avg = l10Ks.reduce((s, v) => s + v, 0) / l10Ks.length;
      const l20Avg = l20Ks.reduce((s, v) => s + v, 0) / l20Ks.length;
      const l10Med = median(l10Ks);
      const l10Max = Math.max(...l10Ks);
      const l10Min = Math.min(...l10Ks);

      // Hit rate: how often they go OVER the line
      const hitRateOver = l10Ks.filter(k => k > prop.pp_line).length / l10Ks.length * 100;

      // Edge: positive = over edge, negative = under edge
      const edgePct = ((l10Avg - prop.pp_line) / prop.pp_line) * 100;
      const signal = edgePct > 0 ? 'OVER' : 'UNDER';

      // Confidence tier
      const absEdge = Math.abs(edgePct);
      let tier = 'MEDIUM';
      if (absEdge >= 25 && (signal === 'OVER' ? hitRateOver >= 70 : hitRateOver <= 30)) {
        tier = 'ELITE';
      } else if (absEdge >= 15 && (signal === 'OVER' ? hitRateOver >= 60 : hitRateOver <= 40)) {
        tier = 'HIGH';
      } else if (absEdge < 8) {
        continue; // Skip low edge
      }

      results.push({
        player_name: prop.player_name,
        pp_line: prop.pp_line,
        l10_avg: l10Avg,
        l20_avg: l20Avg,
        l10_median: l10Med,
        l10_max: l10Max,
        l10_min: l10Min,
        hit_rate_over: hitRateOver,
        edge_pct: edgePct,
        signal,
        confidence_tier: tier,
        games_analyzed: gameLogs.length,
        sport: 'baseball_mlb',
        team: prop.team,
      });
    }

    console.log(`[Pitcher K Analyzer] ${results.length} pitchers with edge >= 8%`);

    // Upsert into mispriced_lines
    if (results.length > 0) {
      const upsertRows = results.map(r => ({
        player_name: r.player_name,
        prop_type: 'pitcher_strikeouts',
        sport: r.sport,
        book_line: r.pp_line,
        player_avg_l10: r.l10_avg,
        edge_pct: r.edge_pct,
        signal: r.signal,
        confidence_tier: r.confidence_tier,
        analysis_date: today,
        source: 'pitcher_k_analyzer',
        metadata: {
          l20_avg: r.l20_avg,
          l10_median: r.l10_median,
          l10_max: r.l10_max,
          l10_min: r.l10_min,
          hit_rate_over: r.hit_rate_over,
          games_analyzed: r.games_analyzed,
          team: r.team,
        },
      }));

      const { error: upsertError } = await supabase
        .from('mispriced_lines')
        .upsert(upsertRows, { onConflict: 'player_name,prop_type,analysis_date' });

      if (upsertError) {
        console.error('[Pitcher K Analyzer] Upsert error:', upsertError);
      } else {
        console.log(`[Pitcher K Analyzer] Upserted ${upsertRows.length} mispriced lines`);
      }
    }

    // Send Telegram report
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && results.length > 0) {
      const tierOrder = ['ELITE', 'HIGH', 'MEDIUM'];
      const grouped: Record<string, PitcherAnalysis[]> = { ELITE: [], HIGH: [], MEDIUM: [] };
      results.forEach(r => grouped[r.confidence_tier]?.push(r));

      let msg = `⚾ *PITCHER K ANALYSIS — ${today}*\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `${results.length} pitchers with edge | `;
      msg += `ELITE: ${grouped.ELITE.length} | HIGH: ${grouped.HIGH.length} | MED: ${grouped.MEDIUM.length}\n\n`;

      for (const tier of tierOrder) {
        const plays = grouped[tier];
        if (plays.length === 0) continue;
        const emoji = tier === 'ELITE' ? '💎' : tier === 'HIGH' ? '🔥' : '📊';
        msg += `${emoji} *${tier}:*\n`;
        plays.slice(0, 5).forEach(p => {
          const edgeStr = p.edge_pct >= 0 ? `+${p.edge_pct.toFixed(0)}%` : `${p.edge_pct.toFixed(0)}%`;
          const hitStr = p.signal === 'OVER' ? `${p.hit_rate_over.toFixed(0)}% over` : `${(100 - p.hit_rate_over).toFixed(0)}% under`;
          msg += `• ${p.player_name} ${p.signal} ${p.pp_line}\n`;
          msg += `  L10: ${p.l10_avg.toFixed(1)} | Edge: ${edgeStr} | ${hitStr}\n`;
        });
        if (plays.length > 5) msg += `  +${plays.length - 5} more\n`;
        msg += `\n`;
      }

      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' }),
      });
    }

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'mlb-pitcher-k-analyzer',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        props_found: uniqueProps.length,
        analyzed: results.length,
        tiers: { ELITE: results.filter(r => r.confidence_tier === 'ELITE').length, HIGH: results.filter(r => r.confidence_tier === 'HIGH').length, MEDIUM: results.filter(r => r.confidence_tier === 'MEDIUM').length },
      },
    });

    return new Response(JSON.stringify({
      success: true,
      props_found: uniqueProps.length,
      analyzed: results.length,
      results: results.slice(0, 10),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Pitcher K Analyzer] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

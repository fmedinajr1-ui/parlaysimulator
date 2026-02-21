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

// Map pp_snapshot stat_type to mlb_player_game_logs column
const STAT_MAP: Record<string, string | null> = {
  batter_home_runs: 'home_runs',
  batter_total_bases: 'total_bases',
  player_hits: 'hits',
  batter_hits: 'hits',
  player_rbis: 'rbis',
  batter_rbis: 'rbis',
  player_runs: 'runs',
  batter_runs: 'runs',
  batter_stolen_bases: 'stolen_bases',
  player_fantasy_score: null, // calculated field
  player_hitter_fantasy_score: null, // calculated field (PP scraper key)
};

const BATTER_STAT_TYPES = Object.keys(STAT_MAP);

// Friendly labels for Telegram
const PROP_LABELS: Record<string, string> = {
  batter_home_runs: 'Home Runs',
  batter_total_bases: 'Total Bases',
  player_hits: 'Hits',
  batter_hits: 'Hits',
  player_rbis: 'RBIs',
  batter_rbis: 'RBIs',
  player_runs: 'Runs',
  batter_runs: 'Runs',
  batter_stolen_bases: 'Stolen Bases',
  player_fantasy_score: 'Fantasy Score',
  player_hitter_fantasy_score: 'Hitter Fantasy Score',
};

interface BatterAnalysis {
  player_name: string;
  stat_type: string;
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

function calcFantasyScore(log: any): number {
  return (log.hits || 0) + (log.walks || 0) + (log.runs || 0) +
         (log.rbis || 0) + (log.total_bases || 0) + (log.stolen_bases || 0);
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
    console.log(`[Batter Analyzer] Starting analysis for ${today}`);

    // Fetch today's batter props from pp_snapshot
    const { data: ppProps } = await supabase
      .from('pp_snapshot')
      .select('player_name, pp_line, team, sport, stat_type')
      .in('stat_type', BATTER_STAT_TYPES)
      .eq('is_active', true)
      .order('captured_at', { ascending: false });

    // Deduplicate by player + stat_type (take latest)
    const seen = new Set<string>();
    const uniqueProps = (ppProps || []).filter(p => {
      const key = `${p.player_name.toLowerCase()}|${p.stat_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[Batter Analyzer] Found ${uniqueProps.length} unique batter props`);

    if (uniqueProps.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No batter props found in pp_snapshot',
        analyzed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results: BatterAnalysis[] = [];

    // Group props by player to minimize DB queries
    const playerProps = new Map<string, typeof uniqueProps>();
    for (const prop of uniqueProps) {
      const key = prop.player_name;
      if (!playerProps.has(key)) playerProps.set(key, []);
      playerProps.get(key)!.push(prop);
    }

    for (const [playerName, props] of playerProps) {
      // Fetch last 20 games for this player (all stats at once)
      const { data: gameLogs } = await supabase
        .from('mlb_player_game_logs')
        .select('hits, walks, runs, rbis, total_bases, stolen_bases, home_runs, game_date')
        .eq('player_name', playerName)
        .order('game_date', { ascending: false })
        .limit(20);

      if (!gameLogs || gameLogs.length < 3) {
        console.log(`[Batter Analyzer] Skipping ${playerName}: only ${gameLogs?.length || 0} games`);
        continue;
      }

      for (const prop of props) {
        const statCol = STAT_MAP[prop.stat_type];
        const isFantasy = prop.stat_type === 'player_fantasy_score' || prop.stat_type === 'player_hitter_fantasy_score';

        // Extract values for the relevant stat
        let allVals: number[];
        if (isFantasy) {
          allVals = gameLogs.map(g => calcFantasyScore(g));
        } else if (statCol) {
          allVals = gameLogs.map(g => (g as any)[statCol] as number ?? 0);
        } else {
          continue;
        }

        const l10Vals = allVals.slice(0, Math.min(10, allVals.length));
        const l20Vals = allVals;

        const l10Avg = l10Vals.reduce((s, v) => s + v, 0) / l10Vals.length;
        const l20Avg = l20Vals.reduce((s, v) => s + v, 0) / l20Vals.length;
        const l10Med = median(l10Vals);
        const l10Max = Math.max(...l10Vals);
        const l10Min = Math.min(...l10Vals);

        const hitRateOver = l10Vals.filter(v => v > prop.pp_line).length / l10Vals.length * 100;
        const edgePct = ((l10Avg - prop.pp_line) / prop.pp_line) * 100;
        const signal = edgePct > 0 ? 'OVER' : 'UNDER';

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
          stat_type: prop.stat_type,
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
    }

    console.log(`[Batter Analyzer] ${results.length} props with edge >= 8%`);

    // Upsert into mispriced_lines
    if (results.length > 0) {
      const upsertRows = results.map(r => ({
        player_name: r.player_name,
        prop_type: r.stat_type,
        sport: r.sport,
        book_line: r.pp_line,
        player_avg_l10: r.l10_avg,
        edge_pct: r.edge_pct,
        signal: r.signal,
        confidence_tier: r.confidence_tier,
        analysis_date: today,
        source: 'mlb_batter_analyzer',
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
        console.error('[Batter Analyzer] Upsert error:', upsertError);
      } else {
        console.log(`[Batter Analyzer] Upserted ${upsertRows.length} mispriced lines`);
      }
    }

    // Send Telegram report
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && results.length > 0) {
      // Group by stat_type, then by tier within each
      const byProp = new Map<string, BatterAnalysis[]>();
      results.forEach(r => {
        if (!byProp.has(r.stat_type)) byProp.set(r.stat_type, []);
        byProp.get(r.stat_type)!.push(r);
      });

      let msg = `🏏 *MLB BATTER ANALYSIS — ${today}*\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `${results.length} plays with edge | `;
      msg += `ELITE: ${results.filter(r => r.confidence_tier === 'ELITE').length} | `;
      msg += `HIGH: ${results.filter(r => r.confidence_tier === 'HIGH').length} | `;
      msg += `MED: ${results.filter(r => r.confidence_tier === 'MEDIUM').length}\n\n`;

      for (const [statType, plays] of byProp) {
        const label = PROP_LABELS[statType] || statType;
        msg += `📌 *${label}* (${plays.length} plays)\n`;

        const tierOrder = ['ELITE', 'HIGH', 'MEDIUM'];
        for (const tier of tierOrder) {
          const tierPlays = plays.filter(p => p.confidence_tier === tier);
          if (tierPlays.length === 0) continue;
          const emoji = tier === 'ELITE' ? '💎' : tier === 'HIGH' ? '🔥' : '📊';
          msg += `${emoji} *${tier}:*\n`;
          tierPlays.slice(0, 5).forEach(p => {
            const edgeStr = p.edge_pct >= 0 ? `+${p.edge_pct.toFixed(0)}%` : `${p.edge_pct.toFixed(0)}%`;
            const hitStr = p.signal === 'OVER'
              ? `${p.hit_rate_over.toFixed(0)}% over`
              : `${(100 - p.hit_rate_over).toFixed(0)}% under`;
            msg += `• ${p.player_name} ${p.signal} ${p.pp_line}\n`;
            msg += `  L10: ${p.l10_avg.toFixed(1)} | Edge: ${edgeStr} | ${hitStr}\n`;
          });
          if (tierPlays.length > 5) msg += `  +${tierPlays.length - 5} more\n`;
        }
        msg += `\n`;
      }

      // Send (handle 4096 char limit)
      const chunks: string[] = [];
      let remaining = msg;
      while (remaining.length > 0) {
        if (remaining.length <= 4096) { chunks.push(remaining); break; }
        let splitAt = remaining.lastIndexOf('\n', 4096);
        if (splitAt < 100) splitAt = 4096;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
      }
      for (const chunk of chunks) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: chunk, parse_mode: 'Markdown' }),
        });
      }
    }

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'mlb-batter-analyzer',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        props_found: uniqueProps.length,
        analyzed: results.length,
        by_stat: Object.fromEntries(
          [...new Set(results.map(r => r.stat_type))].map(st => [st, results.filter(r => r.stat_type === st).length])
        ),
        tiers: {
          ELITE: results.filter(r => r.confidence_tier === 'ELITE').length,
          HIGH: results.filter(r => r.confidence_tier === 'HIGH').length,
          MEDIUM: results.filter(r => r.confidence_tier === 'MEDIUM').length,
        },
      },
    });

    return new Response(JSON.stringify({
      success: true,
      props_found: uniqueProps.length,
      analyzed: results.length,
      results: results.slice(0, 15),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Batter Analyzer] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

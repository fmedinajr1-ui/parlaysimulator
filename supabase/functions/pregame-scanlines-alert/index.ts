import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit' , day: '2-digit'
  }).format(new Date());
}

function formatEasternTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', hour12: true
  }).format(new Date(iso));
}

const SPORT_EMOJI: Record<string, string> = {
  'basketball_ncaab': '🏀',
  'basketball_nba': '🏀',
  'icehockey_nhl': '🏒',
  'baseball_mlb': '⚾',
  'americanfootball_nfl': '🏈',
};

const SPORT_LABEL: Record<string, string> = {
  'basketball_ncaab': 'NCAAB',
  'basketball_nba': 'NBA',
  'icehockey_nhl': 'NHL',
  'baseball_mlb': 'MLB',
  'americanfootball_nfl': 'NFL',
};

/**
 * pregame-scanlines-alert
 * 
 * Runs every 15 minutes. Finds games starting in 25-45 min window.
 * For games with strong signals (edge, whale, drift), sends Telegram alert.
 * Dedup via alert_sent flag on game_market_snapshots.
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!TELEGRAM_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: 'No TELEGRAM_BOT_TOKEN' }), { status: 500, headers: corsHeaders });
  }

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 25 * 60 * 1000); // 25 min from now
    const windowEnd = new Date(now.getTime() + 45 * 60 * 1000);   // 45 min from now

    console.log(`[PreGameAlert] Checking games between ${windowStart.toISOString()} and ${windowEnd.toISOString()}`);

    // Get latest snapshots for games in the window
    const { data: upcomingSnapshots } = await supabase
      .from('game_market_snapshots')
      .select('*')
      .eq('analysis_date', today)
      .gte('commence_time', windowStart.toISOString())
      .lte('commence_time', windowEnd.toISOString())
      .eq('alert_sent', false);

    if (!upcomingSnapshots || upcomingSnapshots.length === 0) {
      console.log('[PreGameAlert] No upcoming games in window');
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group by game_id + bet_type, keep latest snapshot
    const latestByGame = new Map<string, any>();
    for (const s of upcomingSnapshots) {
      const key = `${s.game_id}|${s.bet_type}`;
      const existing = latestByGame.get(key);
      if (!existing || new Date(s.scan_time) > new Date(existing.scan_time)) {
        latestByGame.set(key, s);
      }
    }

    // Get earliest snapshots for drift calculation
    const gameIds = [...new Set(upcomingSnapshots.map(s => s.game_id))];
    const { data: allSnapshots } = await supabase
      .from('game_market_snapshots')
      .select('game_id, bet_type, fanduel_line, fanduel_home_odds, fanduel_away_odds, scan_time')
      .eq('analysis_date', today)
      .in('game_id', gameIds)
      .order('scan_time', { ascending: true });

    const earliestMap = new Map<string, any>();
    for (const s of allSnapshots || []) {
      const key = `${s.game_id}|${s.bet_type}`;
      if (!earliestMap.has(key)) earliestMap.set(key, s);
    }

    // Load mispriced_lines for edge data
    const { data: mispricedLines } = await supabase
      .from('mispriced_lines')
      .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, shooting_context')
      .eq('analysis_date', today)
      .in('prop_type', ['game_total', 'game_moneyline']);

    const mispricedMap = new Map<string, any>();
    for (const ml of mispricedLines || []) {
      mispricedMap.set(`${ml.player_name}|${ml.prop_type}`, ml);
    }

    // Load whale picks for convergence
    const { data: whales } = await supabase
      .from('whale_picks')
      .select('player_name, stat_type, pick_side, sharp_score, confidence')
      .eq('is_expired', false)
      .gte('sharp_score', 50);

    const whaleMap = new Map<string, any>();
    for (const w of whales || []) {
      whaleMap.set((w.player_name || '').toLowerCase(), w);
    }

    // Load NCAAB stats for context
    const { data: ncaabStats } = await supabase
      .from('ncaab_team_stats')
      .select('team_name, kenpom_adj_o, kenpom_adj_d, adj_tempo, kenpom_rank, over_under_record, ats_record');

    const ncaabMap = new Map<string, any>();
    for (const t of ncaabStats || []) {
      ncaabMap.set(t.team_name?.toLowerCase(), t);
    }

    // Build alerts per game
    interface GameAlert {
      game_id: string;
      sport: string;
      home_team: string;
      away_team: string;
      commence_time: string;
      markets: {
        bet_type: string;
        signal: string;
        edge_pct: number;
        line: number | null;
        drift_trail: string;
        whale: boolean;
        kenpom_proj?: number;
        kenpom_tempo?: string;
        kenpom_rank_gap?: number;
      }[];
    }

    const gameAlerts = new Map<string, GameAlert>();

    for (const [key, latest] of latestByGame.entries()) {
      const earliest = earliestMap.get(key);
      const matchupStr = `${latest.away_team} @ ${latest.home_team}`;
      const propType = latest.bet_type === 'total' ? 'game_total' : 'game_moneyline';
      const mispriced = mispricedMap.get(`${matchupStr}|${propType}`);

      // Calculate drift
      let driftAmount = 0;
      let driftTrail = '';
      if (earliest && latest.fanduel_line != null && earliest.fanduel_line != null) {
        driftAmount = Math.abs(latest.fanduel_line - earliest.fanduel_line);
        if (driftAmount > 0) {
          driftTrail = `${earliest.fanduel_line} → ${latest.fanduel_line}`;
        }
      } else if (earliest && latest.bet_type === 'moneyline') {
        const homeShift = Math.abs((latest.fanduel_home_odds || 0) - (earliest.fanduel_home_odds || 0));
        driftAmount = homeShift;
        if (homeShift >= 10) {
          driftTrail = `${earliest.fanduel_home_odds > 0 ? '+' : ''}${earliest.fanduel_home_odds} → ${latest.fanduel_home_odds > 0 ? '+' : ''}${latest.fanduel_home_odds}`;
        }
      }

      const edgePct = mispriced?.edge_pct || 0;
      const signal = mispriced?.signal || 'HOLD';
      const whaleKey1 = `${latest.away_team} @ ${latest.home_team}`.toLowerCase();
      const whaleKey2 = `${latest.away_team} vs ${latest.home_team}`.toLowerCase();
      const hasWhale = whaleMap.has(whaleKey1) || whaleMap.has(whaleKey2);

      const isDramaticDrift = (latest.bet_type === 'total' && driftAmount >= 1.5) ||
                              (latest.bet_type === 'moneyline' && driftAmount >= 15);

      // Only alert on strong signals
      if (edgePct < 5 && !hasWhale && !isDramaticDrift) continue;

      // KenPom context for NCAAB
      let kenpomProj: number | undefined;
      let kenpomTempo: string | undefined;
      let kenpomRankGap: number | undefined;

      if (latest.sport?.includes('ncaab')) {
        const homeStats = ncaabMap.get(latest.home_team?.toLowerCase());
        const awayStats = ncaabMap.get(latest.away_team?.toLowerCase());
        if (homeStats && awayStats) {
          const avgTempo = ((homeStats.adj_tempo || 66) + (awayStats.adj_tempo || 66)) / 2;
          kenpomTempo = avgTempo >= 70 ? 'HIGH' : avgTempo <= 64 ? 'LOW' : 'MED';
          kenpomRankGap = Math.abs((homeStats.kenpom_rank || 0) - (awayStats.kenpom_rank || 0));

          if (latest.bet_type === 'total') {
            const homeO = homeStats.kenpom_adj_o || 100;
            const homeD = homeStats.kenpom_adj_d || 100;
            const awayO = awayStats.kenpom_adj_o || 100;
            const awayD = awayStats.kenpom_adj_d || 100;
            const homeProj = (homeO + awayD) / 200 * avgTempo;
            const awayProj = (awayO + homeD) / 200 * avgTempo;
            kenpomProj = Math.round((homeProj + awayProj) * 10) / 10;
          }
        }
      }

      if (!gameAlerts.has(latest.game_id)) {
        gameAlerts.set(latest.game_id, {
          game_id: latest.game_id,
          sport: latest.sport,
          home_team: latest.home_team,
          away_team: latest.away_team,
          commence_time: latest.commence_time,
          markets: [],
        });
      }

      gameAlerts.get(latest.game_id)!.markets.push({
        bet_type: latest.bet_type,
        signal,
        edge_pct: edgePct,
        line: latest.fanduel_line,
        drift_trail: driftTrail,
        whale: hasWhale,
        kenpom_proj: kenpomProj,
        kenpom_tempo: kenpomTempo,
        kenpom_rank_gap: kenpomRankGap,
      });
    }

    if (gameAlerts.size === 0) {
      console.log('[PreGameAlert] No games met alert threshold');
      return new Response(JSON.stringify({ success: true, alerts: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==================== BUILD TELEGRAM MESSAGE ====================
    let msg = `⏰ *PRE-GAME ALERT* — 30 min to tip\\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━\\n\\n`;

    // Group by sport
    const bySport = new Map<string, GameAlert[]>();
    for (const ga of gameAlerts.values()) {
      if (!bySport.has(ga.sport)) bySport.set(ga.sport, []);
      bySport.get(ga.sport)!.push(ga);
    }

    for (const [sport, games] of bySport.entries()) {
      const emoji = SPORT_EMOJI[sport] || '🎯';
      const label = SPORT_LABEL[sport] || sport.toUpperCase();
      msg += `${emoji} *${label}*\\n`;

      for (const game of games) {
        const tipTime = formatEasternTime(game.commence_time);
        msg += `\\n*${game.away_team} @ ${game.home_team}* (${tipTime} ET)\\n`;

        for (const mkt of game.markets) {
          if (mkt.bet_type === 'total') {
            const tierIcon = mkt.edge_pct >= 10 ? '💎' : mkt.edge_pct >= 7 ? '🔥' : '📊';
            msg += `${tierIcon} TOTAL ${mkt.signal} ${mkt.line}`;
            msg += ` | Edge: +${mkt.edge_pct.toFixed(0)}%\\n`;

            if (mkt.kenpom_proj) {
              msg += `   KenPom proj: ${mkt.kenpom_proj} | Tempo: ${mkt.kenpom_tempo || '?'}\\n`;
            }
          } else {
            const tierIcon = mkt.edge_pct >= 10 ? '💎' : mkt.edge_pct >= 7 ? '🔥' : '💰';
            msg += `${tierIcon} ML ${mkt.signal}`;
            msg += ` | Edge: +${mkt.edge_pct.toFixed(0)}%\\n`;

            if (mkt.kenpom_rank_gap) {
              const zoneLabel = mkt.kenpom_rank_gap <= 50 ? 'upset zone' : 'mismatch';
              msg += `   KenPom gap: ${mkt.kenpom_rank_gap} (${zoneLabel})\\n`;
            }
          }

          if (mkt.drift_trail) {
            const isDramatic = (mkt.bet_type === 'total' && Math.abs((mkt.line || 0)) >= 1.5) || mkt.drift_trail.includes('→');
            const driftIcon = mkt.signal === 'UNDER' || mkt.signal === 'DOWN' ? '📉' : '📈';
            msg += `   ${driftIcon} Drift: ${mkt.drift_trail}${isDramatic ? ' (DRAMATIC)' : ''}\\n`;
          }

          if (mkt.whale) {
            msg += `   🐋 Whale convergence confirmed\\n`;
          }
        }
      }
      msg += '\\n';
    }

    // Send to all authorized admin users
    const { data: adminUsers } = await supabase
      .from('bot_authorized_users')
      .select('chat_id')
      .eq('is_active', true);

    const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
    let alertsSent = 0;

    for (const user of adminUsers || []) {
      try {
        const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.chat_id,
            text: msg,
            parse_mode: 'Markdown',
          }),
        });
        if (resp.ok) alertsSent++;
        else {
          // Fallback without parse mode
          await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: user.chat_id, text: msg }),
          });
          alertsSent++;
        }
      } catch (e) {
        console.error(`[PreGameAlert] Failed to send to ${user.chat_id}:`, e);
      }
    }

    // Mark alerts as sent to prevent re-sending
    const alertedGameIds = [...gameAlerts.keys()];
    await supabase
      .from('game_market_snapshots')
      .update({ alert_sent: true })
      .eq('analysis_date', today)
      .in('game_id', alertedGameIds);

    console.log(`[PreGameAlert] Sent ${alertsSent} alerts for ${gameAlerts.size} games`);

    await supabase.from('cron_job_history').insert({
      job_name: 'pregame-scanlines-alert',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: { games_alerted: gameAlerts.size, alerts_sent: alertsSent },
    });

    return new Response(JSON.stringify({ success: true, games: gameAlerts.size, alerts: alertsSent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PreGameAlert] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

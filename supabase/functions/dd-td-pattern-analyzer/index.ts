import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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

interface GameLog {
  player_name: string;
  opponent: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  minutes_played: number | null;
  min: number | null;
  game_date: string;
  is_home: boolean;
}

interface PlayerStats {
  player_name: string;
  games_played: number;
  dd_count: number;
  td_count: number;
  season_dd_rate: number;
  season_td_rate: number;
  home_dd_rate: number;
  away_dd_rate: number;
  l10_dd_rate: number;
  l10_td_rate: number;
  near_miss_rate: number;
  avg_minutes: number;
  opponent_dd_rates: Record<string, { dd: number; total: number; rate: number }>;
}

function countDDCategories(g: GameLog): number {
  return [
    g.points >= 10,
    g.rebounds >= 10,
    g.assists >= 10,
    g.steals >= 10,
    g.blocks >= 10,
  ].filter(Boolean).length;
}

function isNearMiss(g: GameLog): boolean {
  const cats10 = countDDCategories(g);
  if (cats10 !== 1) return false;
  const nearCats = [
    g.points >= 8 && g.points < 10,
    g.rebounds >= 8 && g.rebounds < 10,
    g.assists >= 8 && g.assists < 10,
  ].filter(Boolean).length;
  return nearCats >= 1;
}

function analyzePlayer(playerName: string, games: GameLog[]): PlayerStats | null {
  if (games.length < 10) return null;

  let ddCount = 0, tdCount = 0, nearMissCount = 0;
  let homeDd = 0, homeTotal = 0, awayDd = 0, awayTotal = 0;
  let totalMinutes = 0;
  const oppStats: Record<string, { dd: number; total: number }> = {};

  for (const g of games) {
    const cats = countDDCategories(g);
    const isDD = cats >= 2;
    const isTD = cats >= 3;
    if (isDD) ddCount++;
    if (isTD) tdCount++;
    if (isNearMiss(g)) nearMissCount++;
    totalMinutes += g.minutes_played || g.min || 0;

    if (g.is_home) {
      homeTotal++;
      if (isDD) homeDd++;
    } else {
      awayTotal++;
      if (isDD) awayDd++;
    }

    const opp = g.opponent || 'UNK';
    if (!oppStats[opp]) oppStats[opp] = { dd: 0, total: 0 };
    oppStats[opp].total++;
    if (isDD) oppStats[opp].dd++;
  }

  // L10
  const last10 = games.slice(0, 10);
  let l10Dd = 0, l10Td = 0;
  for (const g of last10) {
    const cats = countDDCategories(g);
    if (cats >= 2) l10Dd++;
    if (cats >= 3) l10Td++;
  }

  const oppRates: Record<string, { dd: number; total: number; rate: number }> = {};
  for (const [opp, s] of Object.entries(oppStats)) {
    if (s.total >= 2) {
      oppRates[opp] = { ...s, rate: s.dd / s.total };
    }
  }

  return {
    player_name: playerName,
    games_played: games.length,
    dd_count: ddCount,
    td_count: tdCount,
    season_dd_rate: ddCount / games.length,
    season_td_rate: tdCount / games.length,
    home_dd_rate: homeTotal > 0 ? homeDd / homeTotal : 0,
    away_dd_rate: awayTotal > 0 ? awayDd / awayTotal : 0,
    l10_dd_rate: l10Dd / last10.length,
    l10_td_rate: l10Td / last10.length,
    near_miss_rate: nearMissCount / games.length,
    avg_minutes: totalMinutes / games.length,
    opponent_dd_rates: oppRates,
  };
}

// Common team abbreviation resolver
function resolveTeamAbbrev(name: string): string {
  const n = name.toLowerCase().trim();
  const map: Record<string, string> = {
    'atlanta hawks': 'ATL', hawks: 'ATL',
    'boston celtics': 'BOS', celtics: 'BOS',
    'brooklyn nets': 'BKN', nets: 'BKN',
    'charlotte hornets': 'CHA', hornets: 'CHA',
    'chicago bulls': 'CHI', bulls: 'CHI',
    'cleveland cavaliers': 'CLE', cavaliers: 'CLE', cavs: 'CLE',
    'dallas mavericks': 'DAL', mavericks: 'DAL', mavs: 'DAL',
    'denver nuggets': 'DEN', nuggets: 'DEN',
    'detroit pistons': 'DET', pistons: 'DET',
    'golden state warriors': 'GSW', warriors: 'GSW',
    'houston rockets': 'HOU', rockets: 'HOU',
    'indiana pacers': 'IND', pacers: 'IND',
    'los angeles clippers': 'LAC', 'la clippers': 'LAC', clippers: 'LAC',
    'los angeles lakers': 'LAL', 'la lakers': 'LAL', lakers: 'LAL',
    'memphis grizzlies': 'MEM', grizzlies: 'MEM',
    'miami heat': 'MIA', heat: 'MIA',
    'milwaukee bucks': 'MIL', bucks: 'MIL',
    'minnesota timberwolves': 'MIN', timberwolves: 'MIN', wolves: 'MIN',
    'new orleans pelicans': 'NOP', pelicans: 'NOP',
    'new york knicks': 'NYK', knicks: 'NYK',
    'oklahoma city thunder': 'OKC', thunder: 'OKC',
    'orlando magic': 'ORL', magic: 'ORL',
    'philadelphia 76ers': 'PHI', '76ers': 'PHI', sixers: 'PHI',
    'phoenix suns': 'PHX', suns: 'PHX',
    'portland trail blazers': 'POR', 'trail blazers': 'POR', blazers: 'POR',
    'sacramento kings': 'SAC', kings: 'SAC',
    'san antonio spurs': 'SAS', spurs: 'SAS',
    'toronto raptors': 'TOR', raptors: 'TOR',
    'utah jazz': 'UTA', jazz: 'UTA',
    'washington wizards': 'WAS', wizards: 'WAS',
  };
  if (map[n]) return map[n];
  // Try 3-letter uppercase
  if (n.length === 3) return n.toUpperCase();
  return name.toUpperCase().slice(0, 3);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = getEasternDate();
    console.log(`[DD/TD] Analyzing patterns for ${today}...`);

    // 1. Fetch all game logs (sorted by date desc for L10 slicing)
    const allLogs: GameLog[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, opponent, points, rebounds, assists, steals, blocks, minutes_played, min, game_date, is_home')
        .order('game_date', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) { console.error('[DD/TD] fetch error:', error.message); break; }
      if (!data || data.length === 0) break;
      allLogs.push(...(data as GameLog[]));
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    console.log(`[DD/TD] Total game logs fetched: ${allLogs.length}`);

    // 2. Group by player
    const playerGames = new Map<string, GameLog[]>();
    for (const g of allLogs) {
      const name = g.player_name;
      if (!playerGames.has(name)) playerGames.set(name, []);
      playerGames.get(name)!.push(g);
    }

    // 2b. Build player→team map from bdl_player_cache
    const playerTeamMap = new Map<string, string>();
    let ptOffset = 0;
    while (true) {
      const { data: ptData } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name')
        .not('team_name', 'is', null)
        .range(ptOffset, ptOffset + 999);
      if (!ptData || ptData.length === 0) break;
      for (const p of ptData) {
        playerTeamMap.set(p.player_name, p.team_name);
      }
      if (ptData.length < 1000) break;
      ptOffset += 1000;
    }
    console.log(`[DD/TD] Player→team mappings loaded: ${playerTeamMap.size}`);

    // 3. Analyze each player
    const allStats: (PlayerStats & { team: string })[] = [];
    for (const [name, games] of playerGames) {
      const stats = analyzePlayer(name, games);
      if (stats && stats.season_dd_rate >= 0.15) {
        const team = playerTeamMap.get(name) || '';
        allStats.push({ ...stats, team });
      }
    }
    console.log(`[DD/TD] Players with 15%+ DD rate: ${allStats.length}`);

    // 4. Get tonight's schedule from game_bets (noon-to-noon ET window)
    const [yr, mo, dy] = today.split('-').map(Number);
    const noonUtcStart = new Date(Date.UTC(yr, mo - 1, dy, 17, 0, 0));
    const noonUtcEnd = new Date(noonUtcStart.getTime() + 24 * 60 * 60 * 1000);
    const startUtc = noonUtcStart.toISOString();
    const endUtc = noonUtcEnd.toISOString();

    const { data: todayGames } = await supabase
      .from('game_bets')
      .select('game_id, home_team, away_team, commence_time')
      .eq('sport', 'basketball_nba')
      .gte('commence_time', startUtc)
      .lt('commence_time', endUtc)
      .limit(500);

    // Deduplicate
    const seenIds = new Set<string>();
    const uniqueGames = (todayGames || []).filter(g => {
      if (!g.game_id || seenIds.has(g.game_id)) return false;
      seenIds.add(g.game_id);
      return true;
    });
    console.log(`[DD/TD] Tonight's games: ${uniqueGames.length}`);

    // Build team→opponent+home map
    const teamSchedule = new Map<string, { opponent: string; isHome: boolean }>();
    for (const game of uniqueGames) {
      const home = resolveTeamAbbrev(game.home_team || '');
      const away = resolveTeamAbbrev(game.away_team || '');
      teamSchedule.set(home, { opponent: away, isHome: true });
      teamSchedule.set(away, { opponent: home, isHome: false });
    }

    // 4b. Load defense rankings for matchup context
    const { data: defenseData } = await supabase
      .from('team_defense_rankings')
      .select('team_abbreviation, overall_rank, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank')
      .eq('is_current', true);

    const defenseMap = new Map<string, { overall_rank: number; opp_points_rank: number; opp_rebounds_rank: number; opp_assists_rank: number; opp_threes_rank: number }>();
    if (defenseData) {
      for (const r of defenseData) {
        defenseMap.set((r.team_abbreviation || '').toUpperCase(), {
          overall_rank: r.overall_rank ?? 15,
          opp_points_rank: r.opp_points_rank ?? 15,
          opp_rebounds_rank: r.opp_rebounds_rank ?? 15,
          opp_assists_rank: r.opp_assists_rank ?? 15,
          opp_threes_rank: r.opp_threes_rank ?? 15,
        });
      }
    }
    console.log(`[DD/TD] Loaded ${defenseMap.size} team defense profiles`);

    // 5. Score candidates who play tonight
    interface Candidate {
      player_name: string;
      prediction_type: 'DD' | 'TD';
      season_rate: number;
      home_away_rate: number;
      vs_opponent_rate: number;
      l10_rate: number;
      composite_score: number;
      opponent: string;
      is_home: boolean;
      near_miss_rate: number;
      games_played: number;
      defense_overall_rank: number | null;
      defense_pts_rank: number | null;
      defense_reb_rank: number | null;
      defense_ast_rank: number | null;
      matchup_label: string;
    }

    const candidates: Candidate[] = [];

    for (const stats of allStats) {
      const teamAbbrev = resolveTeamAbbrev(stats.team);
      const schedule = teamSchedule.get(teamAbbrev);
      if (!schedule) continue;

      const { opponent, isHome } = schedule;
      const contextRate = isHome ? stats.home_dd_rate : stats.away_dd_rate;
      const oppRate = stats.opponent_dd_rates[opponent]?.rate ?? stats.season_dd_rate;

      // Defense matchup boost
      const oppDef = defenseMap.get(opponent);
      let matchupBoost = 0;
      let matchupLabel = '';
      if (oppDef) {
        if (oppDef.opp_points_rank >= 25) matchupBoost += 0.08;
        if (oppDef.opp_rebounds_rank >= 25) matchupBoost += 0.06;
        if (oppDef.opp_assists_rank >= 25) matchupBoost += 0.04;
        if (oppDef.overall_rank >= 25) matchupBoost += 0.05;
        if (oppDef.overall_rank <= 5) matchupBoost -= 0.05;

        if (oppDef.overall_rank >= 25) matchupLabel = '🔥 Elite matchup';
        else if (oppDef.overall_rank >= 18) matchupLabel = '✅ Favorable';
        else if (oppDef.overall_rank <= 5) matchupLabel = '⚠️ Tough defense';
        else matchupLabel = '';
      }

      const ddComposite = 0.40 * stats.season_dd_rate
        + 0.25 * contextRate
        + 0.20 * stats.l10_dd_rate
        + 0.15 * oppRate
        + matchupBoost;

      candidates.push({
        player_name: stats.player_name,
        prediction_type: 'DD',
        season_rate: stats.season_dd_rate,
        home_away_rate: contextRate,
        vs_opponent_rate: oppRate,
        l10_rate: stats.l10_dd_rate,
        composite_score: ddComposite,
        opponent,
        is_home: isHome,
        near_miss_rate: stats.near_miss_rate,
        games_played: stats.games_played,
        defense_overall_rank: oppDef?.overall_rank ?? null,
        defense_pts_rank: oppDef?.opp_points_rank ?? null,
        defense_reb_rank: oppDef?.opp_rebounds_rank ?? null,
        defense_ast_rank: oppDef?.opp_assists_rank ?? null,
        matchup_label: matchupLabel,
      });

      // TD candidate if meaningful TD rate
      if (stats.season_td_rate >= 0.05 || stats.td_count >= 3) {
        const tdComposite = 0.40 * stats.season_td_rate
          + 0.25 * (isHome ? stats.home_dd_rate * (stats.season_td_rate / Math.max(stats.season_dd_rate, 0.01)) : stats.away_dd_rate * (stats.season_td_rate / Math.max(stats.season_dd_rate, 0.01)))
          + 0.20 * stats.l10_td_rate
          + 0.15 * stats.season_td_rate
          + matchupBoost;

        candidates.push({
          player_name: stats.player_name,
          prediction_type: 'TD',
          season_rate: stats.season_td_rate,
          home_away_rate: isHome ? stats.home_dd_rate : stats.away_dd_rate,
          vs_opponent_rate: stats.season_td_rate,
          l10_rate: stats.l10_td_rate,
          composite_score: tdComposite,
          opponent,
          is_home: isHome,
          near_miss_rate: stats.near_miss_rate,
          games_played: stats.games_played,
          defense_overall_rank: oppDef?.overall_rank ?? null,
          defense_pts_rank: oppDef?.opp_points_rank ?? null,
          defense_reb_rank: oppDef?.opp_rebounds_rank ?? null,
          defense_ast_rank: oppDef?.opp_assists_rank ?? null,
          matchup_label: matchupLabel,
        });
      }
    }

    // Sort by composite descending
    candidates.sort((a, b) => b.composite_score - a.composite_score);

    // No limits - show ALL candidates
    const ddCandidates = candidates.filter(c => c.prediction_type === 'DD');
    const tdCandidates = candidates.filter(c => c.prediction_type === 'TD');

    console.log(`[DD/TD] DD candidates: ${ddCandidates.length}, TD candidates: ${tdCandidates.length}`);

    // 6. Upsert predictions into dd_td_predictions
    const allTop = [...ddCandidates, ...tdCandidates];
    if (allTop.length > 0) {
      const rows = allTop.map(c => ({
        prediction_date: today,
        player_name: c.player_name,
        prediction_type: c.prediction_type,
        season_rate: Math.round(c.season_rate * 1000) / 1000,
        home_away_rate: Math.round(c.home_away_rate * 1000) / 1000,
        vs_opponent_rate: Math.round(c.vs_opponent_rate * 1000) / 1000,
        l10_rate: Math.round(c.l10_rate * 1000) / 1000,
        composite_score: Math.round(c.composite_score * 1000) / 1000,
        opponent: c.opponent,
        is_home: c.is_home,
        near_miss_rate: Math.round(c.near_miss_rate * 1000) / 1000,
        games_played: c.games_played,
        outcome: 'pending',
      }));

      const { error: upsertErr } = await supabase
        .from('dd_td_predictions')
        .upsert(rows, { onConflict: 'prediction_date,player_name,prediction_type', ignoreDuplicates: false });

      if (upsertErr) console.error('[DD/TD] upsert error:', upsertErr.message);
      else console.log(`[DD/TD] Upserted ${rows.length} predictions`);
    }

    // 7. Send to Telegram
    if (ddCandidates.length > 0 || tdCandidates.length > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'dd_td_candidates',
            data: {
              ddCandidates,
              tdCandidates,
              date: today,
              totalPlayersAnalyzed: allStats.length,
              totalGamesLogged: allLogs.length,
            },
          }),
        });
        console.log('[DD/TD] Telegram report sent');
      } catch (e) {
        console.error('[DD/TD] Telegram send error:', e);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      date: today,
      ddCandidates: ddCandidates.length,
      tdCandidates: tdCandidates.length,
      totalPlayersAnalyzed: allStats.length,
      topDD: ddCandidates.slice(0, 5).map(c => ({
        player: c.player_name,
        score: Math.round(c.composite_score * 100),
        opponent: c.opponent,
        isHome: c.is_home,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[DD/TD] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

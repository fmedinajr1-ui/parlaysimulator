import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NBA_STATS_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

// NBA team name normalization (NBA API uses full names, live_game_scores may use abbreviations)
const TEAM_ABBREV_TO_FULL: Record<string, string> = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets',
  CHI: 'Chicago Bulls', CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets',
  DET: 'Detroit Pistons', GSW: 'Golden State Warriors', GS: 'Golden State Warriors',
  HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers',
  LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies', MIA: 'Miami Heat',
  MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans',
  NO: 'New Orleans Pelicans', NYK: 'New York Knicks', NY: 'New York Knicks',
  OKC: 'Oklahoma City Thunder', ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers',
  PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers', SAC: 'Sacramento Kings',
  SAS: 'San Antonio Spurs', SA: 'San Antonio Spurs', TOR: 'Toronto Raptors',
  UTA: 'Utah Jazz', WAS: 'Washington Wizards',
};

// Quarter time ranges for boxscoretraditionalv2 RangeType=2
const QUARTER_RANGES = [
  { quarter: 1, StartPeriod: 1, EndPeriod: 1, StartRange: 0, EndRange: 7200 },
  { quarter: 2, StartPeriod: 2, EndPeriod: 2, StartRange: 7200, EndRange: 14400 },
  { quarter: 3, StartPeriod: 3, EndPeriod: 3, StartRange: 14400, EndRange: 21600 },
  { quarter: 4, StartPeriod: 4, EndPeriod: 4, StartRange: 21600, EndRange: 28800 },
];

interface NBAScoreboardGame {
  gameId: string;
  homeTeam: { teamName: string; teamTricode: string };
  awayTeam: { teamName: string; teamTricode: string };
  gameStatus: number;
}

function normalizeTeamName(name: string): string {
  // Try direct abbrev lookup
  const upper = name.toUpperCase().trim();
  if (TEAM_ABBREV_TO_FULL[upper]) return TEAM_ABBREV_TO_FULL[upper];
  // Already a full name — normalize common variations
  const lower = name.toLowerCase();
  for (const fullName of Object.values(TEAM_ABBREV_TO_FULL)) {
    if (fullName.toLowerCase() === lower) return fullName;
    // Partial match: "Hawks" matches "Atlanta Hawks"
    if (fullName.toLowerCase().includes(lower) || lower.includes(fullName.toLowerCase().split(' ').pop()!)) {
      return fullName;
    }
  }
  return name;
}

async function fetchNBAScoreboard(): Promise<NBAScoreboardGame[]> {
  try {
    const resp = await fetch('https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json', {
      headers: { 'User-Agent': NBA_STATS_HEADERS['User-Agent'] },
    });
    if (!resp.ok) {
      console.error(`[backfill-quarter-stats] Scoreboard fetch failed: ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return (data.scoreboard?.games || []).map((g: any) => ({
      gameId: g.gameId,
      homeTeam: { teamName: g.homeTeam?.teamName || '', teamTricode: g.homeTeam?.teamTricode || '' },
      awayTeam: { teamName: g.awayTeam?.teamName || '', teamTricode: g.awayTeam?.teamTricode || '' },
      gameStatus: g.gameStatus,
    }));
  } catch (err) {
    console.error('[backfill-quarter-stats] Scoreboard error:', err);
    return [];
  }
}

function matchGameToNBAId(
  espnHome: string,
  espnAway: string,
  scoreboardGames: NBAScoreboardGame[]
): string | null {
  const normHome = normalizeTeamName(espnHome).toLowerCase();
  const normAway = normalizeTeamName(espnAway).toLowerCase();

  for (const game of scoreboardGames) {
    const nbaHome = game.homeTeam.teamName.toLowerCase();
    const nbaAway = game.awayTeam.teamName.toLowerCase();
    // Match by team name substring (e.g., "Hawks" in "Atlanta Hawks")
    if (
      (normHome.includes(nbaHome) || nbaHome.includes(normHome.split(' ').pop()!)) &&
      (normAway.includes(nbaAway) || nbaAway.includes(normAway.split(' ').pop()!))
    ) {
      return game.gameId;
    }
  }
  return null;
}

async function fetchQuarterBoxScore(
  nbaGameId: string,
  qRange: typeof QUARTER_RANGES[0]
): Promise<Array<{ playerName: string; team: string; pts: number; reb: number; ast: number; fg3m: number; stl: number; blk: number; min: number }>> {
  const url = `https://stats.nba.com/stats/boxscoretraditionalv2?GameID=${nbaGameId}&StartPeriod=${qRange.StartPeriod}&EndPeriod=${qRange.EndPeriod}&StartRange=${qRange.StartRange}&EndRange=${qRange.EndRange}&RangeType=2`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(url, { headers: NBA_STATS_HEADERS, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        console.error(`[backfill-quarter-stats] NBA API ${resp.status} for game ${nbaGameId} Q${qRange.quarter} (attempt ${attempt})`);
        if (attempt < 3) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }
        return [];
      }

      const json = await resp.json();
      // resultSets[0] = PlayerStats
      const resultSet = json.resultSets?.find((rs: any) => rs.name === 'PlayerStats') || json.resultSets?.[0];
      if (!resultSet) return [];

      const headers: string[] = resultSet.headers || [];
      const rows: any[][] = resultSet.rowSet || [];

      const idx = (name: string) => headers.indexOf(name);
      const playerIdx = idx('PLAYER_NAME');
      const teamIdx = idx('TEAM_ABBREVIATION');
      const ptsIdx = idx('PTS');
      const rebIdx = idx('REB');
      const astIdx = idx('AST');
      const fg3mIdx = idx('FG3M');
      const stlIdx = idx('STL');
      const blkIdx = idx('BLK');
      const minIdx = idx('MIN');

      if (playerIdx === -1 || ptsIdx === -1) return [];

      return rows.map(row => ({
        playerName: row[playerIdx],
        team: row[teamIdx] || '',
        pts: Number(row[ptsIdx]) || 0,
        reb: Number(row[rebIdx]) || 0,
        ast: Number(row[astIdx]) || 0,
        fg3m: Number(row[fg3mIdx]) || 0,
        stl: Number(row[stlIdx]) || 0,
        blk: Number(row[blkIdx]) || 0,
        min: parseFloat(String(row[minIdx]).split(':')[0]) || 0,
      }));
    } catch (err) {
      console.error(`[backfill-quarter-stats] Fetch error Q${qRange.quarter} attempt ${attempt}:`, err);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get today's final NBA games from live_game_scores
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const { data: finalGames, error: gamesError } = await supabase
      .from('live_game_scores')
      .select('event_id, home_team, away_team, game_status, start_time')
      .eq('sport', 'basketball')
      .gte('start_time', `${todayStr}T00:00:00Z`)
      .in('game_status', ['final', 'Final', 'STATUS_FINAL']);

    if (gamesError) {
      console.error('[backfill-quarter-stats] Error fetching games:', gamesError);
      return new Response(JSON.stringify({ error: gamesError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!finalGames || finalGames.length === 0) {
      console.log('[backfill-quarter-stats] No final NBA games found for today');
      return new Response(JSON.stringify({ message: 'No final games to backfill', gamesProcessed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Check which games already have backfilled data (avoid re-processing)
    const eventIds = finalGames.map(g => g.event_id);
    const { data: existingSnapshots } = await supabase
      .from('quarter_player_snapshots')
      .select('event_id')
      .in('event_id', eventIds)
      .eq('quarter', 1)
      .limit(1000);

    // Count snapshots per event — if an event has 10+ Q1 rows, it's already backfilled
    const snapshotCounts = new Map<string, number>();
    for (const s of existingSnapshots || []) {
      snapshotCounts.set(s.event_id, (snapshotCounts.get(s.event_id) || 0) + 1);
    }
    const alreadyBackfilled = new Set(
      [...snapshotCounts.entries()].filter(([, count]) => count >= 8).map(([id]) => id)
    );

    const gamesToProcess = finalGames.filter(g => !alreadyBackfilled.has(g.event_id));
    if (gamesToProcess.length === 0) {
      console.log('[backfill-quarter-stats] All final games already backfilled');
      return new Response(JSON.stringify({ message: 'All games already backfilled', gamesProcessed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Fetch NBA scoreboard for game ID mapping
    const scoreboardGames = await fetchNBAScoreboard();
    if (scoreboardGames.length === 0) {
      console.error('[backfill-quarter-stats] Could not fetch NBA scoreboard');
      return new Response(JSON.stringify({ error: 'NBA scoreboard unavailable' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalInserted = 0;
    let gamesProcessed = 0;
    const errors: string[] = [];

    for (const game of gamesToProcess) {
      const nbaGameId = matchGameToNBAId(game.home_team, game.away_team, scoreboardGames);
      if (!nbaGameId) {
        console.warn(`[backfill-quarter-stats] No NBA ID match for ${game.home_team} vs ${game.away_team} (ESPN: ${game.event_id})`);
        errors.push(`No NBA ID for ${game.home_team} vs ${game.away_team}`);
        continue;
      }

      console.log(`[backfill-quarter-stats] Processing ${game.home_team} vs ${game.away_team} → NBA ID ${nbaGameId}`);

      const rows: Array<{
        event_id: string;
        espn_event_id: string;
        player_name: string;
        team: string;
        quarter: number;
        points: number;
        rebounds: number;
        assists: number;
        threes: number;
        steals: number;
        blocks: number;
        minutes_played: number;
        captured_at: string;
      }> = [];

      // Fetch all 4 quarters with a small delay between to avoid rate limiting
      for (const qRange of QUARTER_RANGES) {
        const players = await fetchQuarterBoxScore(nbaGameId, qRange);

        for (const p of players) {
          rows.push({
            event_id: game.event_id,
            espn_event_id: game.event_id,
            player_name: p.playerName,
            team: p.team,
            quarter: qRange.quarter,
            points: p.pts,
            rebounds: p.reb,
            assists: p.ast,
            threes: p.fg3m,
            steals: p.stl,
            blocks: p.blk,
            minutes_played: p.min,
            captured_at: new Date().toISOString(),
          });
        }

        // Small delay between quarter requests to avoid NBA rate limiting
        if (qRange.quarter < 4) {
          await new Promise(r => setTimeout(r, 600));
        }
      }

      if (rows.length === 0) {
        errors.push(`No player data returned for ${game.home_team} vs ${game.away_team}`);
        continue;
      }

      // Delete existing (potentially inaccurate delta-based) snapshots for this game, then insert accurate ones
      await supabase
        .from('quarter_player_snapshots')
        .delete()
        .eq('event_id', game.event_id);

      // Insert in batches of 100
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error: insertError } = await supabase
          .from('quarter_player_snapshots')
          .insert(batch);

        if (insertError) {
          console.error(`[backfill-quarter-stats] Insert error for ${game.event_id}:`, insertError);
          errors.push(`Insert error: ${insertError.message}`);
        } else {
          totalInserted += batch.length;
        }
      }

      gamesProcessed++;
      console.log(`[backfill-quarter-stats] ✅ ${game.home_team} vs ${game.away_team}: ${rows.length} quarter-player rows inserted`);

      // Delay between games to avoid rate limiting
      if (gamesToProcess.indexOf(game) < gamesToProcess.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const summary = {
      gamesProcessed,
      totalInserted,
      gamesSkipped: alreadyBackfilled.size,
      errors: errors.length > 0 ? errors : undefined,
    };
    console.log('[backfill-quarter-stats] Summary:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[backfill-quarter-stats] Fatal error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

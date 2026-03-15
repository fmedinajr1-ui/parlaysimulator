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

// Map prop types to NBA stats column names
const PROP_CONFIGS = [
  { propType: 'points', column: 'PTS' },
  { propType: 'assists', column: 'AST' },
  { propType: 'threes', column: 'FG3M' },
  { propType: 'blocks', column: 'BLK' },
  { propType: 'rebounds', column: 'REB' },
  { propType: 'steals', column: 'STL' },
];

function getPlayerTier(avgMinutes: number): 'star' | 'starter' | 'role_player' {
  if (avgMinutes >= 32) return 'star';
  if (avgMinutes >= 24) return 'starter';
  return 'role_player';
}

function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(2)}`;
}

interface PlayerRow {
  name: string;
  stats: Record<string, number>; // column -> value
  minutes: number;
}

async function fetchNBAPlayerStats(period: number, season: string, lastNGames: number): Promise<PlayerRow[]> {
  const url = `https://stats.nba.com/stats/leaguedashplayerstats?Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=&Height=&ISTRound=&LastNGames=${lastNGames}&LeagueID=00&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=${period}&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=${season}&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[quarter-baselines] Fetching Period=${period} (attempt ${attempt})...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const resp = await fetch(url, { headers: NBA_STATS_HEADERS, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        console.error(`[quarter-baselines] NBA.com returned ${resp.status} for Period=${period}`);
        if (attempt < 3) { await new Promise(r => setTimeout(r, 1500 * attempt)); continue; }
        return [];
      }

      const json = await resp.json();
      const headers: string[] = json.resultSets?.[0]?.headers || [];
      const rows: any[][] = json.resultSets?.[0]?.rowSet || [];

      if (!headers.length || !rows.length) {
        console.warn(`[quarter-baselines] Empty result for Period=${period}`);
        return [];
      }

      const idx = (name: string) => headers.indexOf(name);
      const nameIdx = idx('PLAYER_NAME');
      const minIdx = idx('MIN');
      const gpIdx = idx('GP');

      const result: PlayerRow[] = [];
      for (const row of rows) {
        const name = row[nameIdx] as string;
        const gp = Number(row[gpIdx]) || 0;
        if (!name || gp < 3) continue;

        const stats: Record<string, number> = {};
        for (const cfg of PROP_CONFIGS) {
          stats[cfg.column] = Number(row[idx(cfg.column)]) || 0;
        }

        result.push({
          name,
          stats,
          minutes: Number(row[minIdx]) || 0,
        });
      }

      console.log(`[quarter-baselines] Period=${period}: ${result.length} players`);
      return result;
    } catch (err) {
      console.error(`[quarter-baselines] Fetch error Period=${period} attempt ${attempt}:`, err);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const season = getCurrentSeason();
    const lastNGames = 10; // L10 window
    console.log(`[quarter-baselines] Starting real NBA data fetch for ${season}, L${lastNGames}...`);

    // Fetch all 5 periods with delays between calls
    const periodData: Map<number, Map<string, PlayerRow>> = new Map();

    for (const period of [0, 1, 2, 3, 4]) {
      if (period > 0) await new Promise(r => setTimeout(r, 1200)); // rate limit
      const players = await fetchNBAPlayerStats(period, season, lastNGames);
      const map = new Map<string, PlayerRow>();
      for (const p of players) map.set(p.name, p);
      periodData.set(period, map);
    }

    const fullGamePlayers = periodData.get(0)!;
    console.log(`[quarter-baselines] Full game: ${fullGamePlayers.size} players`);

    const allBaselines: any[] = [];

    for (const [playerName, fullGame] of fullGamePlayers) {
      const q1 = periodData.get(1)?.get(playerName);
      const q2 = periodData.get(2)?.get(playerName);
      const q3 = periodData.get(3)?.get(playerName);
      const q4 = periodData.get(4)?.get(playerName);

      // Need at least Q1-Q4 data
      if (!q1 || !q2 || !q3 || !q4) continue;

      const tier = getPlayerTier(fullGame.minutes);
      const avgMinutesPerQuarter = fullGame.minutes / 4;

      for (const cfg of PROP_CONFIGS) {
        const gameAvg = fullGame.stats[cfg.column];
        if (gameAvg <= 0) continue;

        const q1Avg = q1.stats[cfg.column];
        const q2Avg = q2.stats[cfg.column];
        const q3Avg = q3.stats[cfg.column];
        const q4Avg = q4.stats[cfg.column];

        // Real percentages from actual quarter data
        const q1Pct = gameAvg > 0 ? q1Avg / gameAvg : 0.25;
        const q2Pct = gameAvg > 0 ? q2Avg / gameAvg : 0.25;
        const q3Pct = gameAvg > 0 ? q3Avg / gameAvg : 0.25;
        const q4Pct = gameAvg > 0 ? q4Avg / gameAvg : 0.25;

        // Per-minute rates
        const q1Min = q1.minutes > 0 ? q1.minutes : avgMinutesPerQuarter;
        const q2Min = q2.minutes > 0 ? q2.minutes : avgMinutesPerQuarter;
        const q3Min = q3.minutes > 0 ? q3.minutes : avgMinutesPerQuarter;
        const q4Min = q4.minutes > 0 ? q4.minutes : avgMinutesPerQuarter;

        allBaselines.push({
          player_name: playerName,
          prop_type: cfg.propType,
          q1_pct: Math.round(q1Pct * 10000) / 10000,
          q2_pct: Math.round(q2Pct * 10000) / 10000,
          q3_pct: Math.round(q3Pct * 10000) / 10000,
          q4_pct: Math.round(q4Pct * 10000) / 10000,
          q1_avg: Math.round(q1Avg * 100) / 100,
          q2_avg: Math.round(q2Avg * 100) / 100,
          q3_avg: Math.round(q3Avg * 100) / 100,
          q4_avg: Math.round(q4Avg * 100) / 100,
          h1_pct: Math.round((q1Pct + q2Pct) * 10000) / 10000,
          h2_pct: Math.round((q3Pct + q4Pct) * 10000) / 10000,
          q1_rate: Math.round((q1Avg / q1Min) * 10000) / 10000,
          q2_rate: Math.round((q2Avg / q2Min) * 10000) / 10000,
          q3_rate: Math.round((q3Avg / q3Min) * 10000) / 10000,
          q4_rate: Math.round((q4Avg / q4Min) * 10000) / 10000,
          game_avg: Math.round(gameAvg * 100) / 100,
          sample_size: lastNGames,
          minutes_avg: Math.round(fullGame.minutes * 100) / 100,
          player_tier: tier,
          updated_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[quarter-baselines] Generated ${allBaselines.length} baseline records from real data`);

    // Upsert in chunks
    let upsertedCount = 0;
    const chunkSize = 50;
    for (let i = 0; i < allBaselines.length; i += chunkSize) {
      const chunk = allBaselines.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('player_quarter_baselines')
        .upsert(chunk, { onConflict: 'player_name,prop_type', ignoreDuplicates: false });

      if (error) {
        console.error(`[quarter-baselines] Upsert error chunk ${i}:`, error);
      } else {
        upsertedCount += chunk.length;
      }
    }

    const result = {
      success: true,
      source: 'nba_stats_api',
      season,
      lastNGames,
      playersProcessed: fullGamePlayers.size,
      baselinesGenerated: allBaselines.length,
      baselinesUpserted: upsertedCount,
      propTypes: PROP_CONFIGS.map(c => c.propType),
      timestamp: new Date().toISOString(),
    };

    console.log('[quarter-baselines] Complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[quarter-baselines] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

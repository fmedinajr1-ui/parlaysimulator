import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Backfill DD/TD predictions for dates that had no analyzer run.
 * For each target date:
 *   1. Find all players who played that day from nba_player_game_logs
 *   2. Check if they got a DD (2+ cats at 10+) or TD (3+ cats at 10+)
 *   3. For players with season DD rate >= 15%, insert a prediction row with immediate settlement
 * 
 * This gives us historical ground truth for pattern analysis.
 */

interface GameLog {
  player_name: string;
  game_date: string;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  blocks: number | null;
  steals: number | null;
  is_home: boolean | null;
  opponent: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const startDate = body.start_date || '2026-03-01';
    const endDate = body.end_date || '2026-03-11';

    console.log(`[backfill-dd-td] Backfilling from ${startDate} to ${endDate}`);

    // 1. Get all game logs in the date range
    const allLogs: GameLog[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, blocks, steals, is_home, opponent')
        .gte('game_date', startDate)
        .lte('game_date', endDate)
        .order('game_date', { ascending: true })
        .range(offset, offset + 999);
      if (error) { console.error('[backfill-dd-td] fetch error:', error); break; }
      if (!data || data.length === 0) break;
      allLogs.push(...(data as GameLog[]));
      if (data.length < 1000) break;
      offset += 1000;
    }
    console.log(`[backfill-dd-td] Fetched ${allLogs.length} game logs`);

    // 2. Also fetch full season logs to compute season DD rates
    const seasonLogs: GameLog[] = [];
    let sOffset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, blocks, steals, is_home, opponent')
        .order('game_date', { ascending: false })
        .range(sOffset, sOffset + 999);
      if (error) break;
      if (!data || data.length === 0) break;
      seasonLogs.push(...(data as GameLog[]));
      if (data.length < 1000) break;
      sOffset += 1000;
    }
    console.log(`[backfill-dd-td] Total season logs: ${seasonLogs.length}`);

    // 3. Compute season DD rate per player
    const playerSeasonGames = new Map<string, GameLog[]>();
    for (const g of seasonLogs) {
      if (!playerSeasonGames.has(g.player_name)) playerSeasonGames.set(g.player_name, []);
      playerSeasonGames.get(g.player_name)!.push(g);
    }

    function countCats10(g: GameLog): number {
      let c = 0;
      if ((g.points || 0) >= 10) c++;
      if ((g.rebounds || 0) >= 10) c++;
      if ((g.assists || 0) >= 10) c++;
      if ((g.blocks || 0) >= 10) c++;
      if ((g.steals || 0) >= 10) c++;
      return c;
    }

    const playerDDRate = new Map<string, number>();
    const playerTDRate = new Map<string, number>();
    const playerGamesPlayed = new Map<string, number>();
    for (const [name, games] of playerSeasonGames) {
      if (games.length < 10) continue;
      let dd = 0, td = 0;
      for (const g of games) {
        const cats = countCats10(g);
        if (cats >= 2) dd++;
        if (cats >= 3) td++;
      }
      playerDDRate.set(name, dd / games.length);
      playerTDRate.set(name, td / games.length);
      playerGamesPlayed.set(name, games.length);
    }

    // 4. Check which dates already have predictions
    const { data: existing } = await supabase
      .from('dd_td_predictions')
      .select('prediction_date, player_name, prediction_type')
      .gte('prediction_date', startDate)
      .lte('prediction_date', endDate);

    const existingKeys = new Set((existing || []).map(e => `${e.prediction_date}_${e.player_name}_${e.prediction_type}`));
    console.log(`[backfill-dd-td] ${existingKeys.size} existing predictions in range`);

    // 5. Process each game log - generate prediction + immediate settlement
    const rows: any[] = [];
    let totalHits = 0, totalMisses = 0;

    // Group logs by date
    const logsByDate = new Map<string, GameLog[]>();
    for (const g of allLogs) {
      if (!logsByDate.has(g.game_date)) logsByDate.set(g.game_date, []);
      logsByDate.get(g.game_date)!.push(g);
    }

    for (const [date, logs] of logsByDate) {
      for (const g of logs) {
        const ddRate = playerDDRate.get(g.player_name) || 0;
        const tdRate = playerTDRate.get(g.player_name) || 0;
        const gamesPlayed = playerGamesPlayed.get(g.player_name) || 0;

        // Only create predictions for DD-capable players (15%+ season rate)
        if (ddRate < 0.15) continue;

        const cats = countCats10(g);
        const gotDD = cats >= 2;
        const gotTD = cats >= 3;

        // DD prediction
        const ddKey = `${date}_${g.player_name}_DD`;
        if (!existingKeys.has(ddKey)) {
          rows.push({
            prediction_date: date,
            player_name: g.player_name,
            prediction_type: 'DD',
            season_rate: Math.round(ddRate * 1000) / 1000,
            home_away_rate: Math.round(ddRate * 1000) / 1000,
            vs_opponent_rate: Math.round(ddRate * 1000) / 1000,
            l10_rate: Math.round(ddRate * 1000) / 1000,
            composite_score: Math.round(ddRate * 1000) / 1000,
            opponent: g.opponent || '',
            is_home: g.is_home ?? false,
            near_miss_rate: 0,
            games_played: gamesPlayed,
            outcome: gotDD ? 'hit' : 'miss',
          });
          if (gotDD) totalHits++; else totalMisses++;
        }

        // TD prediction if player has meaningful TD rate
        if (tdRate >= 0.05) {
          const tdKey = `${date}_${g.player_name}_TD`;
          if (!existingKeys.has(tdKey)) {
            rows.push({
              prediction_date: date,
              player_name: g.player_name,
              prediction_type: 'TD',
              season_rate: Math.round(tdRate * 1000) / 1000,
              home_away_rate: Math.round(tdRate * 1000) / 1000,
              vs_opponent_rate: Math.round(tdRate * 1000) / 1000,
              l10_rate: Math.round(tdRate * 1000) / 1000,
              composite_score: Math.round(tdRate * 1000) / 1000,
              opponent: g.opponent || '',
              is_home: g.is_home ?? false,
              near_miss_rate: 0,
              games_played: gamesPlayed,
              outcome: gotTD ? 'hit' : 'miss',
            });
            if (gotTD) totalHits++; else totalMisses++;
          }
        }
      }
    }

    console.log(`[backfill-dd-td] Generated ${rows.length} new predictions (${totalHits} hits, ${totalMisses} misses)`);

    // 6. Batch upsert
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error: upsertErr } = await supabase
        .from('dd_td_predictions')
        .upsert(batch, { onConflict: 'prediction_date,player_name,prediction_type', ignoreDuplicates: true });
      if (upsertErr) {
        console.error(`[backfill-dd-td] Upsert batch error:`, upsertErr);
      } else {
        inserted += batch.length;
      }
    }

    console.log(`[backfill-dd-td] Inserted ${inserted} predictions`);

    // 7. Summary by date
    const dateSummary: Record<string, { total: number; hits: number; misses: number }> = {};
    for (const r of rows) {
      if (!dateSummary[r.prediction_date]) dateSummary[r.prediction_date] = { total: 0, hits: 0, misses: 0 };
      dateSummary[r.prediction_date].total++;
      if (r.outcome === 'hit') dateSummary[r.prediction_date].hits++;
      else dateSummary[r.prediction_date].misses++;
    }

    return new Response(JSON.stringify({
      success: true,
      totalInserted: inserted,
      totalHits,
      totalMisses,
      hitRate: rows.length > 0 ? `${((totalHits / rows.length) * 100).toFixed(1)}%` : '0%',
      dateSummary,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[backfill-dd-td] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

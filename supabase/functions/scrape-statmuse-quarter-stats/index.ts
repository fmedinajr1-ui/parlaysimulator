import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STAT_COLUMNS = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM'] as const;
const STAT_TO_PROP: Record<string, string> = {
  PTS: 'points',
  REB: 'rebounds',
  AST: 'assists',
  STL: 'steals',
  BLK: 'blocks',
  '3PM': 'threes',
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Parse StatMuse markdown table into per-quarter, per-game rows */
function parseStatMuseTable(markdown: string): Array<{
  quarter: number;
  date: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  threes: number;
}> {
  const lines = markdown.split('\n');
  const rows: Array<any> = [];

  // Find the header row containing quarter stats columns
  let headerIdx = -1;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    // Look for header with QUARTER or QTR and stat columns
    const upperCells = cells.map(c => c.toUpperCase());
    
    if ((upperCells.includes('QUARTER') || upperCells.includes('QTR') || upperCells.includes('Q')) &&
        (upperCells.includes('PTS') || upperCells.includes('POINTS'))) {
      headerIdx = i;
      for (let j = 0; j < cells.length; j++) {
        const upper = cells[j].toUpperCase();
        if (upper === 'QUARTER' || upper === 'QTR' || upper === 'Q') colMap['QUARTER'] = j;
        if (upper === 'DATE' || upper === 'GAME') colMap['DATE'] = j;
        if (upper === 'PTS' || upper === 'POINTS') colMap['PTS'] = j;
        if (upper === 'REB' || upper === 'REBOUNDS') colMap['REB'] = j;
        if (upper === 'AST' || upper === 'ASSISTS') colMap['AST'] = j;
        if (upper === 'STL' || upper === 'STEALS') colMap['STL'] = j;
        if (upper === 'BLK' || upper === 'BLOCKS') colMap['BLK'] = j;
        if (upper === '3PM' || upper === '3PT' || upper === '3P' || upper === 'THREES') colMap['3PM'] = j;
      }
      break;
    }
  }

  if (headerIdx < 0 || colMap['QUARTER'] === undefined) {
    console.log('[statmuse] Could not find quarter stats table header');
    return [];
  }

  // Parse data rows after header (skip separator line)
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue; // separator

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;

    const qStr = cells[colMap['QUARTER']]?.replace(/[^0-9]/g, '');
    const quarter = parseInt(qStr);
    if (isNaN(quarter) || quarter < 1 || quarter > 4) continue;

    rows.push({
      quarter,
      date: cells[colMap['DATE']] || '',
      pts: parseFloat(cells[colMap['PTS']] || '0') || 0,
      reb: parseFloat(cells[colMap['REB']] || '0') || 0,
      ast: parseFloat(cells[colMap['AST']] || '0') || 0,
      stl: parseFloat(cells[colMap['STL']] || '0') || 0,
      blk: parseFloat(cells[colMap['BLK']] || '0') || 0,
      threes: parseFloat(cells[colMap['3PM']] || '0') || 0,
    });
  }

  return rows;
}

/** Calculate L10 per-quarter averages from parsed rows */
function calculateQuarterAverages(
  rows: ReturnType<typeof parseStatMuseTable>,
  maxGames: number = 10
): Record<string, { q1: number; q2: number; q3: number; q4: number; game_avg: number }> | null {
  if (rows.length === 0) return null;

  // Group by date to identify distinct games, take last N
  const gamesByDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.date || `row-${rows.indexOf(row)}`;
    const arr = gamesByDate.get(key) || [];
    arr.push(row);
    gamesByDate.set(key, arr);
  }

  // Take last maxGames dates
  const dates = [...gamesByDate.keys()].slice(0, maxGames);
  const filteredRows = rows.filter(r => dates.includes(r.date || `row-${rows.indexOf(r)}`));

  if (filteredRows.length < 4) return null; // Need at least 1 full game

  const stats = ['pts', 'reb', 'ast', 'stl', 'blk', 'threes'] as const;
  const propNames = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threes'];
  const result: Record<string, { q1: number; q2: number; q3: number; q4: number; game_avg: number }> = {};

  for (let s = 0; s < stats.length; s++) {
    const stat = stats[s];
    const propName = propNames[s];
    const qSums = [0, 0, 0, 0];
    const qCounts = [0, 0, 0, 0];

    for (const row of filteredRows) {
      const idx = row.quarter - 1;
      qSums[idx] += (row as any)[stat] || 0;
      qCounts[idx]++;
    }

    // Only include if we have data
    if (qCounts[0] === 0 && qCounts[1] === 0) continue;

    const q1 = qCounts[0] > 0 ? Math.round((qSums[0] / qCounts[0]) * 10) / 10 : 0;
    const q2 = qCounts[1] > 0 ? Math.round((qSums[1] / qCounts[1]) * 10) / 10 : 0;
    const q3 = qCounts[2] > 0 ? Math.round((qSums[2] / qCounts[2]) * 10) / 10 : 0;
    const q4 = qCounts[3] > 0 ? Math.round((qSums[3] / qCounts[3]) * 10) / 10 : 0;
    const game_avg = Math.round((q1 + q2 + q3 + q4) * 100) / 100;

    if (game_avg > 0) {
      result[propName] = { q1, q2, q3, q4, game_avg };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { playerNames } = await req.json() as { playerNames: string[] };
    if (!playerNames || playerNames.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ success: false, error: 'Firecrawl not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const log = (msg: string) => console.log(`[statmuse-quarter] ${msg}`);
    const results: Record<string, string> = {};
    let upsertCount = 0;

    for (const playerName of playerNames) {
      try {
        const slug = slugify(playerName);
        const url = `https://www.statmuse.com/nba/ask/${slug}-stats-by-quarter-this-season`;
        log(`Scraping: ${playerName} → ${url}`);

        const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            formats: ['markdown'],
            onlyMainContent: true,
            waitFor: 3000,
          }),
        });

        const scrapeData = await scrapeRes.json();
        const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || '';

        if (!markdown) {
          log(`⚠ No markdown returned for ${playerName}`);
          results[playerName] = 'no_data';
          continue;
        }

        // Parse the table
        const rows = parseStatMuseTable(markdown);
        log(`Parsed ${rows.length} quarter rows for ${playerName}`);

        if (rows.length === 0) {
          // Try alternative: sometimes StatMuse shows aggregate averages instead of game-by-game
          log(`⚠ No parseable quarter rows for ${playerName}, checking for summary stats`);
          results[playerName] = 'no_quarter_rows';
          continue;
        }

        const averages = calculateQuarterAverages(rows, 10);
        if (!averages) {
          results[playerName] = 'insufficient_data';
          continue;
        }

        // Upsert into player_quarter_baselines
        const upsertRows = Object.entries(averages).map(([propType, avgs]) => ({
          player_name: playerName,
          prop_type: propType,
          q1_avg: avgs.q1,
          q2_avg: avgs.q2,
          q3_avg: avgs.q3,
          q4_avg: avgs.q4,
          q1_pct: avgs.game_avg > 0 ? Math.round((avgs.q1 / avgs.game_avg) * 10000) / 10000 : 0.25,
          q2_pct: avgs.game_avg > 0 ? Math.round((avgs.q2 / avgs.game_avg) * 10000) / 10000 : 0.25,
          q3_pct: avgs.game_avg > 0 ? Math.round((avgs.q3 / avgs.game_avg) * 10000) / 10000 : 0.25,
          q4_pct: avgs.game_avg > 0 ? Math.round((avgs.q4 / avgs.game_avg) * 10000) / 10000 : 0.25,
          game_avg: avgs.game_avg,
          data_source: 'statmuse',
          updated_at: new Date().toISOString(),
        }));

        const { error } = await supabase
          .from('player_quarter_baselines')
          .upsert(upsertRows, { onConflict: 'player_name,prop_type', ignoreDuplicates: false });

        if (error) {
          log(`❌ Upsert error for ${playerName}: ${JSON.stringify(error)}`);
          results[playerName] = `upsert_error: ${error.message}`;
        } else {
          upsertCount += upsertRows.length;
          results[playerName] = `ok (${upsertRows.length} props)`;
          log(`✅ ${playerName}: ${upsertRows.length} prop baselines saved`);
        }

        // Rate limit: 1 request per second
        await new Promise(r => setTimeout(r, 1200));
      } catch (e) {
        log(`❌ Exception for ${playerName}: ${e.message}`);
        results[playerName] = `exception: ${e.message}`;
      }
    }

    log(`Done. Upserted ${upsertCount} baselines for ${playerNames.length} players.`);

    return new Response(JSON.stringify({
      success: true,
      processed: playerNames.length,
      upserted: upsertCount,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[statmuse-quarter] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Strip markdown links/images from a cell, return plain text */
function cleanCell(cell: string): string {
  // Remove markdown images: ![alt](url)
  let c = cell.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Remove markdown links but keep text: [text](url) → text
  c = c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Remove extra whitespace
  return c.replace(/\s+/g, ' ').trim();
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

  // Find header row with QUARTER column
  let headerIdx = -1;
  let colIndices: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const rawCells = line.split('|').slice(1); // skip first empty from leading |
    // Remove trailing empty from trailing |
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();

    const cells = rawCells.map(c => cleanCell(c).toUpperCase());

    if (cells.includes('QUARTER') || cells.includes('QTR')) {
      headerIdx = i;
      for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
        if (c === 'QUARTER' || c === 'QTR') colIndices['QUARTER'] = j;
        if (c === 'DATE') colIndices['DATE'] = j;
        if (c === 'PTS') colIndices['PTS'] = j;
        if (c === 'REB') colIndices['REB'] = j;
        if (c === 'AST') colIndices['AST'] = j;
        if (c === 'STL') colIndices['STL'] = j;
        if (c === 'BLK') colIndices['BLK'] = j;
        if (c === '3PM' || c === '3PT' || c === '3P') colIndices['3PM'] = j;
      }
      break;
    }
  }

  if (headerIdx < 0 || colIndices['QUARTER'] === undefined || colIndices['PTS'] === undefined) {
    console.log('[statmuse] Could not find table header. Looking for fallback...');
    return [];
  }

  console.log(`[statmuse] Found header at line ${headerIdx}, columns:`, JSON.stringify(colIndices));

  // Parse data rows
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue; // separator

    const rawCells = line.split('|').slice(1);
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();

    if (rawCells.length < Math.max(...Object.values(colIndices)) + 1) continue;

    const quarterStr = cleanCell(rawCells[colIndices['QUARTER']] || '');
    // Quarter format: "1Q", "2Q", "3Q", "4Q"
    const qMatch = quarterStr.match(/(\d)Q/i) || quarterStr.match(/^(\d)$/);
    if (!qMatch) continue;
    const quarter = parseInt(qMatch[1]);
    if (quarter < 1 || quarter > 4) continue;

    const dateStr = colIndices['DATE'] !== undefined ? cleanCell(rawCells[colIndices['DATE']] || '') : '';
    
    const getNum = (key: string) => {
      if (colIndices[key] === undefined) return 0;
      const val = cleanCell(rawCells[colIndices[key]] || '');
      return parseFloat(val) || 0;
    };

    rows.push({
      quarter,
      date: dateStr,
      pts: getNum('PTS'),
      reb: getNum('REB'),
      ast: getNum('AST'),
      stl: getNum('STL'),
      blk: getNum('BLK'),
      threes: getNum('3PM'),
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

  // Group by date to identify distinct games
  const gamesByDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.date || `idx-${rows.indexOf(row)}`;
    const arr = gamesByDate.get(key) || [];
    arr.push(row);
    gamesByDate.set(key, arr);
  }

  // Take last maxGames dates (StatMuse returns recent first)
  const dates = [...gamesByDate.keys()].slice(0, maxGames);
  const filteredRows = rows.filter(r => {
    const key = r.date || `idx-${rows.indexOf(r)}`;
    return dates.includes(key);
  });

  if (filteredRows.length < 4) return null;

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
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
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
          body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor: 3000 }),
        });

        const scrapeData = await scrapeRes.json();
        const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || '';

        if (!markdown) {
          log(`⚠ No markdown for ${playerName}`);
          results[playerName] = 'no_data';
          continue;
        }

        const rows = parseStatMuseTable(markdown);
        log(`Parsed ${rows.length} quarter rows for ${playerName}`);

        if (rows.length === 0) {
          results[playerName] = 'no_quarter_rows';
          continue;
        }

        const averages = calculateQuarterAverages(rows, 10);
        if (!averages) {
          results[playerName] = 'insufficient_data';
          continue;
        }

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

        // Rate limit
        await new Promise(r => setTimeout(r, 1200));
      } catch (e) {
        log(`❌ Exception for ${playerName}: ${e.message}`);
        results[playerName] = `exception: ${e.message}`;
      }
    }

    log(`Done. Upserted ${upsertCount} baselines for ${playerNames.length} players.`);
    return new Response(JSON.stringify({ success: true, processed: playerNames.length, upserted: upsertCount, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[statmuse-quarter] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

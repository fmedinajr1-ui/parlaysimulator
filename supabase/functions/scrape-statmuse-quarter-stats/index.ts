import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cleanCell(cell: string): string {
  let c = cell.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  c = c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return c.replace(/\s+/g, ' ').trim();
}

/** Parse StatMuse game-by-quarter table, return stat averages from all rows */
function parseQuarterAvgs(markdown: string): { pts: number; reb: number; ast: number; stl: number; blk: number; threes: number } | null {
  const lines = markdown.split('\n');
  let colIndices: Record<string, number> = {};
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const rawCells = line.split('|').slice(1);
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    const cells = rawCells.map(c => cleanCell(c).toUpperCase());

    // Look for PTS column as anchor
    if (cells.includes('PTS') || cells.includes('POINTS')) {
      headerIdx = i;
      for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
        if (c === 'PTS' || c === 'POINTS') colIndices['PTS'] = j;
        if (c === 'REB' || c === 'REBOUNDS') colIndices['REB'] = j;
        if (c === 'AST' || c === 'ASSISTS') colIndices['AST'] = j;
        if (c === 'STL' || c === 'STEALS') colIndices['STL'] = j;
        if (c === 'BLK' || c === 'BLOCKS') colIndices['BLK'] = j;
        if (c === '3PM' || c === '3PT' || c === '3P') colIndices['3PM'] = j;
      }
      break;
    }
  }

  if (headerIdx < 0 || colIndices['PTS'] === undefined) return null;

  let totalPts = 0, totalReb = 0, totalAst = 0, totalStl = 0, totalBlk = 0, totalThrees = 0;
  let count = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;

    const rawCells = line.split('|').slice(1);
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    if (rawCells.length < (colIndices['PTS'] + 1)) continue;

    const getNum = (key: string) => {
      if (colIndices[key] === undefined) return 0;
      return parseFloat(cleanCell(rawCells[colIndices[key]] || '')) || 0;
    };

    const pts = getNum('PTS');
    // Skip rows that look like headers or don't have numeric PTS
    if (isNaN(parseFloat(cleanCell(rawCells[colIndices['PTS']] || '')))) continue;

    totalPts += pts;
    totalReb += getNum('REB');
    totalAst += getNum('AST');
    totalStl += getNum('STL');
    totalBlk += getNum('BLK');
    totalThrees += getNum('3PM');
    count++;
  }

  if (count < 3) return null;

  // Take last 10 games only (StatMuse shows most recent first)
  // Actually we already parsed all — the averages above are from ALL rows
  // But we want L10, so cap at 10
  // Since we're iterating and can't easily slice, let's re-parse with a limit
  return null; // Will use the limited version below
}

/** Parse up to maxGames rows and return averages */
function parseQuarterAvgsLimited(markdown: string, maxGames: number = 10): { pts: number; reb: number; ast: number; stl: number; blk: number; threes: number; games: number } | null {
  const lines = markdown.split('\n');
  let colIndices: Record<string, number> = {};
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const rawCells = line.split('|').slice(1);
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    const cells = rawCells.map(c => cleanCell(c).toUpperCase());

    if (cells.includes('PTS') || cells.includes('POINTS')) {
      headerIdx = i;
      for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
        if (c === 'PTS' || c === 'POINTS') colIndices['PTS'] = j;
        if (c === 'PPG') colIndices['PTS'] = j; // Some formats use PPG
        if (c === 'REB' || c === 'REBOUNDS' || c === 'RPG') colIndices['REB'] = j;
        if (c === 'AST' || c === 'ASSISTS' || c === 'APG') colIndices['AST'] = j;
        if (c === 'STL' || c === 'STEALS' || c === 'SPG') colIndices['STL'] = j;
        if (c === 'BLK' || c === 'BLOCKS' || c === 'BPG') colIndices['BLK'] = j;
        if (c === '3PM' || c === '3PT' || c === '3P' || c === '3PPG') colIndices['3PM'] = j;
      }
      break;
    }
  }

  if (headerIdx < 0 || colIndices['PTS'] === undefined) return null;

  let totalPts = 0, totalReb = 0, totalAst = 0, totalStl = 0, totalBlk = 0, totalThrees = 0;
  let count = 0;

  for (let i = headerIdx + 1; i < lines.length && count < maxGames; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;

    const rawCells = line.split('|').slice(1);
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    if (rawCells.length < (colIndices['PTS'] + 1)) continue;

    const ptsStr = cleanCell(rawCells[colIndices['PTS']] || '');
    if (!/^\d/.test(ptsStr)) continue; // Skip non-numeric rows

    const getNum = (key: string) => {
      if (colIndices[key] === undefined) return 0;
      return parseFloat(cleanCell(rawCells[colIndices[key]] || '')) || 0;
    };

    totalPts += getNum('PTS');
    totalReb += getNum('REB');
    totalAst += getNum('AST');
    totalStl += getNum('STL');
    totalBlk += getNum('BLK');
    totalThrees += getNum('3PM');
    count++;
  }

  if (count < 3) return null;

  return {
    pts: Math.round((totalPts / count) * 10) / 10,
    reb: Math.round((totalReb / count) * 10) / 10,
    ast: Math.round((totalAst / count) * 10) / 10,
    stl: Math.round((totalStl / count) * 10) / 10,
    blk: Math.round((totalBlk / count) * 10) / 10,
    threes: Math.round((totalThrees / count) * 10) / 10,
    games: count,
  };
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

    const quarters = ['first', 'second', 'third', 'fourth'];
    const quarterNums = [1, 2, 3, 4];

    for (const playerName of playerNames) {
      try {
        const slug = slugify(playerName);
        const quarterAvgs: Record<number, { pts: number; reb: number; ast: number; stl: number; blk: number; threes: number }> = {};

        // Scrape each quarter separately
        for (let qi = 0; qi < 4; qi++) {
          const qWord = quarters[qi];
          const url = `https://www.statmuse.com/nba/ask/${slug}-stats-in-the-${qWord}-quarter-this-season`;
          log(`Scraping: ${playerName} Q${qi + 1} → ${url}`);

          const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor: 2000 }),
          });

          const scrapeData = await scrapeRes.json();
          const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || '';

          if (!markdown) {
            log(`⚠ No markdown for ${playerName} Q${qi + 1}`);
            continue;
          }

          const avgs = parseQuarterAvgsLimited(markdown, 10);
          if (avgs) {
            quarterAvgs[qi + 1] = avgs;
            log(`✅ ${playerName} Q${qi + 1}: ${avgs.pts} pts, ${avgs.reb} reb, ${avgs.ast} ast (${avgs.games} games)`);
          } else {
            log(`⚠ Could not parse Q${qi + 1} for ${playerName}`);
          }

          // Rate limit between quarter scrapes
          await new Promise(r => setTimeout(r, 1000));
        }

        // Build baselines from quarter data
        if (Object.keys(quarterAvgs).length < 2) {
          results[playerName] = `insufficient_quarters (${Object.keys(quarterAvgs).length}/4)`;
          continue;
        }

        const statProps = [
          { stat: 'pts', prop: 'points' },
          { stat: 'reb', prop: 'rebounds' },
          { stat: 'ast', prop: 'assists' },
          { stat: 'stl', prop: 'steals' },
          { stat: 'blk', prop: 'blocks' },
          { stat: 'threes', prop: 'threes' },
        ];

        const upsertRows = statProps.map(({ stat, prop }) => {
          const q1 = quarterAvgs[1]?.[stat as keyof typeof quarterAvgs[1]] ?? 0;
          const q2 = quarterAvgs[2]?.[stat as keyof typeof quarterAvgs[2]] ?? 0;
          const q3 = quarterAvgs[3]?.[stat as keyof typeof quarterAvgs[3]] ?? 0;
          const q4 = quarterAvgs[4]?.[stat as keyof typeof quarterAvgs[4]] ?? 0;
          const game_avg = Math.round((q1 + q2 + q3 + q4) * 100) / 100;

          return {
            player_name: playerName,
            prop_type: prop,
            q1_avg: q1,
            q2_avg: q2,
            q3_avg: q3,
            q4_avg: q4,
            q1_pct: game_avg > 0 ? Math.round((q1 / game_avg) * 10000) / 10000 : 0.25,
            q2_pct: game_avg > 0 ? Math.round((q2 / game_avg) * 10000) / 10000 : 0.25,
            q3_pct: game_avg > 0 ? Math.round((q3 / game_avg) * 10000) / 10000 : 0.25,
            q4_pct: game_avg > 0 ? Math.round((q4 / game_avg) * 10000) / 10000 : 0.25,
            game_avg,
            data_source: 'statmuse',
            updated_at: new Date().toISOString(),
          };
        }).filter(r => r.game_avg > 0);

        const { error } = await supabase
          .from('player_quarter_baselines')
          .upsert(upsertRows, { onConflict: 'player_name,prop_type', ignoreDuplicates: false });

        if (error) {
          log(`❌ Upsert error for ${playerName}: ${JSON.stringify(error)}`);
          results[playerName] = `upsert_error: ${error.message}`;
        } else {
          upsertCount += upsertRows.length;
          const qCount = Object.keys(quarterAvgs).length;
          results[playerName] = `ok (${upsertRows.length} props, ${qCount}/4 quarters)`;
          log(`✅ ${playerName}: ${upsertRows.length} baselines saved (${qCount}/4 Q)`);
        }

        // Delay between players
        await new Promise(r => setTimeout(r, 500));
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

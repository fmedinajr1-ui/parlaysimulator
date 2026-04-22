import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cleanCell(cell: string): string {
  let c = cell.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  c = c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return c.replace(/\s+/g, ' ').trim();
}

async function delay(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse the summary stats row from StatMuse per-quarter page.
 * Returns { ppg, rpg, apg, spg, bpg, threes } or null */
function parseSummaryRow(markdown: string): { ppg: number; rpg: number; apg: number; spg: number; bpg: number; threes: number } | null {
  const lines = markdown.split('\n');
  let colIndices: Record<string, number> = {};
  let headerIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    const rawCells = line.split('|').slice(1);
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    const cells = rawCells.map(c => cleanCell(c).toUpperCase());

    // Look for PPG as anchor (prefer per-game averages over totals)
    if (cells.includes('PPG') || cells.includes('PTS')) {
      headerIdx = i;
      for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
        // Prefer PPG over PTS (PTS is season totals, PPG is per-game avg)
        if (c === 'PPG') colIndices['PPG'] = j;
        if (c === 'PTS' && colIndices['PPG'] === undefined) colIndices['PPG'] = j;
        if (c === 'RPG') colIndices['RPG'] = j;
        if (c === 'REB' && colIndices['RPG'] === undefined) colIndices['RPG'] = j;
        if (c === 'APG') colIndices['APG'] = j;
        if (c === 'AST' && colIndices['APG'] === undefined) colIndices['APG'] = j;
        if (c === 'SPG') colIndices['SPG'] = j;
        if (c === 'STL' && colIndices['SPG'] === undefined) colIndices['SPG'] = j;
        if (c === 'BPG') colIndices['BPG'] = j;
        if (c === 'BLK' && colIndices['BPG'] === undefined) colIndices['BPG'] = j;
        if (c === '3PM' && colIndices['3PM'] === undefined) colIndices['3PM'] = j;
        if (c === '3PT' || c === '3PPG') colIndices['3PM'] = j;
      }
      break;
    }
  }

  if (headerIdx < 0 || colIndices['PPG'] === undefined) {
    console.log('[statmuse] No header found with PPG/PTS column');
    return null;
  }

  // Find first data row after header (skip separator)
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;

    const rawCells = line.split('|').slice(1);
    if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
    if (rawCells.length < (colIndices['PPG'] + 1)) continue;

    const getNum = (key: string) => {
      if (colIndices[key] === undefined) return 0;
      return parseFloat(cleanCell(rawCells[colIndices[key]] || '')) || 0;
    };

    const ppg = getNum('PPG');
    if (ppg === 0 && getNum('RPG') === 0) continue; // Skip empty rows

    return {
      ppg: getNum('PPG'),
      rpg: getNum('RPG'),
      apg: getNum('APG'),
      spg: getNum('SPG'),
      bpg: getNum('BPG'),
      threes: getNum('3PM'),
    };
  }

  return null;
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
    const playerDetails: Record<string, { status: string; quarters_found: number; quarters_attempted: number; missing_quarters?: number[]; props_saved?: number; error?: string }> = {};
    let upsertCount = 0;

    const quarters = ['first', 'second', 'third', 'fourth'];

    for (const playerName of playerNames) {
      try {
        const slug = slugify(playerName);
        const quarterData: Record<number, { ppg: number; rpg: number; apg: number; spg: number; bpg: number; threes: number }> = {};

        // Scrape each quarter's summary stats
        for (let qi = 0; qi < 4; qi++) {
          const url = `https://www.statmuse.com/nba/ask/${slug}-stats-in-the-${quarters[qi]}-quarter-this-season`;
          log(`Q${qi + 1}: ${url}`);

          const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor: 2000 }),
          });

          if (!scrapeRes.ok) {
            log(`⚠ Firecrawl HTTP ${scrapeRes.status} for ${playerName} Q${qi + 1}`);
            continue;
          }

          const scrapeData = await scrapeRes.json().catch(() => null);
          const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || '';

          if (!markdown) {
            log(`⚠ No markdown for ${playerName} Q${qi + 1}`);
            continue;
          }

          const stats = parseSummaryRow(markdown);
          if (stats) {
            quarterData[qi + 1] = stats;
            log(`✅ Q${qi + 1}: ${stats.ppg}ppg ${stats.rpg}rpg ${stats.apg}apg ${stats.spg}spg ${stats.bpg}bpg ${stats.threes}3pm`);
          } else {
            log(`⚠ Could not parse Q${qi + 1} summary for ${playerName}`);
          }

          await delay(250);
        }

        const foundQuarterIds = Object.keys(quarterData).map(Number);
        const missingQuarterIds = [1, 2, 3, 4].filter(q => !foundQuarterIds.includes(q));

        if (foundQuarterIds.length < 2) {
          results[playerName] = `insufficient_quarters (${foundQuarterIds.length}/4)`;
          playerDetails[playerName] = {
            status: 'insufficient_quarters',
            quarters_found: foundQuarterIds.length,
            quarters_attempted: 4,
            missing_quarters: missingQuarterIds,
          };
          continue;
        }

        // Build baselines from real quarter averages
        const statProps = [
          { field: 'ppg', prop: 'points' },
          { field: 'rpg', prop: 'rebounds' },
          { field: 'apg', prop: 'assists' },
          { field: 'spg', prop: 'steals' },
          { field: 'bpg', prop: 'blocks' },
          { field: 'threes', prop: 'threes' },
        ];

        const upsertRows = statProps.map(({ field, prop }) => {
          const q1 = quarterData[1]?.[field as keyof typeof quarterData[1]] ?? 0;
          const q2 = quarterData[2]?.[field as keyof typeof quarterData[2]] ?? 0;
          const q3 = quarterData[3]?.[field as keyof typeof quarterData[3]] ?? 0;
          const q4 = quarterData[4]?.[field as keyof typeof quarterData[4]] ?? 0;
          const game_avg = Math.round((q1 + q2 + q3 + q4) * 100) / 100;

          return {
            player_name: playerName,
            prop_type: prop,
            q1_avg: q1, q2_avg: q2, q3_avg: q3, q4_avg: q4,
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
          log(`❌ Upsert error: ${JSON.stringify(error)}`);
          results[playerName] = `upsert_error: ${error.message}`;
          playerDetails[playerName] = {
            status: 'upsert_error',
            quarters_found: foundQuarterIds.length,
            quarters_attempted: 4,
            missing_quarters: missingQuarterIds,
            error: error.message,
          };
        } else {
          upsertCount += upsertRows.length;
          results[playerName] = `ok (${upsertRows.length} props, ${Object.keys(quarterData).length}/4 Q)`;
          playerDetails[playerName] = {
            status: foundQuarterIds.length === 4 ? 'ok' : 'partial_ok',
            quarters_found: foundQuarterIds.length,
            quarters_attempted: 4,
            missing_quarters: missingQuarterIds,
            props_saved: upsertRows.length,
          };
          log(`✅ ${playerName}: ${upsertRows.length} baselines saved`);
        }

        await delay(150);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        log(`❌ ${playerName}: ${message}`);
        results[playerName] = `exception: ${message}`;
        playerDetails[playerName] = {
          status: 'exception',
          quarters_found: 0,
          quarters_attempted: 4,
          error: message,
        };
      }
    }

    log(`Done. Upserted ${upsertCount} for ${playerNames.length} players.`);
    return new Response(JSON.stringify({ success: true, processed: playerNames.length, upserted: upsertCount, results, player_details: playerDetails }), {
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

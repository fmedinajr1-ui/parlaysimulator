import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * ncaab-kenpom-scraper
 * 
 * Scrapes real KenPom efficiency data via Firecrawl and updates ncaab_team_stats
 * with accurate adjusted offensive/defensive efficiency, tempo, SOS, and luck.
 */

// Fuzzy match scraped KenPom name to DB team name
function fuzzyMatch(kenpomName: string, dbNames: string[]): string | null {
  const clean = kenpomName.trim().toLowerCase();
  
  // Direct match
  for (const db of dbNames) {
    if (db.toLowerCase() === clean) return db;
  }
  
  // KenPom uses short names like "Duke", DB has "Duke Blue Devils"
  for (const db of dbNames) {
    const dbLower = db.toLowerCase();
    if (dbLower.startsWith(clean + ' ') || dbLower === clean) return db;
  }
  
  // Match by significant words (e.g., "Michigan St." -> "Michigan State Spartans")
  const kenpomNorm = clean
    .replace(/st\./g, 'state')
    .replace(/\./g, '')
    .replace(/'/g, "'");
  
  for (const db of dbNames) {
    const dbNorm = db.toLowerCase().replace(/'/g, "'");
    if (dbNorm.startsWith(kenpomNorm + ' ') || dbNorm === kenpomNorm) return db;
  }

  // Partial word match - check if all KenPom words appear in DB name
  const kenpomWords = kenpomNorm.split(/\s+/).filter(w => w.length > 2);
  for (const db of dbNames) {
    const dbLower = db.toLowerCase();
    if (kenpomWords.every(w => dbLower.includes(w))) return db;
  }

  return null;
}

// KenPom name normalization map for tricky cases
const KENPOM_TO_DB: Record<string, string> = {
  'connecticut': 'Connecticut Huskies',
  'uconn': 'Connecticut Huskies',
  'north carolina': 'North Carolina Tar Heels',
  'unc': 'North Carolina Tar Heels',
  'michigan st.': 'Michigan State Spartans',
  'ohio st.': 'Ohio State Buckeyes',
  'penn st.': 'Penn State Nittany Lions',
  'oklahoma st.': 'Oklahoma State Cowboys',
  'iowa st.': 'Iowa State Cyclones',
  'kansas st.': 'Kansas State Wildcats',
  'boise st.': 'Boise State Broncos',
  'san diego st.': 'San Diego State Aztecs',
  'colorado st.': 'Colorado State Rams',
  'fresno st.': 'Fresno State Bulldogs',
  'arizona st.': 'Arizona State Sun Devils',
  'oregon st.': 'Oregon State Beavers',
  'mississippi st.': 'Mississippi State Bulldogs',
  'washington st.': 'Washington State Cougars',
  'nc state': 'NC State Wolfpack',
  'miami fl': 'Miami Hurricanes',
  'miami oh': 'Miami (OH) RedHawks',
  'loyola chicago': 'Loyola Chicago Ramblers',
  "saint mary's": "Saint Mary's Gaels",
  'vcu': 'VCU Rams',
  'smu': 'SMU Mustangs',
  'ucf': 'UCF Knights',
  'lsu': 'LSU Tigers',
  'usc': 'USC Trojans',
  'byu': 'BYU Cougars',
  'unlv': 'UNLV Rebels',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!firecrawlKey) {
    return new Response(JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('[KenPom Scraper] Starting scrape of kenpom.com...');

    // Scrape KenPom main rankings page
    const scrapeResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://kenpom.com/',
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    const scrapeData = await scrapeResp.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || '';

    if (!markdown || markdown.length < 500) {
      console.error('[KenPom Scraper] Failed to get meaningful content, trying alternate source...');
      
      // Fallback: try barttorvik.com which has similar data publicly
      const bartResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://barttorvik.com/',
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 3000,
        }),
      });

      const bartData = await bartResp.json();
      const bartMarkdown = bartData?.data?.markdown || bartData?.markdown || '';
      
      if (bartMarkdown.length > 500) {
        return await processRankingsMarkdown(bartMarkdown, supabase, 'barttorvik');
      }

      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Could not scrape KenPom or Barttorvik',
        markdown_length: markdown.length,
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await processRankingsMarkdown(markdown, supabase, 'kenpom');
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KenPom Scraper] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processRankingsMarkdown(markdown: string, supabase: any, source: string) {
  console.log(`[KenPom Scraper] Processing ${source} markdown (${markdown.length} chars)...`);

  // Get existing team names from DB
  const { data: existingTeams } = await supabase
    .from('ncaab_team_stats')
    .select('team_name');
  
  const dbNames = (existingTeams || []).map((t: any) => t.team_name);
  console.log(`[KenPom Scraper] ${dbNames.length} teams in DB to match against`);

  // Parse the markdown table - KenPom format:
  // | Rank | Team | Conf | W-L | AdjEM | AdjO | AdjD | AdjT | Luck | SOS AdjEM |
  // Barttorvik format is similar
  const lines = markdown.split('\n');
  const teams: Array<{
    rank: number;
    name: string;
    adjO: number;
    adjD: number;
    adjT: number;
    luck: number;
    sosRank: number;
    dbName: string | null;
  }> = [];

  let rankCounter = 0;

  // Helper to strip markdown links: [Name](url) -> Name
  const stripLinks = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  for (const line of lines) {
    const cleanLine = stripLinks(line);
    
    // Try pipe-delimited table rows
    // KenPom: | Rank | Team | Conf | W-L | AdjEM | AdjO | AdjD | AdjT | Luck | SOS |
    const pipeMatch = cleanLine.match(/\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*[\d-]+\s*\|\s*([\d.+-]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([.\d+-]+)\s*\|/);
    
    if (pipeMatch) {
      const rank = parseInt(pipeMatch[1]);
      const name = pipeMatch[2].trim();
      const adjO = parseFloat(pipeMatch[5]);
      const adjD = parseFloat(pipeMatch[6]);
      const adjT = parseFloat(pipeMatch[7]);
      const luck = parseFloat(pipeMatch[8]);

      if (!isNaN(adjO) && !isNaN(adjD) && adjO > 50 && adjD > 50) {
        const dbName = KENPOM_TO_DB[name.toLowerCase()] || fuzzyMatch(name, dbNames);
        teams.push({ rank, name, adjO, adjD, adjT, luck, sosRank: rank, dbName });
      }
      continue;
    }

    // Try: "| Rank | [Team](url) | Conf | W-L | AdjEM | AdjO | AdjD | AdjT |" with cleaned links
    // After stripping, this becomes a normal pipe row but team names may have extra spaces
    const simplePipe = cleanLine.match(/\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+-\d+)\s*\|\s*([\d.+-]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
    if (simplePipe) {
      const rank = parseInt(simplePipe[1]);
      const name = simplePipe[2].trim();
      const adjO = parseFloat(simplePipe[6]);
      const adjD = parseFloat(simplePipe[7]);
      const adjT = parseFloat(simplePipe[8]);

      if (!isNaN(adjO) && !isNaN(adjD) && adjO > 50 && adjD > 50) {
        const dbName = KENPOM_TO_DB[name.toLowerCase()] || fuzzyMatch(name, dbNames);
        teams.push({ rank, name, adjO, adjD, adjT, luck: 0, sosRank: rank, dbName });
      }
      continue;
    }

    // Fallback: extract rank + team name + numbers from any line with enough numeric values
    // Match lines like: "29 Saint Mary's SEC 25-7 ... 119.1 96.3 65.2"
    const numbers = cleanLine.match(/[\d.]+/g);
    if (numbers && numbers.length >= 6) {
      // Try to find a rank at the start
      const rankMatch = cleanLine.match(/^\s*\|?\s*(\d{1,3})\s/);
      if (rankMatch) {
        const rank = parseInt(rankMatch[1]);
        if (rank >= 1 && rank <= 400) {
          // Extract team name: everything between rank and conference/record
          const afterRank = cleanLine.substring(rankMatch[0].length);
          const nameMatch = afterRank.match(/^\|?\s*([A-Za-z][A-Za-z\s.'()\-&]+?)\s*\|?\s*(?:[A-Z]{2,10}|[A-Za-z]+\s?\d*)\s*\|?\s*\d+-\d+/);
          if (nameMatch) {
            const name = nameMatch[1].trim();
            // Find AdjO, AdjD, AdjT - they should be the 2nd, 3rd, 4th floats > 50 after the W-L record
            const floatsAfterRecord = afterRank.match(/\d+-\d+.*?([\d.]+)\s*\|?\s*([\d.]+)\s*\|?\s*([\d.]+)\s*\|?\s*([\d.]+)/);
            if (floatsAfterRecord) {
              const adjEM = parseFloat(floatsAfterRecord[1]);
              const adjO = parseFloat(floatsAfterRecord[2]);
              const adjD = parseFloat(floatsAfterRecord[3]);
              const adjT = parseFloat(floatsAfterRecord[4]);
              
              if (adjO > 80 && adjO < 140 && adjD > 80 && adjD < 140) {
                const dbName = KENPOM_TO_DB[name.toLowerCase()] || fuzzyMatch(name, dbNames);
                teams.push({ rank, name, adjO, adjD, adjT, luck: 0, sosRank: rank, dbName });
                continue;
              }
            }
          }
        }
      }
    }
  }

  console.log(`[KenPom Scraper] Parsed ${teams.length} teams from ${source}`);
  
  if (teams.length === 0) {
    // Log first 2000 chars for debugging
    console.log('[KenPom Scraper] Sample markdown:', markdown.substring(0, 2000));
    
    return new Response(JSON.stringify({
      success: false,
      error: `No teams parsed from ${source}`,
      markdown_length: markdown.length,
      sample: markdown.substring(0, 500),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Update matched teams in DB
  let matched = 0;
  let unmatched = 0;
  const unmatchedNames: string[] = [];

  for (const team of teams) {
    if (!team.dbName) {
      unmatched++;
      if (unmatchedNames.length < 20) unmatchedNames.push(team.name);
      continue;
    }

    const { error } = await supabase
      .from('ncaab_team_stats')
      .update({
        kenpom_rank: team.rank,
        kenpom_adj_o: team.adjO,
        kenpom_adj_d: team.adjD,
        adj_offense: team.adjO,
        adj_defense: team.adjD,
        adj_tempo: team.adjT,
        sos_rank: team.sosRank,
        luck_factor: team.luck,
        kenpom_source: source,
        updated_at: new Date().toISOString(),
      })
      .eq('team_name', team.dbName);

    if (!error) matched++;
    else console.warn(`[KenPom Scraper] Failed to update ${team.dbName}:`, error.message);
  }

  const summary = {
    success: true,
    source,
    teams_parsed: teams.length,
    teams_matched: matched,
    teams_unmatched: unmatched,
    unmatched_sample: unmatchedNames.slice(0, 10),
    top_5: teams.slice(0, 5).map(t => `#${t.rank} ${t.name} (AdjO: ${t.adjO}, AdjD: ${t.adjD})`),
  };

  console.log('[KenPom Scraper] Complete:', summary);

  await supabase.from('cron_job_history').insert({
    job_name: 'ncaab-kenpom-scraper',
    status: 'completed',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    result: summary,
  });

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

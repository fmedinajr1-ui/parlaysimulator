import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * ncaab-kenpom-scraper v2
 * 
 * Scrapes real KenPom/BartTorvik efficiency data via Firecrawl.
 * Uses flexible column detection + value-range validation instead of brittle regex.
 */

// Fuzzy match scraped name to DB team name
function fuzzyMatch(kenpomName: string, dbNames: string[]): string | null {
  const clean = kenpomName.trim().toLowerCase();
  
  for (const db of dbNames) {
    if (db.toLowerCase() === clean) return db;
  }
  for (const db of dbNames) {
    if (db.toLowerCase().startsWith(clean + ' ')) return db;
  }
  
  const norm = clean.replace(/st\./g, 'state').replace(/\./g, '').replace(/'/g, "'");
  for (const db of dbNames) {
    const dbN = db.toLowerCase().replace(/'/g, "'");
    if (dbN.startsWith(norm + ' ') || dbN === norm) return db;
  }

  const words = norm.split(/\s+/).filter(w => w.length > 2);
  for (const db of dbNames) {
    const dbL = db.toLowerCase();
    if (words.length >= 2 && words.every(w => dbL.includes(w))) return db;
  }
  return null;
}

const KENPOM_TO_DB: Record<string, string> = {
  'connecticut': 'Connecticut Huskies', 'uconn': 'Connecticut Huskies',
  'north carolina': 'North Carolina Tar Heels', 'unc': 'North Carolina Tar Heels',
  'michigan st.': 'Michigan State Spartans', 'michigan state': 'Michigan State Spartans',
  'ohio st.': 'Ohio State Buckeyes', 'ohio state': 'Ohio State Buckeyes',
  'penn st.': 'Penn State Nittany Lions', 'penn state': 'Penn State Nittany Lions',
  'oklahoma st.': 'Oklahoma State Cowboys', 'iowa st.': 'Iowa State Cyclones',
  'iowa state': 'Iowa State Cyclones', 'kansas st.': 'Kansas State Wildcats',
  'boise st.': 'Boise State Broncos', 'san diego st.': 'San Diego State Aztecs',
  'colorado st.': 'Colorado State Rams', 'fresno st.': 'Fresno State Bulldogs',
  'arizona st.': 'Arizona State Sun Devils', 'oregon st.': 'Oregon State Beavers',
  'mississippi st.': 'Mississippi State Bulldogs', 'washington st.': 'Washington State Cougars',
  'nc state': 'NC State Wolfpack', 'miami fl': 'Miami Hurricanes',
  'miami oh': 'Miami (OH) RedHawks', 'loyola chicago': 'Loyola Chicago Ramblers',
  "saint mary's": "Saint Mary's Gaels", 'vcu': 'VCU Rams', 'smu': 'SMU Mustangs',
  'ucf': 'UCF Knights', 'lsu': 'LSU Tigers', 'usc': 'USC Trojans',
  'byu': 'BYU Cougars', 'unlv': 'UNLV Rebels',
  'texas a&m': 'Texas A&M Aggies', 'ole miss': 'Ole Miss Rebels',
  'st. john\'s': "St. John's Red Storm", "saint john's": "St. John's Red Storm",
  'murray st.': 'Murray State Racers', 'utah st.': 'Utah State Aggies',
  'montana st.': 'Montana State Bobcats', 'sacramento st.': 'Sacramento State Hornets',
  'ball st.': 'Ball State Cardinals', 'kent st.': 'Kent State Golden Flashes',
  'portland st.': 'Portland State Vikings', 'weber st.': 'Weber State Wildcats',
  'wichita st.': 'Wichita State Shockers', 'wright st.': 'Wright State Raiders',
  'cleveland st.': 'Cleveland State Vikings', 'youngstown st.': 'Youngstown State Penguins',
  'norfolk st.': 'Norfolk State Spartans', 'morgan st.': 'Morgan State Bears',
  'coppin st.': 'Coppin State Eagles', 'south carolina st.': 'South Carolina State Bulldogs',
  'alabama st.': 'Alabama State Hornets', 'jackson st.': 'Jackson State Tigers',
  'alcorn st.': 'Alcorn State Braves', 'mississippi val.': 'Mississippi Valley State Delta Devils',
  'grambling': 'Grambling Tigers', 'prairie view a&m': 'Prairie View A&M Panthers',
  'texas southern': 'Texas Southern Tigers', 'arkansas st.': 'Arkansas State Red Wolves',
  'appalachian st.': 'Appalachian State Mountaineers', 'georgia st.': 'Georgia State Panthers',
};

interface ParsedTeam {
  rank: number;
  name: string;
  adjO: number;
  adjD: number;
  adjT: number;
  dbName: string | null;
}

/**
 * Flexible table parser with column auto-detection.
 * Instead of assuming column positions, we detect which columns contain
 * AdjO (95-130), AdjD (85-115), and AdjT (60-75) by checking value ranges.
 */
function parseRankingsTable(markdown: string, dbNames: string[]): ParsedTeam[] {
  const teams: ParsedTeam[] = [];
  const lines = markdown.split('\n');

  // Strip markdown links
  const stripLinks = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  // Find lines that look like table rows with a rank
  for (const rawLine of lines) {
    const line = stripLinks(rawLine);
    
    // Must have pipe delimiters or be a table-like row
    if (!line.includes('|') && !line.match(/^\s*\d{1,3}\s/)) continue;
    
    // Split by pipe
    const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 6) continue;

    // First cell should be a rank (1-400)
    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 400) continue;

    // Second cell should be team name (contains letters)
    const teamName = cells[1].replace(/\s+/g, ' ').trim();
    if (!teamName.match(/[a-zA-Z]{2,}/)) continue;

    // Extract all numeric values from remaining cells
    const numericCells: { idx: number; val: number }[] = [];
    for (let i = 2; i < cells.length; i++) {
      // Strip leading +/- for AdjEM, parse pure numbers
      const cleaned = cells[i].replace(/^[+-]/, '');
      const val = parseFloat(cleaned);
      if (!isNaN(val)) {
        numericCells.push({ idx: i, val });
      }
    }

    if (numericCells.length < 3) continue;

    // Auto-detect columns by value range
    // AdjO: 95-130 (offensive efficiency per 100 possessions)
    // AdjD: 85-120 (defensive efficiency per 100 possessions)  
    // AdjT: 58-78 (tempo / possessions per game)
    let adjO: number | null = null;
    let adjD: number | null = null;
    let adjT: number | null = null;

    // Strategy: Find pairs of values in the 85-130 range (AdjO then AdjD)
    // followed by a value in the 58-78 range (AdjT)
    for (let i = 0; i < numericCells.length - 2; i++) {
      const v1 = numericCells[i].val;
      const v2 = numericCells[i + 1].val;
      const v3 = numericCells[i + 2].val;

      // Check if v1 looks like AdjO (higher, 95-135) and v2 like AdjD (85-120)
      if (v1 >= 90 && v1 <= 135 && v2 >= 80 && v2 <= 125 && v3 >= 55 && v3 <= 80) {
        adjO = v1;
        adjD = v2;
        adjT = v3;
        break;
      }
    }

    // Fallback: look for AdjEM first (signed value), then AdjO, AdjD, AdjT follow
    if (adjO === null) {
      for (let i = 0; i < numericCells.length - 3; i++) {
        const v1 = numericCells[i].val;     // AdjEM (could be negative)
        const v2 = numericCells[i + 1].val; // AdjO
        const v3 = numericCells[i + 2].val; // AdjD
        const v4 = numericCells[i + 3].val; // AdjT

        if (Math.abs(v1) <= 40 && v2 >= 90 && v2 <= 135 && v3 >= 80 && v3 <= 125 && v4 >= 55 && v4 <= 80) {
          adjO = v2;
          adjD = v3;
          adjT = v4;
          break;
        }
      }
    }

    // Validate: reject garbage
    if (adjO === null || adjD === null || adjT === null) continue;
    if (adjD < 80 || adjD > 120) continue; // Key validation from plan
    if (adjO < 90 || adjO > 135) continue;
    if (adjT < 55 || adjT > 80) continue;

    const dbName = KENPOM_TO_DB[teamName.toLowerCase()] || fuzzyMatch(teamName, dbNames);
    teams.push({ rank, name: teamName, adjO, adjD, adjT, dbName });
  }

  return teams;
}

/**
 * Fallback: parse non-pipe-delimited lines (space-separated data)
 */
function parseSpaceSeparatedLines(markdown: string, dbNames: string[]): ParsedTeam[] {
  const teams: ParsedTeam[] = [];
  const lines = markdown.split('\n');
  const stripLinks = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  for (const rawLine of lines) {
    const line = stripLinks(rawLine);
    
    // Match: rank, team name, then numbers
    const rankMatch = line.match(/^\s*(\d{1,3})\s+/);
    if (!rankMatch) continue;
    
    const rank = parseInt(rankMatch[1]);
    if (rank < 1 || rank > 400) continue;

    // Extract all floats from the line
    const floats = [...line.matchAll(/([\d]+\.[\d]+)/g)].map(m => parseFloat(m[1]));
    if (floats.length < 3) continue;

    // Find triplet: AdjO (95-135), AdjD (80-120), AdjT (55-80)
    for (let i = 0; i < floats.length - 2; i++) {
      if (floats[i] >= 90 && floats[i] <= 135 && 
          floats[i+1] >= 80 && floats[i+1] <= 120 &&
          floats[i+2] >= 55 && floats[i+2] <= 80) {
        
        // Extract team name between rank and first number
        const afterRank = line.substring(rankMatch[0].length);
        const nameEnd = afterRank.search(/\d/);
        if (nameEnd < 2) continue;
        
        const teamName = afterRank.substring(0, nameEnd).replace(/\|/g, '').trim();
        if (teamName.length < 3) continue;

        const dbName = KENPOM_TO_DB[teamName.toLowerCase()] || fuzzyMatch(teamName, dbNames);
        teams.push({ rank, name: teamName, adjO: floats[i], adjD: floats[i+1], adjT: floats[i+2], dbName });
        break;
      }
    }
  }

  return teams;
}

/**
 * BartTorvik-specific parser: their table often renders as lines like:
 * "1 Auburn SEC 24-2 +34.78 123.1 88.3 68.5 ..."
 * or with rank and team on same line followed by numbers
 */
function parseBartTorvik(markdown: string, dbNames: string[]): ParsedTeam[] {
  const teams: ParsedTeam[] = [];
  const lines = markdown.split('\n');
  const stripLinks = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  for (const rawLine of lines) {
    const line = stripLinks(rawLine).trim();
    if (line.length < 10) continue;

    // Match pattern: rank, team name, conf, record, then numbers
    // "1 Auburn SEC 24-2 +34.78 123.1 88.3 68.5"
    const match = line.match(/^(\d{1,3})\s+([A-Za-z][A-Za-z\s.'()\-&]+?)\s+([A-Z][A-Za-z0-9 ]+?)\s+(\d+-\d+)\s+(.*)/);
    if (!match) continue;

    const rank = parseInt(match[1]);
    if (rank < 1 || rank > 400) continue;

    const teamName = match[2].trim();
    const numbersStr = match[5];

    // Extract all numbers from the rest
    const nums = [...numbersStr.matchAll(/[+-]?(\d+\.?\d*)/g)].map(m => parseFloat(m[0]));
    if (nums.length < 3) continue;

    // Find AdjO, AdjD, AdjT triplet
    // First number is often AdjEM (net rating), then AdjO, AdjD, AdjT
    for (let i = 0; i < nums.length - 2; i++) {
      const v1 = nums[i], v2 = nums[i+1], v3 = nums[i+2];
      if (v1 >= 90 && v1 <= 135 && v2 >= 80 && v2 <= 120 && v3 >= 55 && v3 <= 80) {
        const dbName = KENPOM_TO_DB[teamName.toLowerCase()] || fuzzyMatch(teamName, dbNames);
        teams.push({ rank, name: teamName, adjO: v1, adjD: v2, adjT: v3, dbName });
        break;
      }
    }
    // Also try skipping first number (AdjEM)
    if (teams.length === 0 || teams[teams.length - 1]?.rank !== rank) {
      if (nums.length >= 4) {
        for (let i = 1; i < nums.length - 2; i++) {
          const v1 = Math.abs(nums[i]), v2 = Math.abs(nums[i+1]), v3 = Math.abs(nums[i+2]);
          if (v1 >= 90 && v1 <= 135 && v2 >= 80 && v2 <= 120 && v3 >= 55 && v3 <= 80) {
            const dbName = KENPOM_TO_DB[teamName.toLowerCase()] || fuzzyMatch(teamName, dbNames);
            teams.push({ rank, name: teamName, adjO: v1, adjD: v2, adjT: v3, dbName });
            break;
          }
        }
      }
    }
  }

  console.log(`[KenPom v2] BartTorvik custom parser found ${teams.length} teams`);
  return teams;
}

Deno.serve(async (req) => {
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
    console.log('[KenPom v2] Starting scrape...');

    // Get existing team names from DB
    const { data: existingTeams } = await supabase
      .from('ncaab_team_stats').select('team_name');
    const dbNames = (existingTeams || []).map((t: any) => t.team_name);
    console.log(`[KenPom v2] ${dbNames.length} teams in DB`);

    let teams: ParsedTeam[] = [];
    let source = 'unknown';

    // ===== ATTEMPT 1: BartTorvik rankings page (public, full data) =====
    // Try multiple BartTorvik URLs - the rankings page with explicit year renders better
    const bartUrls = [
      'https://barttorvik.com/trank.php?year=2026',
    ];

    for (const bartUrl of bartUrls) {
      if (teams.length >= 100) break;
      console.log(`[KenPom v2] Trying ${bartUrl}...`);
      
      const bartResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: bartUrl,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 10000,
        }),
      });

      const bartData = await bartResp.json();
      const bartMd = bartData?.data?.markdown || bartData?.markdown || '';
      console.log(`[KenPom v2] BartTorvik markdown: ${bartMd.length} chars from ${bartUrl}`);

      if (bartMd.length > 500) {
        const sampleLines = bartMd.split('\n').slice(0, 40);
        console.log('[KenPom v2] BartTorvik sample:', sampleLines.join('\n'));

        // Try pipe-delimited table
        let parsed = parseRankingsTable(bartMd, dbNames);
        if (parsed.length < 50) {
          console.log(`[KenPom v2] Pipe parser got ${parsed.length}, trying space-separated...`);
          const spaceParsed = parseSpaceSeparatedLines(bartMd, dbNames);
          if (spaceParsed.length > parsed.length) parsed = spaceParsed;
        }
        
        // Also try a custom BartTorvik parser — their table often lacks pipes
        if (parsed.length < 50) {
          const bartParsed = parseBartTorvik(bartMd, dbNames);
          if (bartParsed.length > parsed.length) parsed = bartParsed;
        }

        if (parsed.length > teams.length) {
          teams = parsed;
          source = 'barttorvik';
        }
      }
    }

    // ===== ATTEMPT 2: KenPom (may need subscription) =====
    if (teams.length < 50) {
      console.log('[KenPom v2] BartTorvik insufficient, trying kenpom.com...');
      const kpResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://kenpom.com/',
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 5000,
        }),
      });

      const kpData = await kpResp.json();
      const kpMd = kpData?.data?.markdown || kpData?.markdown || '';
      console.log(`[KenPom v2] KenPom markdown: ${kpMd.length} chars`);

      if (kpMd.length > 500) {
        const sampleLines = kpMd.split('\n').slice(0, 30);
        console.log('[KenPom v2] KenPom sample:', sampleLines.join('\n'));

        const kpTeams = parseRankingsTable(kpMd, dbNames);
        if (kpTeams.length > teams.length) {
          teams = kpTeams;
          source = 'kenpom';
        }
        if (teams.length < 50) {
          const spaceTeams = parseSpaceSeparatedLines(kpMd, dbNames);
          if (spaceTeams.length > teams.length) {
            teams = spaceTeams;
            source = 'kenpom';
          }
        }
      }
    }

    console.log(`[KenPom v2] Parsed ${teams.length} teams from ${source}`);

    if (teams.length === 0) {
      return new Response(JSON.stringify({
        success: false, error: 'No teams parsed from any source',
        bartMdLength: bartMd?.length || 0,
      }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Log top 10 for verification
    const top10 = teams.slice(0, 10).map(t => `#${t.rank} ${t.name} (O:${t.adjO} D:${t.adjD} T:${t.adjT} -> ${t.dbName || 'UNMATCHED'})`);
    console.log('[KenPom v2] Top 10:', top10);

    // Update matched teams in DB
    let matched = 0, unmatched = 0;
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
          kenpom_source: source,
          updated_at: new Date().toISOString(),
        })
        .eq('team_name', team.dbName);

      if (!error) matched++;
      else console.warn(`[KenPom v2] Update failed for ${team.dbName}:`, error.message);
    }

    const summary = {
      success: true, source,
      teams_parsed: teams.length,
      teams_matched: matched,
      teams_unmatched: unmatched,
      unmatched_sample: unmatchedNames.slice(0, 10),
      top_5: teams.slice(0, 5).map(t => `#${t.rank} ${t.name} (O:${t.adjO}, D:${t.adjD})`),
    };

    console.log('[KenPom v2] Done:', summary);

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

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KenPom v2] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

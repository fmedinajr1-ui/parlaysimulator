import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerStatus {
  name: string;
  team?: string;
  position: string;
  status: 'STARTING' | 'BENCH' | 'OUT' | 'GTD' | 'QUESTIONABLE' | 'DOUBTFUL' | 'PROBABLE';
  injuryNote?: string;
  source?: string;
}

interface GameLineup {
  homeTeam: string;
  awayTeam: string;
  tipTime?: string;
  homeStarters: PlayerStatus[];
  awayStarters: PlayerStatus[];
  homeBench: PlayerStatus[];
  awayBench: PlayerStatus[];
  confirmed: boolean;
  injuries: PlayerStatus[];
}

interface GameInfo {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  startTime: string;
}

// Normalize player name for matching
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Map ESPN status to our status format
function mapESPNStatus(espnStatus: string): PlayerStatus['status'] {
  const upper = espnStatus?.toUpperCase() || '';
  if (upper.includes('OUT') || upper.includes('O)')) return 'OUT';
  if (upper.includes('DOUBTFUL') || upper.includes('D)')) return 'DOUBTFUL';
  if (upper.includes('QUESTIONABLE') || upper.includes('Q)')) return 'QUESTIONABLE';
  if (upper.includes('DAY-TO-DAY') || upper.includes('DTD')) return 'GTD';
  if (upper.includes('PROBABLE') || upper.includes('P)')) return 'PROBABLE';
  return 'OUT'; // Default to OUT for safety
}

// Get impact level from status
function getImpactLevel(status: PlayerStatus['status']): string {
  switch (status) {
    case 'OUT': return 'critical';
    case 'DOUBTFUL': return 'high';
    case 'GTD':
    case 'QUESTIONABLE': return 'high';
    case 'PROBABLE': return 'low';
    default: return 'medium';
  }
}

// ============= ESPN API FUNCTIONS =============

// Fetch injury data from ESPN NBA Injuries endpoint
async function fetchESPNInjuries(): Promise<PlayerStatus[]> {
  console.log('[ESPN] Fetching injuries from ESPN API...');
  
  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      console.error('[ESPN] Injuries API error:', response.status);
      return [];
    }
    
    const data = await response.json();
    const injuries: PlayerStatus[] = [];
    
    // ESPN returns injuries grouped by team
    for (const teamEntry of data.teams || []) {
      const teamName = teamEntry.team?.displayName || 'Unknown';
      
      for (const injury of teamEntry.injuries || []) {
        const athlete = injury.athlete || {};
        const playerName = athlete.displayName || '';
        const position = athlete.position?.abbreviation || '';
        const injuryType = injury.type?.text || '';
        const status = injury.status || '';
        const details = injury.details?.detail || '';
        
        if (playerName) {
          injuries.push({
            name: playerName,
            team: teamName,
            position,
            status: mapESPNStatus(status),
            injuryNote: `${injuryType}${details ? ' - ' + details : ''}`.trim() || status,
            source: 'espn'
          });
        }
      }
    }
    
    console.log(`[ESPN] Found ${injuries.length} injuries from ESPN API`);
    return injuries;
    
  } catch (error) {
    console.error('[ESPN] Error fetching injuries:', error);
    return [];
  }
}

// Fetch today's games from ESPN scoreboard
async function fetchTodaysGames(): Promise<GameInfo[]> {
  console.log('[ESPN] Fetching today\'s games from scoreboard...');
  
  try {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}`;
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      console.error('[ESPN] Scoreboard API error:', response.status);
      return [];
    }
    
    const data = await response.json();
    const games: GameInfo[] = [];
    
    for (const event of data.events || []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      
      const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home')?.team?.displayName || '';
      const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away')?.team?.displayName || '';
      
      games.push({
        eventId: event.id,
        homeTeam,
        awayTeam,
        status: event.status?.type?.name || '',
        startTime: event.date || ''
      });
    }
    
    console.log(`[ESPN] Found ${games.length} games on today's slate`);
    return games;
    
  } catch (error) {
    console.error('[ESPN] Error fetching scoreboard:', error);
    return [];
  }
}

// Fetch game summary for inactive/DNP players (for games starting soon)
async function fetchGameInactives(eventId: string): Promise<string[]> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const inactives: string[] = [];
    
    // Check boxscore for DNP/inactive players
    for (const team of data.boxscore?.players || []) {
      for (const category of team.statistics || []) {
        for (const athlete of category.athletes || []) {
          if (athlete.didNotPlay || athlete.reason) {
            const name = athlete.athlete?.displayName;
            if (name) inactives.push(name);
          }
        }
      }
    }
    
    // Also check gameInfo for injuries if available
    for (const team of data.gameInfo?.venue?.injuries || []) {
      for (const injury of team || []) {
        const name = injury?.athlete?.displayName;
        if (name) inactives.push(name);
      }
    }
    
    return [...new Set(inactives)]; // Dedupe
    
  } catch (error) {
    console.error(`[ESPN] Error fetching game ${eventId} inactives:`, error);
    return [];
  }
}

// ============= ROTOWIRE FUNCTIONS =============

// Parse injury status from text
function parseInjuryStatus(text: string): { status: PlayerStatus['status']; note: string } {
  const upperText = text.toUpperCase();
  
  if (upperText.includes('OUT') || upperText.includes('O)')) {
    return { status: 'OUT', note: text };
  }
  if (upperText.includes('DOUBTFUL') || upperText.includes('D)')) {
    return { status: 'DOUBTFUL', note: text };
  }
  if (upperText.includes('QUESTIONABLE') || upperText.includes('Q)')) {
    return { status: 'QUESTIONABLE', note: text };
  }
  if (upperText.includes('GTD') || upperText.includes('GAME-TIME') || upperText.includes('GAME TIME')) {
    return { status: 'GTD', note: text };
  }
  if (upperText.includes('PROBABLE') || upperText.includes('P)')) {
    return { status: 'PROBABLE', note: text };
  }
  
  return { status: 'STARTING', note: '' };
}

// Validate player name
function isValidPlayerName(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (/[<>\[\](){}|\\]|https?:/.test(name)) return false;
  
  const uiTerms = ['expected', 'lineup', 'announce', 'display', 'click', 'show', 'view', 'stats', 'build', 'bet', 'see', 'our', 'get', 'sign', 'log', 'add', 'vote', 'not'];
  const lowerName = name.toLowerCase();
  if (uiTerms.some(term => lowerName.includes(term))) return false;
  
  if (!words.every(w => /^[A-Z]/.test(w))) return false;
  
  return true;
}

// NBA player surnames for validation
const nbaPlayerSurnamePatterns = /\b(LeBron|Embiid|Leonard|Curry|Durant|Giannis|Jokic|Doncic|Tatum|Morant|Edwards|Davis|Butler|George|Harden|Lillard|Mitchell|Booker|Irving|Towns|Beal|Murray|Ball|Brown|Williams|Thomas|Johnson|Robinson|Jackson|White|Young|Green|Harris|Thompson|Allen|Walker|Fox|Ingram|Cunningham|Brunson|Haliburton|Sengun|Maxey|Garland|Mobley|Barnes|Banchero|Wembanyama|Holiday|Poole|Middleton|Lopez|Bridges|Suggs|Wagner|Smith|Alexander|Gilgeous|Randle|Quickley|Simons|Grant|Turner|Ayton|Portis|Vassell|McDaniels|Gobert|Reid|Clarkson|Keldon|Sochan|Sabonis|DeRozan|LaVine|Zion|Williamson|Antetokounmpo|Porzingis|Adebayo|Herro|Lowry|VanVleet|Siakam|Anunoby|Smart|Horford|Trae|Dejounte|Collins|Capela|Cade|Bey|Ivey|Duarte|Hield|Hachimura|Kuzma|Poeltl|Valanciunas|McCollum|Zubac|Powell|Norman|Dort|Shai|Giddey|Holmgren|Oladipo|Rozier|Hayward|LaMelo|Miles|PJ|Washington|Aldama|Bane|Brooks|Claxton|Cam|Draymond|Klay|Wiggins|Looney|Kuminga)\b/i;

// Parse RotoWire markdown
function parseRotoWireMarkdown(markdown: string): PlayerStatus[] {
  console.log('[RotoWire] Parsing markdown, length:', markdown.length);
  
  const playerStatuses: PlayerStatus[] = [];
  const seenPlayers = new Set<string>();
  
  // Parse markdown links with status
  const linkPatterns = [
    /\[([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+)+)\]\([^)]+\)\s*(?:[-–])?\s*(OUT|Out|GTD|Gtd|QUESTIONABLE|Questionable|DOUBTFUL|Doubtful|PROBABLE|Probable)/g,
    /\[([A-Z]\.\s*[A-Z][a-z]+)\]\([^)]*"([^"]+)"[^)]*\)\s*(?:[-–])?\s*(OUT|Out|GTD|Gtd|QUESTIONABLE|Questionable|DOUBTFUL|Doubtful|PROBABLE|Probable)/g,
  ];
  
  // Plain text patterns
  const plainPatterns = [
    /\b([A-Z][a-z]+\s+[A-Z][a-z'-]+)\s*[-–]\s*(OUT|GTD|QUESTIONABLE|DOUBTFUL)\s*(?:\([^)]+\))?/gi,
  ];
  
  for (const pattern of linkPatterns) {
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const playerName = match[2] && match[3] ? match[2] : match[1];
      const status = (match[2] && match[3] ? match[3] : match[2]).toUpperCase() as PlayerStatus['status'];
      
      if (nbaPlayerSurnamePatterns.test(playerName) && isValidPlayerName(playerName)) {
        const normalizedName = playerName.toLowerCase().trim();
        if (!seenPlayers.has(normalizedName)) {
          seenPlayers.add(normalizedName);
          playerStatuses.push({
            name: playerName.trim(),
            position: '',
            status,
            injuryNote: match[0],
            source: 'rotowire'
          });
        }
      }
    }
  }
  
  for (const pattern of plainPatterns) {
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const playerName = match[1].trim();
      const status = match[2].toUpperCase() as PlayerStatus['status'];
      
      if (nbaPlayerSurnamePatterns.test(playerName) && isValidPlayerName(playerName)) {
        const normalizedName = playerName.toLowerCase().trim();
        if (!seenPlayers.has(normalizedName)) {
          seenPlayers.add(normalizedName);
          playerStatuses.push({
            name: playerName,
            position: '',
            status,
            injuryNote: match[0],
            source: 'rotowire'
          });
        }
      }
    }
  }
  
  console.log('[RotoWire] Found', playerStatuses.length, 'validated player statuses');
  return playerStatuses;
}

// Scrape RotoWire using Firecrawl
async function scrapeRotoWire(apiKey: string): Promise<PlayerStatus[]> {
  console.log('[RotoWire] Starting Firecrawl scrape...');
  
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://www.rotowire.com/basketball/nba-lineups.php',
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.error('[RotoWire] Firecrawl error:', data);
      return [];
    }

    const markdown = data.data?.markdown || data.markdown || '';
    return parseRotoWireMarkdown(markdown);
    
  } catch (error) {
    console.error('[RotoWire] Scrape error:', error);
    return [];
  }
}

// ============= MERGE LOGIC =============

function mergeInjurySources(
  espnInjuries: PlayerStatus[],
  gameInactives: Map<string, { players: string[]; game: GameInfo }>,
  rotoWireData: PlayerStatus[]
): PlayerStatus[] {
  const merged = new Map<string, PlayerStatus>();
  
  // Priority 1: Game-day inactives (most current, confirmed OUT)
  for (const [eventId, { players, game }] of gameInactives) {
    for (const playerName of players) {
      const key = normalizeName(playerName);
      merged.set(key, {
        name: playerName,
        team: `${game.awayTeam} @ ${game.homeTeam}`,
        position: '',
        status: 'OUT',
        source: 'espn_gameday',
        injuryNote: 'Inactive for tonight\'s game'
      });
    }
  }
  
  // Priority 2: ESPN injuries (structured, reliable)
  for (const injury of espnInjuries) {
    const key = normalizeName(injury.name);
    if (!merged.has(key)) {
      merged.set(key, { ...injury, source: 'espn' });
    }
  }
  
  // Priority 3: RotoWire (confirms starters, catches last-minute changes)
  for (const player of rotoWireData) {
    const key = normalizeName(player.name);
    const existing = merged.get(key);
    
    if (!existing) {
      merged.set(key, { ...player, source: 'rotowire' });
    } else if (player.status === 'OUT' && existing.status !== 'OUT') {
      // RotoWire says OUT, upgrade severity
      merged.set(key, { ...player, source: 'rotowire' });
    }
  }
  
  return Array.from(merged.values());
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { includeRotoWire = true } = await req.json().catch(() => ({}));
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

    const today = new Date().toISOString().split('T')[0];
    const sourceCounts = { espn: 0, espn_gameday: 0, rotowire: 0 };

    // STEP 1: Fetch ESPN injuries (always reliable, no API key needed)
    console.log('[LineupScraper] Step 1: Fetching ESPN injuries...');
    const espnInjuries = await fetchESPNInjuries();
    sourceCounts.espn = espnInjuries.length;
    
    // STEP 2: Fetch today's games from ESPN scoreboard
    console.log('[LineupScraper] Step 2: Fetching today\'s games...');
    const todaysGames = await fetchTodaysGames();
    
    // STEP 3: Fetch game summaries for games starting soon (within 3 hours)
    console.log('[LineupScraper] Step 3: Fetching game-day inactives...');
    const gameInactives = new Map<string, { players: string[]; game: GameInfo }>();
    
    for (const game of todaysGames) {
      const hoursUntilStart = (new Date(game.startTime).getTime() - Date.now()) / (1000 * 60 * 60);
      // Check games starting within 3 hours or already started (up to 3 hours ago)
      if (hoursUntilStart < 3 && hoursUntilStart > -3) {
        const inactives = await fetchGameInactives(game.eventId);
        if (inactives.length > 0) {
          gameInactives.set(game.eventId, { players: inactives, game });
          sourceCounts.espn_gameday += inactives.length;
        }
      }
    }
    
    // STEP 4: (Optional) Scrape RotoWire for additional data
    let rotoWireData: PlayerStatus[] = [];
    if (includeRotoWire && firecrawlKey) {
      console.log('[LineupScraper] Step 4: Scraping RotoWire...');
      rotoWireData = await scrapeRotoWire(firecrawlKey);
      sourceCounts.rotowire = rotoWireData.length;
    } else if (!firecrawlKey) {
      console.log('[LineupScraper] Step 4: Skipping RotoWire (no Firecrawl key)');
    }
    
    // STEP 5: Merge all sources
    console.log('[LineupScraper] Step 5: Merging data sources...');
    const mergedAlerts = mergeInjurySources(espnInjuries, gameInactives, rotoWireData);
    console.log(`[LineupScraper] Merged to ${mergedAlerts.length} unique player alerts`);
    
    // STEP 6: Store in database
    // Delete old alerts for today first
    await supabase
      .from('lineup_alerts')
      .delete()
      .eq('game_date', today);
    
    const alertInserts = mergedAlerts.map(player => ({
      player_name: player.name,
      normalized_name: normalizeName(player.name),
      team: player.team || 'Unknown',
      alert_type: player.status,
      details: `${player.name} is ${player.status}`,
      injury_note: player.injuryNote || '',
      impact_level: getImpactLevel(player.status),
      game_date: today,
      source: player.source || 'unknown'
    }));
    
    if (alertInserts.length > 0) {
      const { error: alertError } = await supabase
        .from('lineup_alerts')
        .insert(alertInserts);
      
      if (alertError) {
        console.error('[LineupScraper] Error storing alerts:', alertError);
      } else {
        console.log('[LineupScraper] Successfully stored', alertInserts.length, 'alerts');
      }
    }
    
    // Also store game lineup data
    const gameInserts = todaysGames.map(game => ({
      game_date: today,
      home_team: game.homeTeam,
      away_team: game.awayTeam,
      home_starters: [],
      away_starters: [],
      home_bench: [],
      away_bench: [],
      injuries: mergedAlerts.filter(a => 
        a.team?.includes(game.homeTeam) || a.team?.includes(game.awayTeam)
      ),
      confirmed: game.status === 'STATUS_IN_PROGRESS' || game.status === 'STATUS_FINAL',
      source: 'espn',
      scraped_at: new Date().toISOString(),
    }));
    
    if (gameInserts.length > 0) {
      const { error: lineupError } = await supabase
        .from('starting_lineups')
        .upsert(gameInserts, { 
          onConflict: 'game_date,home_team,away_team',
          ignoreDuplicates: false 
        });
      
      if (lineupError) {
        console.error('[LineupScraper] Error storing lineups:', lineupError);
      }
    }

    console.log('[LineupScraper] Complete!', {
      games: todaysGames.length,
      alerts: mergedAlerts.length,
      sources: sourceCounts
    });

    return new Response(
      JSON.stringify({
        success: true,
        games: todaysGames.length,
        alerts: mergedAlerts.length,
        sources: sourceCounts,
        data: {
          games: todaysGames,
          alerts: mergedAlerts,
          scrapedAt: new Date().toISOString(),
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[LineupScraper] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerStatus {
  name: string;
  position: string;
  status: 'STARTING' | 'BENCH' | 'OUT' | 'GTD' | 'QUESTIONABLE' | 'DOUBTFUL' | 'PROBABLE';
  injuryNote?: string;
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

// Normalize player name for matching
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

// NBA team names for validation
const NBA_TEAMS = new Set([
  'hawks', 'celtics', 'nets', 'hornets', 'bulls', 'cavaliers', 'mavericks', 'nuggets',
  'pistons', 'warriors', 'rockets', 'pacers', 'clippers', 'lakers', 'grizzlies', 'heat',
  'bucks', 'timberwolves', 'pelicans', 'knicks', 'thunder', 'magic', 'sixers', '76ers',
  'suns', 'blazers', 'kings', 'spurs', 'raptors', 'jazz', 'wizards',
  'atlanta', 'boston', 'brooklyn', 'charlotte', 'chicago', 'cleveland', 'dallas', 'denver',
  'detroit', 'golden state', 'houston', 'indiana', 'la clippers', 'los angeles clippers',
  'la lakers', 'los angeles lakers', 'memphis', 'miami', 'milwaukee', 'minnesota',
  'new orleans', 'new york', 'oklahoma city', 'orlando', 'philadelphia', 'phoenix',
  'portland', 'sacramento', 'san antonio', 'toronto', 'utah', 'washington'
]);

// Check if text looks like an NBA team name
function isNbaTeam(text: string): boolean {
  const lower = text.toLowerCase().trim();
  for (const team of NBA_TEAMS) {
    if (lower.includes(team)) return true;
  }
  return false;
}

// Parse team name from various formats
function parseTeamName(text: string): string {
  const teamMappings: Record<string, string> = {
    'lakers': 'Los Angeles Lakers', 'lal': 'Los Angeles Lakers', 'la lakers': 'Los Angeles Lakers',
    'celtics': 'Boston Celtics', 'bos': 'Boston Celtics',
    'warriors': 'Golden State Warriors', 'gsw': 'Golden State Warriors', 'golden state': 'Golden State Warriors',
    'nuggets': 'Denver Nuggets', 'den': 'Denver Nuggets',
    'bucks': 'Milwaukee Bucks', 'mil': 'Milwaukee Bucks',
    'suns': 'Phoenix Suns', 'phx': 'Phoenix Suns',
    'heat': 'Miami Heat', 'mia': 'Miami Heat',
    'nets': 'Brooklyn Nets', 'bkn': 'Brooklyn Nets',
    'sixers': 'Philadelphia 76ers', '76ers': 'Philadelphia 76ers', 'phi': 'Philadelphia 76ers',
    'knicks': 'New York Knicks', 'nyk': 'New York Knicks', 'new york': 'New York Knicks',
    'bulls': 'Chicago Bulls', 'chi': 'Chicago Bulls',
    'cavaliers': 'Cleveland Cavaliers', 'cavs': 'Cleveland Cavaliers', 'cle': 'Cleveland Cavaliers',
    'hawks': 'Atlanta Hawks', 'atl': 'Atlanta Hawks',
    'raptors': 'Toronto Raptors', 'tor': 'Toronto Raptors',
    'hornets': 'Charlotte Hornets', 'cha': 'Charlotte Hornets',
    'wizards': 'Washington Wizards', 'was': 'Washington Wizards',
    'magic': 'Orlando Magic', 'orl': 'Orlando Magic',
    'pacers': 'Indiana Pacers', 'ind': 'Indiana Pacers',
    'pistons': 'Detroit Pistons', 'det': 'Detroit Pistons',
    'clippers': 'Los Angeles Clippers', 'lac': 'Los Angeles Clippers', 'la clippers': 'Los Angeles Clippers',
    'mavericks': 'Dallas Mavericks', 'mavs': 'Dallas Mavericks', 'dal': 'Dallas Mavericks',
    'rockets': 'Houston Rockets', 'hou': 'Houston Rockets',
    'grizzlies': 'Memphis Grizzlies', 'mem': 'Memphis Grizzlies',
    'pelicans': 'New Orleans Pelicans', 'nop': 'New Orleans Pelicans', 'new orleans': 'New Orleans Pelicans',
    'spurs': 'San Antonio Spurs', 'sas': 'San Antonio Spurs', 'san antonio': 'San Antonio Spurs',
    'timberwolves': 'Minnesota Timberwolves', 'wolves': 'Minnesota Timberwolves', 'min': 'Minnesota Timberwolves',
    'thunder': 'Oklahoma City Thunder', 'okc': 'Oklahoma City Thunder', 'oklahoma city': 'Oklahoma City Thunder',
    'blazers': 'Portland Trail Blazers', 'trail blazers': 'Portland Trail Blazers', 'por': 'Portland Trail Blazers',
    'jazz': 'Utah Jazz', 'uta': 'Utah Jazz',
    'kings': 'Sacramento Kings', 'sac': 'Sacramento Kings',
  };

  const lower = text.toLowerCase().trim();
  for (const [key, value] of Object.entries(teamMappings)) {
    if (lower.includes(key)) {
      return value;
    }
  }
  return text.trim();
}

// Parse the markdown content from RotoWire - focus on extracting player status/injuries
function parseLineupMarkdown(markdown: string): GameLineup[] {
  const games: GameLineup[] = [];
  
  console.log('[LineupScraper] Markdown length:', markdown.length);
  
  // Track injuries/status found - we'll match them to players later
  const playerStatuses: Array<{name: string; status: PlayerStatus['status']; note: string}> = [];
  const seenPlayers = new Set<string>();
  
  // List of known NBA player last names to help validate
  const nbaPlayerSurnamePatterns = /\b(LeBron|Embiid|Leonard|Curry|Durant|Giannis|Jokic|Doncic|Tatum|Morant|Edwards|Davis|Butler|George|Harden|Lillard|Mitchell|Booker|Irving|Towns|Beal|Murray|Ball|Brown|Williams|Thomas|Johnson|Robinson|Jackson|White|Young|Green|Harris|Thompson|Allen|Walker|Fox|Ingram|Cunningham|Brunson|Haliburton|Sengun|Maxey|Garland|Mobley|Barnes|Banchero|Wembanyama|Holiday|Poole|Middleton|Lopez|Bridges|Suggs|Wagner|Smith|Alexander|Gilgeous|Randle|Quickley|Simons|Grant|Turner|Ayton|Portis|Vassell|McDaniels|Gobert|Reid|Clarkson|Keldon|Sochan)\b/i;
  
  // Parse markdown links like [Joel Embiid](url) or [K. Leonard](url) followed by status
  const linkWithStatusPatterns = [
    // [Full Name](url) Out/GTD/etc
    /\[([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+)+)\]\([^)]+\)\s*(?:[-–])?\s*(OUT|Out|GTD|Gtd|QUESTIONABLE|Questionable|DOUBTFUL|Doubtful|PROBABLE|Probable)/g,
    // [K. Leonard](url "Full Name") Out - extract title
    /\[([A-Z]\.\s*[A-Z][a-z]+)\]\([^)]*"([^"]+)"[^)]*\)\s*(?:[-–])?\s*(OUT|Out|GTD|Gtd|QUESTIONABLE|Questionable|DOUBTFUL|Doubtful|PROBABLE|Probable)/g,
  ];
  
  // Also look for plain text patterns
  const plainTextPatterns = [
    // "LeBron James - OUT (knee)"
    /\b([A-Z][a-z]+\s+[A-Z][a-z'-]+)\s*[-–]\s*(OUT|GTD|QUESTIONABLE|DOUBTFUL)\s*(?:\([^)]+\))?/gi,
  ];
  
  // Process markdown links first
  for (const pattern of linkWithStatusPatterns) {
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      // Use the title text if available (more complete name), otherwise use link text
      const playerName = match[2] && match[3] ? match[2] : match[1];
      const status = (match[2] && match[3] ? match[3] : match[2]).toUpperCase() as PlayerStatus['status'];
      
      // Validate with NBA player names
      if (nbaPlayerSurnamePatterns.test(playerName)) {
        const normalizedName = playerName.toLowerCase().trim();
        if (!seenPlayers.has(normalizedName)) {
          seenPlayers.add(normalizedName);
          playerStatuses.push({
            name: playerName.trim(),
            status,
            note: match[0],
          });
          console.log('[LineupScraper] Found player from link:', playerName, status);
        }
      }
    }
  }
  
  // Process plain text patterns
  for (const pattern of plainTextPatterns) {
    let match;
    while ((match = pattern.exec(markdown)) !== null) {
      const playerName = match[1].trim();
      const status = match[2].toUpperCase() as PlayerStatus['status'];
      
      // Validate with NBA player names and ensure it's not nav text
      if (nbaPlayerSurnamePatterns.test(playerName) && 
          !playerName.match(/^(Show|Hide|Display|View|Click|Add|Vote|Sign|Log|Get|See|Our|Not|If|you)/i)) {
        const normalizedName = playerName.toLowerCase().trim();
        if (!seenPlayers.has(normalizedName)) {
          seenPlayers.add(normalizedName);
          playerStatuses.push({
            name: playerName,
            status,
            note: match[0],
          });
          console.log('[LineupScraper] Found player from text:', playerName, status);
        }
      }
    }
  }
  
  // For now, we'll create a single "all games" entry with the injuries we found
  if (playerStatuses.length > 0) {
    games.push({
      homeTeam: 'Multiple Games',
      awayTeam: 'Today',
      tipTime: undefined,
      homeStarters: [],
      awayStarters: [],
      homeBench: [],
      awayBench: [],
      confirmed: false,
      injuries: playerStatuses.map(ps => ({
        name: ps.name,
        position: '',
        status: ps.status,
        injuryNote: ps.note,
      })),
    });
  }
  
  console.log('[LineupScraper] Found', playerStatuses.length, 'validated player statuses');
  return games;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl connector not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[LineupScraper] Starting RotoWire scrape...');

    // Scrape RotoWire NBA Lineups
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
        waitFor: 3000, // Wait for dynamic content
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.error('[LineupScraper] Firecrawl error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.error || 'Failed to scrape lineups' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const markdown = data.data?.markdown || data.markdown || '';
    console.log('[LineupScraper] Received markdown length:', markdown.length);

    // Parse the lineup data
    const rawGames = parseLineupMarkdown(markdown);
    console.log('[LineupScraper] Parsed raw games:', rawGames.length);

    // Deduplicate games by home_team + away_team (keep the one with most starters)
    const gameMap = new Map<string, GameLineup>();
    for (const game of rawGames) {
      const key = `${game.homeTeam}|${game.awayTeam}`;
      const existing = gameMap.get(key);
      if (!existing) {
        gameMap.set(key, game);
      } else {
        // Keep the one with more starter data
        const existingStarterCount = existing.homeStarters.length + existing.awayStarters.length;
        const newStarterCount = game.homeStarters.length + game.awayStarters.length;
        if (newStarterCount > existingStarterCount) {
          gameMap.set(key, game);
        }
        // Merge injuries
        const existingInjuryNames = new Set(existing.injuries.map(i => i.name.toLowerCase()));
        for (const injury of game.injuries) {
          if (!existingInjuryNames.has(injury.name.toLowerCase())) {
            existing.injuries.push(injury);
          }
        }
      }
    }
    
    const games = Array.from(gameMap.values());
    console.log('[LineupScraper] Deduplicated to', games.length, 'unique games');

    const today = new Date().toISOString().split('T')[0];
    
    // Store lineups in database
    const lineupInserts = games.map(game => ({
      game_date: today,
      home_team: game.homeTeam,
      away_team: game.awayTeam,
      home_starters: game.homeStarters,
      away_starters: game.awayStarters,
      home_bench: game.homeBench,
      away_bench: game.awayBench,
      injuries: game.injuries,
      confirmed: game.confirmed,
      source: 'rotowire',
      scraped_at: new Date().toISOString(),
    }));

    if (lineupInserts.length > 0) {
      const { error: lineupError } = await supabase
        .from('starting_lineups')
        .upsert(lineupInserts, { 
          onConflict: 'game_date,home_team,away_team',
          ignoreDuplicates: false 
        });

      if (lineupError) {
        console.error('[LineupScraper] Error storing lineups:', lineupError);
      } else {
        console.log('[LineupScraper] Successfully stored', lineupInserts.length, 'games');
      }
    }

    // Store injury alerts
    const alerts: Array<{
      player_name: string;
      normalized_name: string;
      team: string;
      alert_type: string;
      details: string;
      injury_note: string;
      impact_level: string;
      game_date: string;
    }> = [];

    for (const game of games) {
      for (const player of game.injuries) {
        let impactLevel = 'medium';
        if (player.status === 'OUT') impactLevel = 'critical';
        else if (player.status === 'DOUBTFUL') impactLevel = 'high';
        else if (player.status === 'GTD' || player.status === 'QUESTIONABLE') impactLevel = 'high';
        else if (player.status === 'PROBABLE') impactLevel = 'low';

        alerts.push({
          player_name: player.name,
          normalized_name: normalizeName(player.name),
          team: game.homeTeam, // Will be corrected by matching
          alert_type: player.status,
          details: `${player.name} is ${player.status} for ${game.awayTeam} @ ${game.homeTeam}`,
          injury_note: player.injuryNote || '',
          impact_level: impactLevel,
          game_date: today,
        });
      }
    }

    if (alerts.length > 0) {
      // Delete old alerts for today first
      await supabase
        .from('lineup_alerts')
        .delete()
        .eq('game_date', today);

      const { error: alertError } = await supabase
        .from('lineup_alerts')
        .insert(alerts);

      if (alertError) {
        console.error('[LineupScraper] Error storing alerts:', alertError);
      }
    }

    console.log('[LineupScraper] Stored', lineupInserts.length, 'games and', alerts.length, 'alerts');

    return new Response(
      JSON.stringify({
        success: true,
        games: games.length,
        alerts: alerts.length,
        data: {
          games,
          alerts,
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

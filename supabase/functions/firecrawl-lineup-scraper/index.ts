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

// Parse the markdown content from RotoWire
function parseLineupMarkdown(markdown: string): GameLineup[] {
  const games: GameLineup[] = [];
  
  // Split by game sections - RotoWire uses team names as headers
  const lines = markdown.split('\n');
  let currentGame: Partial<GameLineup> | null = null;
  let currentSection: 'away' | 'home' | null = null;
  let isStartersSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Look for game matchups (e.g., "Lakers @ Celtics" or "LAL vs BOS")
    // Only match if BOTH sides look like NBA teams
    const matchupPattern = /([A-Za-z\s]+)\s*[@vs\.]+\s*([A-Za-z\s]+)/i;
    const matchupMatch = line.match(matchupPattern);
    
    if (matchupMatch) {
      const awayCandidate = matchupMatch[1].trim();
      const homeCandidate = matchupMatch[2].trim();
      
      // Only proceed if both look like NBA teams
      if (isNbaTeam(awayCandidate) && isNbaTeam(homeCandidate)) {
        // Save previous game if exists
        if (currentGame && currentGame.homeTeam && currentGame.awayTeam && isNbaTeam(currentGame.homeTeam) && isNbaTeam(currentGame.awayTeam)) {
          games.push({
            homeTeam: currentGame.homeTeam,
            awayTeam: currentGame.awayTeam,
            tipTime: currentGame.tipTime,
            homeStarters: currentGame.homeStarters || [],
            awayStarters: currentGame.awayStarters || [],
            homeBench: currentGame.homeBench || [],
            awayBench: currentGame.awayBench || [],
            confirmed: currentGame.confirmed || false,
            injuries: currentGame.injuries || [],
          });
        }
        
        currentGame = {
          awayTeam: parseTeamName(awayCandidate),
          homeTeam: parseTeamName(homeCandidate),
          homeStarters: [],
          awayStarters: [],
          homeBench: [],
          awayBench: [],
          injuries: [],
          confirmed: false,
        };
        currentSection = 'away';
        isStartersSection = true;
        continue;
      }
    }
    
    // Look for section headers
    if (line.toLowerCase().includes('starters') || line.toLowerCase().includes('starting')) {
      isStartersSection = true;
      continue;
    }
    if (line.toLowerCase().includes('bench') || line.toLowerCase().includes('reserves')) {
      isStartersSection = false;
      continue;
    }
    
    // Look for team name to switch sections
    if (currentGame) {
      if (line.toLowerCase().includes(currentGame.homeTeam?.toLowerCase().split(' ').pop() || '')) {
        currentSection = 'home';
        continue;
      }
    }
    
    // Parse player lines - look for position indicators (PG, SG, SF, PF, C)
    const playerPattern = /([A-Za-z\.\'\-\s]+?)(?:\s*\(([A-Z]{1,2})\))?(?:\s*-\s*(.+))?$/;
    const positionPattern = /\b(PG|SG|SF|PF|C|G|F)\b/i;
    
    if (currentGame && currentSection) {
      // Check if this looks like a player line
      const posMatch = line.match(positionPattern);
      if (posMatch || line.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+/)) {
        const { status, note } = parseInjuryStatus(line);
        
        // Extract player name (remove position and status indicators)
        let playerName = line
          .replace(/\([^)]+\)/g, '')
          .replace(/\b(PG|SG|SF|PF|C|G|F)\b/gi, '')
          .replace(/\s*(OUT|GTD|Q|D|P)\s*/gi, '')
          .trim();
        
        // Clean up the name
        playerName = playerName.split('-')[0].trim();
        
        if (playerName.length > 2 && !playerName.match(/^\d/)) {
          const player: PlayerStatus = {
            name: playerName,
            position: posMatch?.[1]?.toUpperCase() || '',
            status,
            injuryNote: note || undefined,
          };
          
          if (status === 'OUT' || status === 'GTD' || status === 'QUESTIONABLE' || status === 'DOUBTFUL') {
            currentGame.injuries = currentGame.injuries || [];
            currentGame.injuries.push(player);
          }
          
          if (isStartersSection) {
            if (currentSection === 'home') {
              currentGame.homeStarters = currentGame.homeStarters || [];
              if (currentGame.homeStarters.length < 5) {
                currentGame.homeStarters.push(player);
              }
            } else {
              currentGame.awayStarters = currentGame.awayStarters || [];
              if (currentGame.awayStarters.length < 5) {
                currentGame.awayStarters.push(player);
              }
            }
          } else {
            if (currentSection === 'home') {
              currentGame.homeBench = currentGame.homeBench || [];
              currentGame.homeBench.push(player);
            } else {
              currentGame.awayBench = currentGame.awayBench || [];
              currentGame.awayBench.push(player);
            }
          }
        }
      }
    }
    
    // Check for confirmed status
    if (line.toLowerCase().includes('confirmed') || line.toLowerCase().includes('official')) {
      if (currentGame) {
        currentGame.confirmed = true;
      }
    }
  }
  
  // Don't forget the last game
  if (currentGame && currentGame.homeTeam && currentGame.awayTeam) {
    games.push({
      homeTeam: currentGame.homeTeam,
      awayTeam: currentGame.awayTeam,
      tipTime: currentGame.tipTime,
      homeStarters: currentGame.homeStarters || [],
      awayStarters: currentGame.awayStarters || [],
      homeBench: currentGame.homeBench || [],
      awayBench: currentGame.awayBench || [],
      confirmed: currentGame.confirmed || false,
      injuries: currentGame.injuries || [],
    });
  }
  
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

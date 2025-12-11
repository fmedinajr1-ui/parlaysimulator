import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LegResult {
  legIndex: number;
  description: string;
  outcome: 'won' | 'lost' | 'pending' | 'push';
  settlementMethod: string;
  actualValue?: number;
  line?: number;
  score?: { home: number; away: number };
  dataSource?: string;
}

interface GameResult {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'completed' | 'in_progress' | 'scheduled';
  winner?: string;
}

interface SettledParlayDetail {
  id: string;
  outcome: string;
  totalOdds: number;
  legs: LegResult[];
  strategy: string;
}

// Team name aliases for matching
const teamAliases: Record<string, string[]> = {
  'los angeles lakers': ['lakers', 'la lakers', 'los angeles lakers'],
  'golden state warriors': ['warriors', 'golden state', 'gsw'],
  'boston celtics': ['celtics', 'boston'],
  'miami heat': ['heat', 'miami'],
  'phoenix suns': ['suns', 'phoenix'],
  'milwaukee bucks': ['bucks', 'milwaukee'],
  'denver nuggets': ['nuggets', 'denver'],
  'philadelphia 76ers': ['76ers', 'sixers', 'philadelphia'],
  'cleveland cavaliers': ['cavaliers', 'cavs', 'cleveland'],
  'dallas mavericks': ['mavericks', 'mavs', 'dallas'],
  'oklahoma city thunder': ['thunder', 'okc', 'oklahoma city'],
  'minnesota timberwolves': ['timberwolves', 'wolves', 'minnesota'],
  'new york knicks': ['knicks', 'new york', 'ny knicks'],
  'sacramento kings': ['kings', 'sacramento'],
  'indiana pacers': ['pacers', 'indiana'],
  'orlando magic': ['magic', 'orlando'],
  'houston rockets': ['rockets', 'houston'],
  'new orleans pelicans': ['pelicans', 'new orleans'],
  'memphis grizzlies': ['grizzlies', 'memphis'],
  'atlanta hawks': ['hawks', 'atlanta'],
  'chicago bulls': ['bulls', 'chicago'],
  'brooklyn nets': ['nets', 'brooklyn'],
  'toronto raptors': ['raptors', 'toronto'],
  'san antonio spurs': ['spurs', 'san antonio'],
  'portland trail blazers': ['trail blazers', 'blazers', 'portland'],
  'utah jazz': ['jazz', 'utah'],
  'detroit pistons': ['pistons', 'detroit'],
  'charlotte hornets': ['hornets', 'charlotte'],
  'washington wizards': ['wizards', 'washington'],
  'la clippers': ['clippers', 'la clippers', 'los angeles clippers'],
};

function normalizeTeamName(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(teamAliases)) {
    if (aliases.some(alias => lower.includes(alias))) {
      return canonical;
    }
  }
  return lower;
}

// Clean description by removing hit rate info, confidence percentages, etc.
function cleanDescription(desc: string): string {
  return desc
    .replace(/\s*\([^)]*hit rate[^)]*\)/gi, '')
    .replace(/\s*\([^)]*confidence[^)]*\)/gi, '')
    .replace(/\s*\(\d+%\s*-\s*\d+\/\d+\)/gi, '') // Remove (100% - 5/5) patterns
    .replace(/\s*\(\d+%[^)]*\)/gi, '') // Remove percentage patterns
    .trim();
}

function parsePlayerProp(description: string): { playerName: string; side: string; line: number; propType: string } | null {
  const cleaned = cleanDescription(description);
  
  // Multiple patterns to match various formats
  const patterns = [
    // "Player Name Over/Under X.X points"
    /(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(pts|points|reb|rebounds|ast|assists|threes|3pt|blocks|steals|stl|blk)/i,
    // "Player Name Over/Under X.X player_points"
    /(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+player_(pts|points|reb|rebounds|ast|assists|threes|blocks|steals)/i,
    // Handle variations with prop type before line
    /(.+?)\s+(pts|points|reb|rebounds|ast|assists)\s+(Over|Under)\s+(\d+\.?\d*)/i,
  ];
  
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      // Handle different match group positions based on pattern
      if (pattern.source.includes('player_')) {
        return {
          playerName: match[1].trim(),
          side: match[2].toLowerCase(),
          line: parseFloat(match[3]),
          propType: normalizePropType(match[4])
        };
      } else if (match[3] && (match[3].toLowerCase() === 'over' || match[3].toLowerCase() === 'under')) {
        // Third pattern where side is in position 3
        return {
          playerName: match[1].trim(),
          side: match[3].toLowerCase(),
          line: parseFloat(match[4]),
          propType: normalizePropType(match[2])
        };
      } else {
        return {
          playerName: match[1].trim(),
          side: match[2].toLowerCase(),
          line: parseFloat(match[3]),
          propType: normalizePropType(match[4])
        };
      }
    }
  }
  
  return null;
}

function normalizePropType(prop: string): string {
  const lower = prop.toLowerCase();
  if (lower === 'pts' || lower === 'points') return 'points';
  if (lower === 'reb' || lower === 'rebounds') return 'rebounds';
  if (lower === 'ast' || lower === 'assists') return 'assists';
  if (lower === 'threes' || lower === '3pt') return 'threes_made';
  if (lower === 'blocks' || lower === 'blk') return 'blocks';
  if (lower === 'steals' || lower === 'stl') return 'steals';
  return lower;
}

function parseMoneyline(description: string): { team: string } | null {
  const cleaned = cleanDescription(description);
  // Match: "Team ML" or "Team to win" or "Team +150"
  const match = cleaned.match(/(.+?)\s+(ML|moneyline|to win)/i);
  if (match) {
    return { team: match[1].trim() };
  }
  // Also check for team name followed by American odds
  const oddsMatch = cleaned.match(/^(.+?)\s+([+-]\d+)$/);
  if (oddsMatch) {
    return { team: oddsMatch[1].trim() };
  }
  return null;
}

function parseSpread(description: string): { team: string; spread: number } | null {
  const cleaned = cleanDescription(description);
  // Match: "Team +5.5" or "Team -3.5"
  const match = cleaned.match(/(.+?)\s+([+-]\d+\.?\d*)\s*(spread)?/i);
  if (match && !cleaned.toLowerCase().includes('over') && !cleaned.toLowerCase().includes('under')) {
    return { team: match[1].trim(), spread: parseFloat(match[2]) };
  }
  return null;
}

function parseTotal(description: string): { side: string; total: number } | null {
  const cleaned = cleanDescription(description);
  // Match: "Over/Under X.X total" or "O/U X.X"
  const match = cleaned.match(/(over|under)\s+(\d+\.?\d*)\s*(total|pts)?/i);
  if (match && !cleaned.toLowerCase().includes('points') && !cleaned.toLowerCase().includes('rebounds')) {
    return { side: match[1].toLowerCase(), total: parseFloat(match[2]) };
  }
  return null;
}

async function fetchGameScores(supabase: any, sport: string, legDescriptions: string[]): Promise<GameResult[]> {
  try {
    console.log(`📡 Fetching game scores for ${sport}...`);
    const { data, error } = await supabase.functions.invoke('fetch-game-scores', {
      body: { sport, legDescriptions }
    });
    if (error) throw error;
    console.log(`✅ Got ${data?.games?.length || 0} games from fetch-game-scores`);
    return data?.games || [];
  } catch (e) {
    console.error('Error fetching game scores:', e);
    return [];
  }
}

async function fetchPlayerStats(supabase: any, playerName: string, gameDate: string): Promise<any | null> {
  // Extract last name for fuzzy matching
  const nameParts = playerName.split(' ');
  const lastName = nameParts[nameParts.length - 1];
  const firstName = nameParts[0];
  
  console.log(`🔍 Searching stats for ${playerName} on ${gameDate}...`);
  
  // Try nba_player_game_logs first with various date formats
  const { data: logs, error } = await supabase
    .from('nba_player_game_logs')
    .select('*')
    .ilike('player_name', `%${lastName}%`)
    .eq('game_date', gameDate)
    .limit(5);
  
  if (logs && logs.length > 0) {
    // Find best match by first name
    const bestMatch = logs.find((l: any) => 
      l.player_name.toLowerCase().includes(firstName.toLowerCase())
    ) || logs[0];
    console.log(`✅ Found stats in game_logs: ${bestMatch.player_name} - ${bestMatch.points}pts, ${bestMatch.rebounds}reb, ${bestMatch.assists}ast`);
    return bestMatch;
  }
  
  // Try player_stats_cache as fallback
  const { data: cache } = await supabase
    .from('player_stats_cache')
    .select('*')
    .ilike('player_name', `%${lastName}%`)
    .eq('game_date', gameDate)
    .limit(5);
  
  if (cache && cache.length > 0) {
    const bestMatch = cache.find((c: any) => 
      c.player_name.toLowerCase().includes(firstName.toLowerCase())
    ) || cache[0];
    console.log(`✅ Found stats in cache: ${bestMatch.player_name}`);
    return bestMatch;
  }
  
  console.log(`⚠️ No stats found for ${playerName} on ${gameDate}`);
  return null;
}

async function evaluateLeg(supabase: any, leg: any, games: GameResult[], gameDates: string[]): Promise<LegResult> {
  const description = leg.description || '';
  const legIndex = leg.legIndex || 0;
  
  console.log(`📋 Evaluating leg ${legIndex}: ${description.substring(0, 50)}...`);
  
  // Check if it's a player prop
  const propData = parsePlayerProp(description);
  if (propData) {
    console.log(`🎯 Player prop detected: ${propData.playerName} ${propData.side} ${propData.line} ${propData.propType}`);
    
    // Try each game date
    for (const gameDate of gameDates) {
      const stats = await fetchPlayerStats(supabase, propData.playerName, gameDate);
      if (stats) {
        const actualValue = stats[propData.propType] || 0;
        const won = propData.side === 'over' ? actualValue > propData.line : actualValue < propData.line;
        const push = actualValue === propData.line;
        
        console.log(`📊 Result: ${actualValue} ${propData.side === 'over' ? '>' : '<'} ${propData.line} = ${won ? 'WON' : push ? 'PUSH' : 'LOST'}`);
        
        return {
          legIndex,
          description,
          outcome: push ? 'push' : won ? 'won' : 'lost',
          settlementMethod: 'player_stats',
          actualValue,
          line: propData.line,
          dataSource: `game_logs_${gameDate}`
        };
      }
    }
    
    return { legIndex, description, outcome: 'pending', settlementMethod: 'player_prop_no_data', dataSource: 'none' };
  }
  
  // Check if it's a moneyline bet
  const mlData = parseMoneyline(description);
  if (mlData) {
    const teamNorm = normalizeTeamName(mlData.team);
    const game = games.find(g => 
      normalizeTeamName(g.homeTeam) === teamNorm || 
      normalizeTeamName(g.awayTeam) === teamNorm
    );
    
    if (!game || game.status !== 'completed') {
      return { legIndex, description, outcome: 'pending', settlementMethod: 'moneyline_pending' };
    }
    
    const teamWon = normalizeTeamName(game.winner || '') === teamNorm ||
      (normalizeTeamName(game.homeTeam) === teamNorm && game.homeScore > game.awayScore) ||
      (normalizeTeamName(game.awayTeam) === teamNorm && game.awayScore > game.homeScore);
    
    return {
      legIndex,
      description,
      outcome: teamWon ? 'won' : 'lost',
      settlementMethod: 'game_score',
      score: { home: game.homeScore, away: game.awayScore },
      dataSource: 'espn_scores'
    };
  }
  
  // Check if it's a spread bet
  const spreadData = parseSpread(description);
  if (spreadData) {
    const teamNorm = normalizeTeamName(spreadData.team);
    const game = games.find(g => 
      normalizeTeamName(g.homeTeam) === teamNorm || 
      normalizeTeamName(g.awayTeam) === teamNorm
    );
    
    if (!game || game.status !== 'completed') {
      return { legIndex, description, outcome: 'pending', settlementMethod: 'spread_pending' };
    }
    
    const isHome = normalizeTeamName(game.homeTeam) === teamNorm;
    const teamScore = isHome ? game.homeScore : game.awayScore;
    const oppScore = isHome ? game.awayScore : game.homeScore;
    const adjustedScore = teamScore + spreadData.spread;
    
    const covered = adjustedScore > oppScore;
    const push = adjustedScore === oppScore;
    
    return {
      legIndex,
      description,
      outcome: push ? 'push' : covered ? 'won' : 'lost',
      settlementMethod: 'spread_calculation',
      score: { home: game.homeScore, away: game.awayScore },
      dataSource: 'espn_scores'
    };
  }
  
  // Check if it's a total bet
  const totalData = parseTotal(description);
  if (totalData) {
    // Find any matching game from the description
    const game = games.find(g => g.status === 'completed');
    
    if (!game) {
      return { legIndex, description, outcome: 'pending', settlementMethod: 'total_pending' };
    }
    
    const actualTotal = game.homeScore + game.awayScore;
    const won = totalData.side === 'over' ? actualTotal > totalData.total : actualTotal < totalData.total;
    const push = actualTotal === totalData.total;
    
    return {
      legIndex,
      description,
      outcome: push ? 'push' : won ? 'won' : 'lost',
      settlementMethod: 'total_calculation',
      actualValue: actualTotal,
      line: totalData.total,
      dataSource: 'espn_scores'
    };
  }
  
  // Fallback: check if description contains team-like info for upset/fatigue bets
  const teamMatch = description.match(/(\w+(?:\s+\w+)*)\s+(ML|moneyline|upset|fatigue|edge)/i);
  if (teamMatch) {
    const teamNorm = normalizeTeamName(teamMatch[1]);
    const game = games.find(g => 
      normalizeTeamName(g.homeTeam) === teamNorm || 
      normalizeTeamName(g.awayTeam) === teamNorm
    );
    
    if (game && game.status === 'completed') {
      const isHome = normalizeTeamName(game.homeTeam) === teamNorm;
      const teamWon = isHome ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
      
      return {
        legIndex,
        description,
        outcome: teamWon ? 'won' : 'lost',
        settlementMethod: 'team_outcome',
        score: { home: game.homeScore, away: game.awayScore },
        dataSource: 'espn_scores'
      };
    }
  }
  
  return { legIndex, description, outcome: 'pending', settlementMethod: 'unable_to_parse', dataSource: 'none' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Parse request body for force mode
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // No body or invalid JSON, use defaults
    }
    
    console.log(`🎰 Starting AI Parlay Auto-Settlement... (force=${force})`);
    
    // Build query - skip 4-hour cutoff if force mode
    let query = supabase
      .from('ai_generated_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .limit(100);
    
    if (!force) {
      // Only apply 4-hour cutoff if not forcing
      const cutoffTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      query = query.lt('created_at', cutoffTime);
    }
    
    const { data: pendingParlays, error: fetchError } = await query;

    if (fetchError) throw fetchError;

    console.log(`📊 Found ${pendingParlays?.length || 0} pending parlays to settle (force=${force})`);

    if (!pendingParlays || pendingParlays.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: force ? 'No pending parlays to settle' : 'No parlays old enough to settle (4hr cutoff)',
        processed: 0,
        settled: 0,
        settledDetails: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const results = {
      processed: 0,
      settled: 0,
      won: 0,
      lost: 0,
      stillPending: 0,
      errors: 0,
      learningTriggered: false,
      settledDetails: [] as SettledParlayDetail[]
    };

    // Group parlays by sport for efficient score fetching
    const parlaysBySport: Record<string, typeof pendingParlays> = {};
    for (const parlay of pendingParlays) {
      const sport = parlay.sport || 'basketball_nba';
      if (!parlaysBySport[sport]) parlaysBySport[sport] = [];
      parlaysBySport[sport].push(parlay);
    }

    // Calculate multiple game dates to check
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('T')[0];
    const gameDates = [today, yesterday, twoDaysAgo];

    // Process each sport group
    for (const [sport, sportParlays] of Object.entries(parlaysBySport)) {
      console.log(`\n🏀 Processing ${sportParlays.length} parlays for ${sport}...`);
      
      // Collect all leg descriptions for batch score fetching
      const allDescriptions: string[] = [];
      for (const parlay of sportParlays) {
        const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
        legs.forEach((leg: any) => {
          if (leg.description) allDescriptions.push(leg.description);
        });
      }

      // Fetch game scores for this sport
      const games = await fetchGameScores(supabase, sport, allDescriptions);
      console.log(`📺 Fetched ${games.length} completed games for ${sport}`);

      // Process each parlay
      for (const parlay of sportParlays) {
        results.processed++;
        
        try {
          const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
          const legResults: LegResult[] = [];
          
          console.log(`\n🎯 Processing parlay ${parlay.id.substring(0, 8)}... (${legs.length} legs)`);
          
          // Evaluate each leg
          for (let i = 0; i < legs.length; i++) {
            const leg = { ...legs[i], legIndex: i };
            const result = await evaluateLeg(supabase, leg, games, gameDates);
            legResults.push(result);
          }

          // Determine parlay outcome
          const pendingLegs = legResults.filter(r => r.outcome === 'pending');
          const lostLegs = legResults.filter(r => r.outcome === 'lost');
          const pushLegs = legResults.filter(r => r.outcome === 'push');
          const wonLegs = legResults.filter(r => r.outcome === 'won');
          
          console.log(`📊 Leg summary: ${wonLegs.length}W / ${lostLegs.length}L / ${pushLegs.length}P / ${pendingLegs.length} pending`);
          
          let parlayOutcome: 'won' | 'lost' | 'pending' | 'push' = 'pending';
          
          if (lostLegs.length > 0) {
            // Any lost leg = parlay lost
            parlayOutcome = 'lost';
          } else if (pendingLegs.length === 0) {
            // All legs resolved, no losses
            if (pushLegs.length === legResults.length) {
              parlayOutcome = 'push';
            } else {
              parlayOutcome = 'won';
            }
          }

          console.log(`🎰 Parlay outcome: ${parlayOutcome.toUpperCase()}`);

          // Only update if we have a final outcome
          if (parlayOutcome !== 'pending') {
            const settlementData = {
              outcome: parlayOutcome,
              settled_at: new Date().toISOString(),
              ai_reasoning: JSON.stringify({
                settlement_type: 'auto_settle',
                force_mode: force,
                leg_results: legResults,
                settlement_time: new Date().toISOString(),
                games_used: games.length,
                dates_checked: gameDates
              })
            };

            const { error: updateError } = await supabase
              .from('ai_generated_parlays')
              .update(settlementData)
              .eq('id', parlay.id);

            if (updateError) {
              console.error(`Error updating parlay ${parlay.id}:`, updateError);
              results.errors++;
            } else {
              results.settled++;
              if (parlayOutcome === 'won') results.won++;
              if (parlayOutcome === 'lost') results.lost++;
              
              // Add to settled details for UI display
              results.settledDetails.push({
                id: parlay.id,
                outcome: parlayOutcome,
                totalOdds: parlay.total_odds,
                legs: legResults,
                strategy: parlay.strategy_used
              });
              
              // Trigger learning engine for this settlement
              try {
                await supabase.functions.invoke('ai-learning-engine', {
                  body: {
                    action: 'process_settlement',
                    parlayId: parlay.id,
                    outcome: parlayOutcome,
                    legResults: legResults
                  }
                });
              } catch (learnError) {
                console.error('Learning engine error:', learnError);
              }
            }
          } else {
            results.stillPending++;
          }
        } catch (parlayError) {
          console.error(`Error processing parlay ${parlay.id}:`, parlayError);
          results.errors++;
        }
      }
    }

    // Run full learning cycle if we settled any parlays
    if (results.settled > 0) {
      try {
        await supabase.functions.invoke('ai-learning-engine', {
          body: { action: 'full_learning_cycle' }
        });
        results.learningTriggered = true;
        console.log('🧠 Learning cycle triggered');
      } catch (learnError) {
        console.error('Full learning cycle error:', learnError);
      }
    }

    const duration = Date.now() - startTime;

    // Log to cron_job_history
    await supabase.from('cron_job_history').insert({
      job_name: 'auto-settle-ai-parlays',
      status: results.errors > 0 ? 'completed_with_errors' : 'completed',
      duration_ms: duration,
      result: {
        ...results,
        force_mode: force,
        settledDetails: results.settledDetails.slice(0, 10) // Limit stored details
      }
    });

    console.log(`\n✅ Settlement complete: ${results.settled} settled, ${results.won}W/${results.lost}L, ${results.stillPending} still pending`);

    return new Response(JSON.stringify({
      success: true,
      ...results,
      duration_ms: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Settlement error:', error);
    
    await supabase.from('cron_job_history').insert({
      job_name: 'auto-settle-ai-parlays',
      status: 'failed',
      duration_ms: Date.now() - startTime,
      error_message: errorMessage
    });

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

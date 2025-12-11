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
}

interface GameResult {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'completed' | 'in_progress' | 'scheduled';
  winner?: string;
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

function parsePlayerProp(description: string): { playerName: string; side: string; line: number; propType: string } | null {
  // Match: "Player Name Over/Under X.X points/rebounds/assists/threes/blocks/steals"
  const match = description.match(/(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(pts|points|reb|rebounds|ast|assists|threes|3pt|blocks|steals|stl|blk)/i);
  if (!match) return null;
  
  return {
    playerName: match[1].trim(),
    side: match[2].toLowerCase(),
    line: parseFloat(match[3]),
    propType: normalizePropType(match[4])
  };
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
  // Match: "Team ML" or "Team to win" or "Team +150"
  const match = description.match(/(.+?)\s+(ML|moneyline|to win)/i);
  if (match) {
    return { team: match[1].trim() };
  }
  // Also check for team name followed by American odds
  const oddsMatch = description.match(/^(.+?)\s+([+-]\d+)$/);
  if (oddsMatch) {
    return { team: oddsMatch[1].trim() };
  }
  return null;
}

function parseSpread(description: string): { team: string; spread: number } | null {
  // Match: "Team +5.5" or "Team -3.5"
  const match = description.match(/(.+?)\s+([+-]\d+\.?\d*)\s*(spread)?/i);
  if (match && !description.toLowerCase().includes('over') && !description.toLowerCase().includes('under')) {
    return { team: match[1].trim(), spread: parseFloat(match[2]) };
  }
  return null;
}

function parseTotal(description: string): { side: string; total: number } | null {
  // Match: "Over/Under X.X total" or "O/U X.X"
  const match = description.match(/(over|under)\s+(\d+\.?\d*)\s*(total|pts)?/i);
  if (match && !description.toLowerCase().includes('points') && !description.toLowerCase().includes('rebounds')) {
    return { side: match[1].toLowerCase(), total: parseFloat(match[2]) };
  }
  return null;
}

async function fetchGameScores(supabase: any, sport: string, legDescriptions: string[]): Promise<GameResult[]> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-game-scores', {
      body: { sport, legDescriptions }
    });
    if (error) throw error;
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
  
  // Try nba_player_game_logs first
  const { data: logs, error } = await supabase
    .from('nba_player_game_logs')
    .select('*')
    .ilike('player_name', `%${lastName}%`)
    .eq('game_date', gameDate)
    .limit(1);
  
  if (logs && logs.length > 0) {
    return logs[0];
  }
  
  // Try player_stats_cache as fallback
  const { data: cache } = await supabase
    .from('player_stats_cache')
    .select('*')
    .ilike('player_name', `%${lastName}%`)
    .eq('game_date', gameDate)
    .limit(1);
  
  if (cache && cache.length > 0) {
    return cache[0];
  }
  
  return null;
}

async function evaluateLeg(supabase: any, leg: any, games: GameResult[], gameDate: string): Promise<LegResult> {
  const description = leg.description || '';
  const legIndex = leg.legIndex || 0;
  
  // Check if it's a player prop
  const propData = parsePlayerProp(description);
  if (propData) {
    const stats = await fetchPlayerStats(supabase, propData.playerName, gameDate);
    if (!stats) {
      return { legIndex, description, outcome: 'pending', settlementMethod: 'player_prop_pending' };
    }
    
    const actualValue = stats[propData.propType] || 0;
    const won = propData.side === 'over' ? actualValue > propData.line : actualValue < propData.line;
    const push = actualValue === propData.line;
    
    return {
      legIndex,
      description,
      outcome: push ? 'push' : won ? 'won' : 'lost',
      settlementMethod: 'player_stats',
      actualValue,
      line: propData.line
    };
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
      score: { home: game.homeScore, away: game.awayScore }
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
      score: { home: game.homeScore, away: game.awayScore }
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
      line: totalData.total
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
        score: { home: game.homeScore, away: game.awayScore }
      };
    }
  }
  
  return { legIndex, description, outcome: 'pending', settlementMethod: 'unable_to_parse' };
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
    console.log('🎰 Starting AI Parlay Auto-Settlement...');
    
    // Fetch pending AI parlays that are at least 4 hours old
    const cutoffTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('ai_generated_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .lt('created_at', cutoffTime)
      .limit(100);

    if (fetchError) throw fetchError;

    console.log(`📊 Found ${pendingParlays?.length || 0} pending parlays to settle`);

    if (!pendingParlays || pendingParlays.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending parlays to settle',
        processed: 0,
        settled: 0
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
      learningTriggered: false
    };

    // Group parlays by sport for efficient score fetching
    const parlaysBySport: Record<string, typeof pendingParlays> = {};
    for (const parlay of pendingParlays) {
      const sport = parlay.sport || 'basketball_nba';
      if (!parlaysBySport[sport]) parlaysBySport[sport] = [];
      parlaysBySport[sport].push(parlay);
    }

    // Process each sport group
    for (const [sport, sportParlays] of Object.entries(parlaysBySport)) {
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
      console.log(`🏀 Fetched ${games.length} games for ${sport}`);

      // Calculate game date (yesterday and today)
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Process each parlay
      for (const parlay of sportParlays) {
        results.processed++;
        
        try {
          const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
          const legResults: LegResult[] = [];
          
          // Evaluate each leg
          for (let i = 0; i < legs.length; i++) {
            const leg = { ...legs[i], legIndex: i };
            const result = await evaluateLeg(supabase, leg, games, today);
            
            // If still pending, try yesterday
            if (result.outcome === 'pending') {
              const yesterdayResult = await evaluateLeg(supabase, leg, games, yesterday);
              if (yesterdayResult.outcome !== 'pending') {
                legResults.push(yesterdayResult);
                continue;
              }
            }
            
            legResults.push(result);
          }

          // Determine parlay outcome
          const pendingLegs = legResults.filter(r => r.outcome === 'pending');
          const lostLegs = legResults.filter(r => r.outcome === 'lost');
          const pushLegs = legResults.filter(r => r.outcome === 'push');
          
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

          // Only update if we have a final outcome
          if (parlayOutcome !== 'pending') {
            const settlementData = {
              outcome: parlayOutcome,
              settled_at: new Date().toISOString(),
              ai_reasoning: JSON.stringify({
                settlement_type: 'auto_settle',
                leg_results: legResults,
                settlement_time: new Date().toISOString(),
                games_used: games.length
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
      result: results
    });

    console.log(`✅ Settlement complete: ${results.settled} settled, ${results.won}W/${results.lost}L`);

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

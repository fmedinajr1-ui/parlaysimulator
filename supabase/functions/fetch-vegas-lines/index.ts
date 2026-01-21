import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Eastern Time helper
function getEasternDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

interface OddsAPIGame {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

// Team name normalization map
const TEAM_NAME_MAP: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'LA Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'LA Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS',
};

function getTeamAbbrev(teamName: string): string {
  return TEAM_NAME_MAP[teamName] || teamName.substring(0, 3).toUpperCase();
}

// Game Script Types
type GameScript = 'COMPETITIVE' | 'SOFT_BLOWOUT' | 'HARD_BLOWOUT' | 'SHOOTOUT' | 'GRIND_OUT';

interface GameScriptPrediction {
  script: GameScript;
  confidence: number;
  shootoutFactor: number;  // 0-1, higher = more points expected
  grindFactor: number;     // 0-1, higher = slower pace expected
  garbageTimeRisk: number; // 0-1, higher = more risk of starters benched
  propImplications: {
    pointsOverBoost: number;      // -5 to +5
    pointsUnderBoost: number;
    reboundsOverBoost: number;
    reboundsUnderBoost: number;
    assistsOverBoost: number;
    assistsUnderBoost: number;
  };
}

function calculateGameScript(spread: number | null, total: number | null): GameScriptPrediction {
  const absSpread = Math.abs(spread || 0);
  const vegasTotal = total || 225;
  
  // Default prediction
  let script: GameScript = 'COMPETITIVE';
  let confidence = 0.5;
  let shootoutFactor = 0.5;
  let grindFactor = 0.5;
  let garbageTimeRisk = 0.15;
  
  // Determine game script based on spread and total
  if (absSpread >= 12) {
    // Hard blowout expected
    script = 'HARD_BLOWOUT';
    confidence = 0.7;
    garbageTimeRisk = 0.75;
    shootoutFactor = 0.3;
    grindFactor = 0.4;
  } else if (absSpread >= 8) {
    // Soft blowout expected
    script = 'SOFT_BLOWOUT';
    confidence = 0.6;
    garbageTimeRisk = 0.45;
    shootoutFactor = 0.4;
    grindFactor = 0.35;
  } else if (vegasTotal >= 235 && absSpread < 6) {
    // Shootout expected
    script = 'SHOOTOUT';
    confidence = 0.65;
    garbageTimeRisk = 0.1;
    shootoutFactor = 0.85;
    grindFactor = 0.1;
  } else if (vegasTotal < 215) {
    // Grind-out expected
    script = 'GRIND_OUT';
    confidence = 0.6;
    garbageTimeRisk = 0.1;
    shootoutFactor = 0.15;
    grindFactor = 0.85;
  } else {
    // Competitive game
    script = 'COMPETITIVE';
    confidence = 0.5;
    garbageTimeRisk = 0.15;
    shootoutFactor = (vegasTotal - 210) / 50; // 210-260 range mapped to 0-1
    grindFactor = 1 - shootoutFactor;
  }
  
  // Calculate prop implications based on game script
  const propImplications = calculatePropImplications(script, shootoutFactor, grindFactor, garbageTimeRisk);
  
  return {
    script,
    confidence,
    shootoutFactor,
    grindFactor,
    garbageTimeRisk,
    propImplications,
  };
}

function calculatePropImplications(
  script: GameScript,
  shootoutFactor: number,
  grindFactor: number,
  garbageTimeRisk: number
): GameScriptPrediction['propImplications'] {
  // Base implications for each script type
  switch (script) {
    case 'SHOOTOUT':
      return {
        pointsOverBoost: 3,
        pointsUnderBoost: -3,
        reboundsOverBoost: 1,       // More shots = more rebounds
        reboundsUnderBoost: -1,
        assistsOverBoost: 2,        // More possessions = more assists
        assistsUnderBoost: -2,
      };
    
    case 'GRIND_OUT':
      return {
        pointsOverBoost: -3,
        pointsUnderBoost: 2,
        reboundsOverBoost: 2,       // Slower pace = more rebounding opportunities
        reboundsUnderBoost: -1,
        assistsOverBoost: -2,       // Fewer possessions = fewer assists
        assistsUnderBoost: 1,
      };
    
    case 'HARD_BLOWOUT':
      return {
        pointsOverBoost: -4,        // Starters sit
        pointsUnderBoost: 3,
        reboundsOverBoost: -2,
        reboundsUnderBoost: 2,
        assistsOverBoost: -3,
        assistsUnderBoost: 2,
      };
    
    case 'SOFT_BLOWOUT':
      return {
        pointsOverBoost: -2,
        pointsUnderBoost: 1,
        reboundsOverBoost: -1,
        reboundsUnderBoost: 1,
        assistsOverBoost: -1,
        assistsUnderBoost: 0,
      };
    
    case 'COMPETITIVE':
    default:
      // Neutral - use shootout/grind factors
      return {
        pointsOverBoost: Math.round((shootoutFactor - 0.5) * 4),
        pointsUnderBoost: Math.round((grindFactor - 0.5) * 2),
        reboundsOverBoost: Math.round((grindFactor - 0.5) * 2),
        reboundsUnderBoost: Math.round((shootoutFactor - 0.5) * 2),
        assistsOverBoost: Math.round((shootoutFactor - 0.5) * 2),
        assistsUnderBoost: Math.round((grindFactor - 0.5) * 2),
      };
  }
}

function calculateBlowoutProbability(spread: number): number {
  const absSpread = Math.abs(spread);
  if (absSpread >= 12) return 0.75;
  if (absSpread >= 10) return 0.65;
  if (absSpread >= 8) return 0.55;
  if (absSpread >= 6) return 0.40;
  if (absSpread >= 4) return 0.25;
  return 0.15;
}

function calculatePaceRating(total: number): string {
  if (total >= 235) return 'HIGH';
  if (total >= 220) return 'MEDIUM';
  return 'LOW';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const oddsApiKey = Deno.env.get('ODDS_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { action } = await req.json().catch(() => ({ action: 'refresh' }));
    const today = getEasternDate();
    
    if (action === 'refresh' || action === 'fetch') {
      console.log('[Vegas Lines] Fetching game lines with game script prediction...');
      
      if (!oddsApiKey) {
        // Fallback: Try to get from unified_props table
        console.log('[Vegas Lines] No ODDS_API_KEY, extracting from unified_props...');
        
        const { data: propsData } = await supabase
          .from('unified_props')
          .select('event_id, home_team, away_team, commence_time')
          .gte('commence_time', `${today}T00:00:00`)
          .lte('commence_time', `${today}T23:59:59`);
        
        if (!propsData || propsData.length === 0) {
          return new Response(JSON.stringify({
            success: false,
            error: 'No games found for today',
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        // Extract unique games
        const gamesMap = new Map<string, { home: string; away: string; commence: string }>();
        for (const prop of propsData) {
          if (prop.event_id && !gamesMap.has(prop.event_id)) {
            gamesMap.set(prop.event_id, {
              home: prop.home_team,
              away: prop.away_team,
              commence: prop.commence_time,
            });
          }
        }
        
        // Create placeholder game environments (without Vegas data)
        const records = [];
        for (const [gameId, game] of gamesMap) {
          const gameScript = calculateGameScript(null, null);
          
          records.push({
            game_id: gameId,
            game_date: today,
            home_team: game.home,
            away_team: game.away,
            home_team_abbrev: getTeamAbbrev(game.home),
            away_team_abbrev: getTeamAbbrev(game.away),
            vegas_total: null,
            vegas_spread: null,
            home_implied_total: null,
            away_implied_total: null,
            pace_rating: 'MEDIUM',
            blowout_probability: 0.15,
            game_script: gameScript.script,
            game_script_confidence: gameScript.confidence,
            shootout_factor: gameScript.shootoutFactor,
            grind_factor: gameScript.grindFactor,
            garbage_time_risk: gameScript.garbageTimeRisk,
            commence_time: game.commence,
            updated_at: new Date().toISOString(),
          });
        }
        
        if (records.length > 0) {
          await supabase
            .from('game_environment')
            .upsert(records, { onConflict: 'game_id' });
        }
        
        return new Response(JSON.stringify({
          success: true,
          games: records.length,
          source: 'unified_props_fallback',
          message: 'Created game entries without Vegas data (no API key)',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Fetch from Odds API
      const oddsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${oddsApiKey}&regions=us&markets=spreads,totals&oddsFormat=american`;
      
      const response = await fetch(oddsUrl);
      if (!response.ok) {
        throw new Error(`Odds API error: ${response.status}`);
      }
      
      const games: OddsAPIGame[] = await response.json();
      console.log(`[Vegas Lines] Fetched ${games.length} games from Odds API`);
      
      // Filter to today's games
      const todayGames = games.filter(game => {
        const gameDate = new Date(game.commence_time).toISOString().split('T')[0];
        return gameDate === today;
      });
      
      console.log(`[Vegas Lines] ${todayGames.length} games for today`);
      
      const records = [];
      
      for (const game of todayGames) {
        // Get consensus line from first available bookmaker
        let vegasTotal: number | null = null;
        let vegasSpread: number | null = null;
        let homeMoneyline: number | null = null;
        let awayMoneyline: number | null = null;
        
        for (const book of game.bookmakers) {
          for (const market of book.markets) {
            if (market.key === 'totals' && !vegasTotal) {
              const overOutcome = market.outcomes.find(o => o.name === 'Over');
              if (overOutcome?.point) {
                vegasTotal = overOutcome.point;
              }
            }
            if (market.key === 'spreads' && !vegasSpread) {
              const homeOutcome = market.outcomes.find(o => o.name === game.home_team);
              if (homeOutcome?.point !== undefined) {
                vegasSpread = homeOutcome.point;
              }
            }
          }
          if (vegasTotal && vegasSpread) break;
        }
        
        // Calculate implied totals
        let homeImplied: number | null = null;
        let awayImplied: number | null = null;
        
        if (vegasTotal && vegasSpread !== null) {
          // Home implied = (Total - Spread) / 2 if home is favorite (negative spread)
          // Away implied = (Total + Spread) / 2
          homeImplied = (vegasTotal - vegasSpread) / 2;
          awayImplied = (vegasTotal + vegasSpread) / 2;
        }
        
        // Calculate game script prediction
        const gameScript = calculateGameScript(vegasSpread, vegasTotal);
        
        records.push({
          game_id: game.id,
          game_date: today,
          home_team: game.home_team,
          away_team: game.away_team,
          home_team_abbrev: getTeamAbbrev(game.home_team),
          away_team_abbrev: getTeamAbbrev(game.away_team),
          vegas_total: vegasTotal,
          vegas_spread: vegasSpread,
          home_implied_total: homeImplied,
          away_implied_total: awayImplied,
          pace_rating: vegasTotal ? calculatePaceRating(vegasTotal) : 'MEDIUM',
          blowout_probability: vegasSpread ? calculateBlowoutProbability(vegasSpread) : 0.15,
          game_script: gameScript.script,
          game_script_confidence: gameScript.confidence,
          shootout_factor: gameScript.shootoutFactor,
          grind_factor: gameScript.grindFactor,
          garbage_time_risk: gameScript.garbageTimeRisk,
          moneyline_home: homeMoneyline,
          moneyline_away: awayMoneyline,
          commence_time: game.commence_time,
          updated_at: new Date().toISOString(),
        });
      }
      
      // Upsert to database
      if (records.length > 0) {
        const { error: upsertError } = await supabase
          .from('game_environment')
          .upsert(records, { onConflict: 'game_id' });
        
        if (upsertError) {
          throw upsertError;
        }
      }
      
      console.log(`[Vegas Lines] Saved ${records.length} game environments with game scripts`);
      
      return new Response(JSON.stringify({
        success: true,
        games: records.length,
        source: 'odds_api',
        data: records.map(r => ({
          matchup: `${r.away_team_abbrev} @ ${r.home_team_abbrev}`,
          total: r.vegas_total,
          spread: r.vegas_spread,
          gameScript: r.game_script,
          scriptConfidence: r.game_script_confidence,
          shootoutFactor: r.shootout_factor,
          grindFactor: r.grind_factor,
          garbageTimeRisk: r.garbage_time_risk,
          blowoutRisk: r.blowout_probability,
          pace: r.pace_rating,
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_today - Get today's game environments
    if (action === 'get_today') {
      const { data } = await supabase
        .from('game_environment')
        .select('*')
        .eq('game_date', today)
        .order('commence_time', { ascending: true });
      
      return new Response(JSON.stringify({
        success: true,
        games: data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_game - Get specific game environment
    if (action === 'get_game') {
      const { gameId, teams } = await req.json();
      
      let query = supabase
        .from('game_environment')
        .select('*')
        .eq('game_date', today);
      
      if (gameId) {
        query = query.eq('game_id', gameId);
      } else if (teams) {
        query = query.or(`home_team.ilike.%${teams}%,away_team.ilike.%${teams}%`);
      }
      
      const { data } = await query.maybeSingle();
      
      return new Response(JSON.stringify({
        success: true,
        game: data,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_script_implications - Get prop implications for a game script
    if (action === 'get_script_implications') {
      const { spread, total } = await req.json();
      const gameScript = calculateGameScript(spread, total);
      
      return new Response(JSON.stringify({
        success: true,
        gameScript,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Use action: refresh, get_today, get_game, or get_script_implications' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[Vegas Lines] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

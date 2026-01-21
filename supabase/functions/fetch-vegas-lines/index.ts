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
      console.log('[Vegas Lines] Fetching game lines...');
      
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
      
      console.log(`[Vegas Lines] Saved ${records.length} game environments`);
      
      return new Response(JSON.stringify({
        success: true,
        games: records.length,
        source: 'odds_api',
        data: records.map(r => ({
          matchup: `${r.away_team_abbrev} @ ${r.home_team_abbrev}`,
          total: r.vegas_total,
          spread: r.vegas_spread,
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
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Use action: refresh, get_today, or get_game' 
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// All sports supported by the multi-sport scraper
const ALL_SPORTS = [
  // Basketball
  'basketball_nba',
  'basketball_wnba',
  'basketball_ncaab',
  // Hockey
  'icehockey_nhl',
  // Football
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  // Tennis (major tournaments)
  'tennis_atp_australian_open',
  'tennis_atp_french_open',
  'tennis_atp_us_open',
  'tennis_atp_wimbledon',
  'tennis_wta_australian_open',
  'tennis_wta_french_open',
  'tennis_wta_us_open',
  'tennis_wta_wimbledon',
];

// Player prop markets by sport
const PLAYER_MARKETS: Record<string, string[]> = {
  'basketball_nba': ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_blocks', 'player_steals'],
  'basketball_wnba': ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  'basketball_ncaab': ['player_points', 'player_rebounds', 'player_assists'],
  'icehockey_nhl': ['player_points', 'player_assists', 'player_goals', 'player_shots_on_goal', 'player_saves'],
  'americanfootball_nfl': ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_pass_tds', 'player_receptions'],
  'americanfootball_ncaaf': ['player_pass_yds', 'player_rush_yds', 'player_reception_yds'],
  // Tennis player props
  'tennis_atp_australian_open': ['player_aces', 'player_double_faults', 'player_games'],
  'tennis_atp_french_open': ['player_aces', 'player_double_faults', 'player_games'],
  'tennis_atp_us_open': ['player_aces', 'player_double_faults', 'player_games'],
  'tennis_atp_wimbledon': ['player_aces', 'player_double_faults', 'player_games'],
  'tennis_wta_australian_open': ['player_aces', 'player_double_faults', 'player_games'],
  'tennis_wta_french_open': ['player_aces', 'player_double_faults', 'player_games'],
  'tennis_wta_us_open': ['player_aces', 'player_double_faults', 'player_games'],
  'tennis_wta_wimbledon': ['player_aces', 'player_double_faults', 'player_games'],
};

// Team-level markets (spreads, totals, moneylines)
const TEAM_MARKETS = ['spreads', 'totals', 'h2h'];

// Priority bookmakers
const BOOKMAKERS = ['fanduel', 'draftkings', 'betmgm', 'caesars'];

interface OddsAPIEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface PropOutcome {
  name: string;
  description: string;
  price: number;
  point: number;
}

interface PropMarket {
  key: string;
  outcomes: PropOutcome[];
}

interface Bookmaker {
  key: string;
  title: string;
  markets: PropMarket[];
}

interface UnifiedPropInsert {
  player_name: string;
  prop_type: string;
  current_line: number;
  sport: string;
  event_id: string;
  bookmaker: string;
  game_description: string;
  commence_time: string;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean;
}

interface GameBetInsert {
  game_id: string;
  sport: string;
  bet_type: string;
  home_team: string;
  away_team: string;
  line: number | null;
  home_odds: number | null;
  away_odds: number | null;
  over_odds: number | null;
  under_odds: number | null;
  bookmaker: string;
  commence_time: string;
  is_active: boolean;
}

// Helper to normalize sport key for storage
function normalizeSportKey(sportKey: string): string {
  if (sportKey.startsWith('tennis_atp')) return 'tennis_atp';
  if (sportKey.startsWith('tennis_wta')) return 'tennis_wta';
  if (sportKey === 'icehockey_nhl') return 'hockey_nhl';
  return sportKey;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { 
      sports = ALL_SPORTS, 
      limit_events = 15,  // Increased from 10 for larger prop pool
      include_player_props = true,
      include_team_props = true
    } = body;
    
    console.log('[Multi-Sport Scraper] Starting odds fetch for sports:', sports);
    console.log('[Multi-Sport Scraper] Player props:', include_player_props, 'Team props:', include_team_props);
    
    if (!apiKey) {
      console.error('[Multi-Sport Scraper] THE_ODDS_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Odds API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date();
    const allPlayerProps: UnifiedPropInsert[] = [];
    const allTeamBets: GameBetInsert[] = [];
    let totalApiCalls = 0;
    
    for (const sport of sports) {
      if (!ALL_SPORTS.includes(sport)) {
        console.log(`[Multi-Sport Scraper] Skipping unsupported sport: ${sport}`);
        continue;
      }
      
      console.log(`[Multi-Sport Scraper] Fetching events for ${sport}...`);
      
      // Fetch upcoming events for this sport
      const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${apiKey}&dateFormat=iso`;
      const eventsResponse = await fetch(eventsUrl);
      totalApiCalls++;
      
      if (!eventsResponse.ok) {
        console.error(`[Multi-Sport Scraper] Events fetch failed for ${sport}:`, eventsResponse.status);
        continue;
      }
      
      const events: OddsAPIEvent[] = await eventsResponse.json();
      console.log(`[Multi-Sport Scraper] Found ${events.length} events for ${sport}`);
      
      // Filter to next 72 hours for larger event pool
      const windowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      const relevantEvents = events
        .filter(e => new Date(e.commence_time) < windowEnd && new Date(e.commence_time) > now)
        .slice(0, limit_events);
      
      console.log(`[Multi-Sport Scraper] Processing ${relevantEvents.length} relevant events for ${sport}`);
      
      // ========== PLAYER PROPS ==========
      if (include_player_props) {
        const markets = PLAYER_MARKETS[sport] || [];
        
        for (const event of relevantEvents) {
          for (const market of markets) {
            try {
              const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${market}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(',')}`;
              
              const propsResponse = await fetch(propsUrl);
              totalApiCalls++;
              
              if (!propsResponse.ok) {
                if (propsResponse.status === 404) continue;
                console.error(`[Multi-Sport Scraper] Props fetch failed for ${event.id}/${market}:`, propsResponse.status);
                continue;
              }
              
              const propsData = await propsResponse.json();
              const bookmakers: Bookmaker[] = propsData.bookmakers || [];
              
              for (const bookmaker of bookmakers) {
                for (const propMarket of bookmaker.markets) {
                  if (propMarket.key !== market) continue;
                  
                  const playerMap = new Map<string, { over?: PropOutcome; under?: PropOutcome }>();
                  
                  for (const outcome of propMarket.outcomes) {
                    const playerName = outcome.description || outcome.name;
                    if (!playerName || playerName.length < 3) continue;
                    
                    if (!playerMap.has(playerName)) {
                      playerMap.set(playerName, {});
                    }
                    
                    const playerOutcomes = playerMap.get(playerName)!;
                    if (outcome.name === 'Over') {
                      playerOutcomes.over = outcome;
                    } else if (outcome.name === 'Under') {
                      playerOutcomes.under = outcome;
                    }
                  }
                  
                  for (const [playerName, outcomes] of playerMap) {
                    const line = outcomes.over?.point ?? outcomes.under?.point;
                    if (line === undefined || line === null) continue;
                    
                    allPlayerProps.push({
                      player_name: playerName,
                      prop_type: market,
                      current_line: line,
                      sport: normalizeSportKey(sport),
                      event_id: event.id,
                      bookmaker: bookmaker.key,
                      game_description: `${event.away_team} @ ${event.home_team}`,
                      commence_time: event.commence_time,
                      over_price: outcomes.over?.price ?? null,
                      under_price: outcomes.under?.price ?? null,
                      is_active: true,
                    });
                  }
                }
              }
            } catch (marketError) {
              console.error(`[Multi-Sport Scraper] Error fetching ${market} for ${event.id}:`, marketError);
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // ========== TEAM PROPS (Spreads, Totals, Moneylines) ==========
      if (include_team_props && !sport.startsWith('tennis_')) {
        for (const event of relevantEvents) {
          try {
            const teamUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${TEAM_MARKETS.join(',')}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(',')}`;
            
            const teamResponse = await fetch(teamUrl);
            totalApiCalls++;
            
            if (!teamResponse.ok) {
              if (teamResponse.status === 404) continue;
              console.error(`[Multi-Sport Scraper] Team props fetch failed for ${event.id}:`, teamResponse.status);
              continue;
            }
            
            const teamData = await teamResponse.json();
            const bookmakers: Bookmaker[] = teamData.bookmakers || [];
            
            for (const bookmaker of bookmakers) {
              for (const market of bookmaker.markets) {
                const betType = market.key;
                
                if (betType === 'spreads') {
                  // Spread betting
                  const homeOutcome = market.outcomes.find(o => o.name === event.home_team);
                  const awayOutcome = market.outcomes.find(o => o.name === event.away_team);
                  
                  if (homeOutcome || awayOutcome) {
                    allTeamBets.push({
                      game_id: event.id,
                      sport: normalizeSportKey(sport),
                      bet_type: 'spread',
                      home_team: event.home_team,
                      away_team: event.away_team,
                      line: homeOutcome?.point ?? null,
                      home_odds: homeOutcome?.price ?? null,
                      away_odds: awayOutcome?.price ?? null,
                      over_odds: null,
                      under_odds: null,
                      bookmaker: bookmaker.key,
                      commence_time: event.commence_time,
                      is_active: true,
                    });
                  }
                } else if (betType === 'totals') {
                  // Over/Under totals
                  const overOutcome = market.outcomes.find(o => o.name === 'Over');
                  const underOutcome = market.outcomes.find(o => o.name === 'Under');
                  
                  if (overOutcome || underOutcome) {
                    allTeamBets.push({
                      game_id: event.id,
                      sport: normalizeSportKey(sport),
                      bet_type: 'total',
                      home_team: event.home_team,
                      away_team: event.away_team,
                      line: overOutcome?.point ?? underOutcome?.point ?? null,
                      home_odds: null,
                      away_odds: null,
                      over_odds: overOutcome?.price ?? null,
                      under_odds: underOutcome?.price ?? null,
                      bookmaker: bookmaker.key,
                      commence_time: event.commence_time,
                      is_active: true,
                    });
                  }
                } else if (betType === 'h2h') {
                  // Moneyline
                  const homeOutcome = market.outcomes.find(o => o.name === event.home_team);
                  const awayOutcome = market.outcomes.find(o => o.name === event.away_team);
                  
                  if (homeOutcome || awayOutcome) {
                    allTeamBets.push({
                      game_id: event.id,
                      sport: normalizeSportKey(sport),
                      bet_type: 'h2h',
                      home_team: event.home_team,
                      away_team: event.away_team,
                      line: null,
                      home_odds: homeOutcome?.price ?? null,
                      away_odds: awayOutcome?.price ?? null,
                      over_odds: null,
                      under_odds: null,
                      bookmaker: bookmaker.key,
                      commence_time: event.commence_time,
                      is_active: true,
                    });
                  }
                }
              }
            }
          } catch (teamError) {
            console.error(`[Multi-Sport Scraper] Error fetching team props for ${event.id}:`, teamError);
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    
    console.log(`[Multi-Sport Scraper] Collected ${allPlayerProps.length} player props and ${allTeamBets.length} team bets from ${totalApiCalls} API calls`);
    
    // ========== UPSERT PLAYER PROPS ==========
    if (allPlayerProps.length > 0) {
      const uniqueProps = new Map<string, UnifiedPropInsert>();
      for (const prop of allPlayerProps) {
        const key = `${prop.event_id}_${prop.player_name}_${prop.prop_type}_${prop.bookmaker}`;
        uniqueProps.set(key, prop);
      }
      
      const propsToInsert = Array.from(uniqueProps.values());
      console.log(`[Multi-Sport Scraper] Upserting ${propsToInsert.length} unique player props`);
      
      const CHUNK_SIZE = 100;
      let insertedCount = 0;
      
      for (let i = 0; i < propsToInsert.length; i += CHUNK_SIZE) {
        const chunk = propsToInsert.slice(i, i + CHUNK_SIZE);
        
        const { error: upsertError } = await supabase
          .from('unified_props')
          .upsert(chunk, {
            onConflict: 'event_id,player_name,prop_type,bookmaker',
            ignoreDuplicates: false,
          });
        
        if (upsertError) {
          console.error(`[Multi-Sport Scraper] Player props upsert error:`, upsertError);
        } else {
          insertedCount += chunk.length;
        }
      }
      
      console.log(`[Multi-Sport Scraper] Successfully upserted ${insertedCount} player props`);
    }
    
    // ========== UPSERT TEAM BETS ==========
    if (allTeamBets.length > 0) {
      const uniqueBets = new Map<string, GameBetInsert>();
      for (const bet of allTeamBets) {
        const key = `${bet.game_id}_${bet.bet_type}_${bet.bookmaker}`;
        uniqueBets.set(key, bet);
      }
      
      const betsToInsert = Array.from(uniqueBets.values());
      console.log(`[Multi-Sport Scraper] Upserting ${betsToInsert.length} unique team bets`);
      
      const CHUNK_SIZE = 100;
      let insertedCount = 0;
      
      for (let i = 0; i < betsToInsert.length; i += CHUNK_SIZE) {
        const chunk = betsToInsert.slice(i, i + CHUNK_SIZE);
        
        const { error: upsertError } = await supabase
          .from('game_bets')
          .upsert(chunk, {
            onConflict: 'game_id,bet_type,bookmaker',
            ignoreDuplicates: false,
          });
        
        if (upsertError) {
          console.error(`[Multi-Sport Scraper] Team bets upsert error:`, upsertError);
        } else {
          insertedCount += chunk.length;
        }
      }
      
      console.log(`[Multi-Sport Scraper] Successfully upserted ${insertedCount} team bets`);
    }
    
    // Mark old props as inactive
    const { error: deactivatePropsError } = await supabase
      .from('unified_props')
      .update({ is_active: false })
      .lt('commence_time', now.toISOString());
    
    if (deactivatePropsError) {
      console.error('[Multi-Sport Scraper] Deactivate props error:', deactivatePropsError);
    }
    
    const { error: deactivateBetsError } = await supabase
      .from('game_bets')
      .update({ is_active: false })
      .lt('commence_time', now.toISOString());
    
    if (deactivateBetsError) {
      console.error('[Multi-Sport Scraper] Deactivate bets error:', deactivateBetsError);
    }
    
    // ========== LINE MOVEMENT ALERTS ==========
    try {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now);

      const { data: activePicks } = await supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_line, recommended_side')
        .eq('analysis_date', today)
        .is('outcome', null);

      if (activePicks && activePicks.length > 0) {
        let lineAlerts = 0;
        for (const pick of activePicks) {
          const matchingProp = allPlayerProps.find(p =>
            p.player_name.toLowerCase() === pick.player_name.toLowerCase() &&
            p.prop_type.toLowerCase().includes(pick.prop_type.toLowerCase().replace('_', ''))
          );
          if (!matchingProp || !pick.recommended_line) continue;
          const diff = Math.abs(matchingProp.current_line - pick.recommended_line);
          if (diff >= 1.5) {
            const direction = matchingProp.current_line > pick.recommended_line ? '📈 UP' : '📉 DOWN';
            const alertMsg = `⚡ *Line Movement Alert*\n\n${pick.player_name} ${pick.prop_type}\nBot line: ${pick.recommended_line} → Market: ${matchingProp.current_line}\nMoved ${direction} by ${diff.toFixed(1)} pts\nSide: ${(pick.recommended_side || 'over').toUpperCase()}`;

            // Send via bot-send-telegram
            await supabase.functions.invoke('bot-send-telegram', {
              body: { type: 'strategy_update', data: { strategyName: 'Line Movement', action: alertMsg, reason: `${pick.player_name} ${pick.prop_type} moved ${diff.toFixed(1)}` } },
            });
            lineAlerts++;
          }
        }
        if (lineAlerts > 0) {
          console.log(`[Multi-Sport Scraper] Sent ${lineAlerts} line movement alerts`);
        }
      }
    } catch (lineErr) {
      console.error('[Multi-Sport Scraper] Line movement check error:', lineErr);
    }

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'whale-odds-scraper',
      status: 'completed',
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        playerPropsCollected: allPlayerProps.length,
        teamBetsCollected: allTeamBets.length,
        apiCalls: totalApiCalls,
        sports: sports,
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        playerPropsCollected: allPlayerProps.length,
        teamBetsCollected: allTeamBets.length,
        apiCalls: totalApiCalls,
        sports: sports,
        samplePlayerProps: allPlayerProps.slice(0, 5).map(p => ({
          player: p.player_name,
          market: p.prop_type,
          line: p.current_line,
          sport: p.sport,
          book: p.bookmaker,
        })),
        sampleTeamBets: allTeamBets.slice(0, 5).map(b => ({
          game: `${b.away_team} @ ${b.home_team}`,
          type: b.bet_type,
          line: b.line,
          sport: b.sport,
          book: b.bookmaker,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Multi-Sport Scraper] Fatal error:', errorMessage);
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

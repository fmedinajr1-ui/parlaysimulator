import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ SPORT TIERS ============
// Tier 1: Always fetch (best historical data)
const TIER_1_SPORTS = ['basketball_nba', 'icehockey_nhl'];
// Tier 2: Fetch if games exist (seasonal)
const TIER_2_SPORTS = ['basketball_wnba', 'basketball_ncaab', 'baseball_ncaa', 'tennis_atp', 'tennis_wta', 'tennis_pingpong'];
// Golf: Outright/futures markets (seasonal — only active during tournament weeks)
const GOLF_SPORTS = [
  'golf_masters_tournament_winner',
  'golf_pga_championship_winner',
  'golf_us_open_winner',
  'golf_the_open_championship_winner',
];
// Tier 3: Skip for now (offseason / low volume)
// NFL, NCAAF - not fetched to save API budget

const ALL_ACTIVE_SPORTS = [...TIER_1_SPORTS, ...TIER_2_SPORTS, ...GOLF_SPORTS];

// Batched player prop markets (comma-separated to reduce API calls)
const PLAYER_MARKET_BATCHES: Record<string, string[][]> = {
  'basketball_nba': [
    ['player_points', 'player_rebounds', 'player_assists'],
    ['player_threes', 'player_blocks', 'player_steals'],
    ['player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists', 'player_rebounds_assists'],
  ],
  'basketball_wnba': [
    ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  ],
  'basketball_ncaab': [
    ['player_points', 'player_rebounds', 'player_assists'],
  ],
  'icehockey_nhl': [
    ['player_points', 'player_assists', 'player_goals'],
    ['player_shots_on_goal', 'player_saves'],
  ],
  'baseball_ncaa': [
    ['batter_hits', 'batter_rbis', 'batter_runs_scored', 'batter_total_bases'],
  ],
  // Tennis/Table Tennis: no player prop markets, team (match) markets only
};

const TEAM_MARKETS = ['spreads', 'totals', 'h2h'];
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

function normalizeSportKey(sportKey: string): string {
  if (sportKey.startsWith('golf_')) return 'golf_pga';
  if (sportKey.startsWith('tennis_atp')) return 'tennis_atp';
  if (sportKey.startsWith('tennis_wta')) return 'tennis_wta';
  if (sportKey.startsWith('tennis_pingpong')) return 'tennis_pingpong';
  return sportKey;
}

function isGolfSport(sport: string): boolean {
  return sport.startsWith('golf_');
}

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
      mode = 'full', // 'scout' | 'full' | 'targeted'
      sports = ALL_ACTIVE_SPORTS,
      limit_events = 15,
    } = body;

    console.log(`[Scraper] Mode: ${mode} | Sports: ${sports.join(', ')}`);

    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'THE_ODDS_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const today = getEasternDate();
    const now = new Date();
    let totalApiCalls = 0;

    // ============ BUDGET CHECK ============
    const checkBudget = async (callsNeeded: number): Promise<boolean> => {
      const { data } = await supabase.rpc('increment_api_calls', {
        p_date: today,
        p_count: callsNeeded,
      });
      if (data && data.length > 0 && data[0].is_over_limit) {
        console.log(`[Scraper] BUDGET EXCEEDED: ${data[0].new_total}/${data[0].daily_limit} calls used today`);
        return false;
      }
      return true;
    };

    const trackApiCall = async (count = 1) => {
      totalApiCalls += count;
      // We already pre-checked budget, just track
    };

    // ============ MODE: SCOUT ============
    if (mode === 'scout') {
      // Only fetch events endpoints to see what games exist (~1 call per sport)
      const canProceed = await checkBudget(ALL_ACTIVE_SPORTS.length);
      if (!canProceed) {
        return new Response(JSON.stringify({
          success: false, error: 'Daily API budget exceeded', mode: 'scout',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const scoutResults: Record<string, number> = {};

      for (const sport of ALL_ACTIVE_SPORTS) {
        try {
          const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${apiKey}&dateFormat=iso`;
          const resp = await fetch(eventsUrl);
          await trackApiCall();

          if (resp.ok) {
            const events: OddsAPIEvent[] = await resp.json();
            const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const todayEvents = events.filter(e =>
              new Date(e.commence_time) < windowEnd && new Date(e.commence_time) > now
            );
            scoutResults[sport] = todayEvents.length;
            console.log(`[Scout] ${sport}: ${todayEvents.length} events today`);
          } else {
            scoutResults[sport] = 0;
            console.log(`[Scout] ${sport}: API error ${resp.status}`);
          }
        } catch (e) {
          scoutResults[sport] = 0;
        }
      }

      // Update tracker with last scout time
      await supabase.from('api_budget_tracker').upsert({
        date: today, last_scout: now.toISOString(),
      }, { onConflict: 'date' });

      await supabase.from('cron_job_history').insert({
        job_name: 'whale-odds-scraper',
        status: 'completed',
        started_at: now.toISOString(),
        completed_at: new Date().toISOString(),
        result: { mode: 'scout', scoutResults, apiCalls: totalApiCalls },
      });

      return new Response(JSON.stringify({
        success: true, mode: 'scout', scoutResults, apiCalls: totalApiCalls,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============ MODE: TARGETED ============
    if (mode === 'targeted') {
      // Only fetch odds for players in today's category_sweet_spots with pending outcomes
      const { data: activePicks } = await supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_line, recommended_side, category')
        .eq('analysis_date', today)
        .is('outcome', null);

      if (!activePicks || activePicks.length === 0) {
        console.log('[Targeted] No active picks to refresh');
        return new Response(JSON.stringify({
          success: true, mode: 'targeted', message: 'No active picks', apiCalls: 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      console.log(`[Targeted] Refreshing odds for ${activePicks.length} active picks`);

      // Group picks by sport events we need to fetch
      // First, scout events to get event IDs
      const eventsPerSport: Record<string, OddsAPIEvent[]> = {};
      const estimatedCalls = TIER_1_SPORTS.length + activePicks.length; // rough estimate
      const canProceed = await checkBudget(Math.min(estimatedCalls, 100));
      if (!canProceed) {
        return new Response(JSON.stringify({
          success: false, error: 'Daily API budget exceeded', mode: 'targeted',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      for (const sport of TIER_1_SPORTS) {
        try {
          const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${apiKey}&dateFormat=iso`;
          const resp = await fetch(eventsUrl);
          await trackApiCall();
          if (resp.ok) {
            const events: OddsAPIEvent[] = await resp.json();
            const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            eventsPerSport[sport] = events
              .filter(e => new Date(e.commence_time) < windowEnd && new Date(e.commence_time) > now)
              .slice(0, limit_events);
          }
        } catch (_) { /* skip */ }
      }

      // For each event, fetch batched props and extract only the players we care about
      const allPlayerProps: UnifiedPropInsert[] = [];
      const playerNamesLower = new Set(activePicks.map(p => p.player_name.toLowerCase()));

      for (const [sport, events] of Object.entries(eventsPerSport)) {
        const batches = PLAYER_MARKET_BATCHES[sport] || [];
        for (const event of events) {
          for (const batch of batches) {
            try {
              const marketsParam = batch.join(',');
              const url = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(',')}`;
              const resp = await fetch(url);
              await trackApiCall();
              if (!resp.ok) continue;

              const data = await resp.json();
              for (const bookmaker of (data.bookmakers || []) as Bookmaker[]) {
                for (const market of bookmaker.markets) {
                  const playerMap = new Map<string, { over?: PropOutcome; under?: PropOutcome }>();
                  for (const outcome of market.outcomes) {
                    const name = outcome.description || outcome.name;
                    if (!name || name.length < 3) continue;
                    if (!playerMap.has(name)) playerMap.set(name, {});
                    const po = playerMap.get(name)!;
                    if (outcome.name === 'Over') po.over = outcome;
                    else if (outcome.name === 'Under') po.under = outcome;
                  }
                  for (const [playerName, outcomes] of playerMap) {
                    // Only keep players we care about in targeted mode
                    if (!playerNamesLower.has(playerName.toLowerCase())) continue;
                    const line = outcomes.over?.point ?? outcomes.under?.point;
                    if (line === undefined || line === null) continue;
                    allPlayerProps.push({
                      player_name: playerName,
                      prop_type: market.key,
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
            } catch (_) { /* skip individual market errors */ }
          }
          await new Promise(r => setTimeout(r, 50));
        }
      }

      // Upsert targeted props
      if (allPlayerProps.length > 0) {
        const uniqueProps = new Map<string, UnifiedPropInsert>();
        for (const prop of allPlayerProps) {
          uniqueProps.set(`${prop.event_id}_${prop.player_name}_${prop.prop_type}_${prop.bookmaker}`, prop);
        }
        const propsToInsert = Array.from(uniqueProps.values());
        for (let i = 0; i < propsToInsert.length; i += 100) {
          await supabase.from('unified_props').upsert(propsToInsert.slice(i, i + 100), {
            onConflict: 'event_id,player_name,prop_type,bookmaker',
            ignoreDuplicates: false,
          });
        }
      }

      await supabase.from('api_budget_tracker').upsert({
        date: today, last_targeted: now.toISOString(),
      }, { onConflict: 'date' });

      await supabase.from('cron_job_history').insert({
        job_name: 'whale-odds-scraper',
        status: 'completed',
        started_at: now.toISOString(),
        completed_at: new Date().toISOString(),
        result: { mode: 'targeted', propsRefreshed: allPlayerProps.length, activePicks: activePicks.length, apiCalls: totalApiCalls },
      });

      return new Response(JSON.stringify({
        success: true, mode: 'targeted', propsRefreshed: allPlayerProps.length,
        activePicks: activePicks.length, apiCalls: totalApiCalls,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============ MODE: FULL ============
    // Full scrape - fetch all props for active sports with games
    const activeSports = sports.filter((s: string) => ALL_ACTIVE_SPORTS.includes(s));
    console.log(`[Full] Active sports: ${activeSports.join(', ')}`);

    // Estimate API calls: events calls + (events * market_batches) + team props
    const estimatedEventsCalls = activeSports.length;
    const canProceed = await checkBudget(estimatedEventsCalls);
    if (!canProceed) {
      return new Response(JSON.stringify({
        success: false, error: 'Daily API budget exceeded', mode: 'full',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const allPlayerProps: UnifiedPropInsert[] = [];
    const allTeamBets: GameBetInsert[] = [];

    for (const sport of activeSports) {
      // Phase 1: Fetch events
      console.log(`[Full] Fetching events for ${sport}...`);
      const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${apiKey}&dateFormat=iso`;
      const eventsResponse = await fetch(eventsUrl);
      await trackApiCall();

      if (!eventsResponse.ok) {
        console.error(`[Full] Events fetch failed for ${sport}: ${eventsResponse.status}`);
        continue;
      }

      const events: OddsAPIEvent[] = await eventsResponse.json();
      const windowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      const relevantEvents = events
        .filter(e => new Date(e.commence_time) < windowEnd && new Date(e.commence_time) > now)
        .slice(0, limit_events);

      console.log(`[Full] ${sport}: ${relevantEvents.length} relevant events`);

      if (relevantEvents.length === 0) {
        console.log(`[Full] Skipping ${sport} - no upcoming events`);
        continue;
      }

      // ===== GOLF: Fetch outrights instead of player props / team markets =====
      if (isGolfSport(sport)) {
        const golfBudgetOk = await checkBudget(1);
        if (!golfBudgetOk) {
          console.log(`[Full] Budget exceeded, stopping at golf sport ${sport}`);
          break;
        }

        // Golf uses the sport-level odds endpoint with outrights market
        try {
          const outrightsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american&bookmakers=${BOOKMAKERS.join(',')}`;
          const outrightsResp = await fetch(outrightsUrl);
          await trackApiCall();

          if (outrightsResp.ok) {
            const outrightsData = await outrightsResp.json();
            // outrightsData is an array of events (usually 1 per tournament)
            for (const tournament of outrightsData) {
              const tournamentId = tournament.id || sport;
              const commenceTime = tournament.commence_time || now.toISOString();
              const tournamentTitle = tournament.sport_title || sport;

              for (const bookmaker of (tournament.bookmakers || []) as Bookmaker[]) {
                for (const market of bookmaker.markets) {
                  // Each outcome is a player with their outright odds
                  for (const outcome of market.outcomes) {
                    const playerName = outcome.name;
                    if (!playerName || playerName.length < 3) continue;

                    // Store as game_bet with bet_type: 'outright', player name as home_team
                    allTeamBets.push({
                      game_id: `${tournamentId}_${playerName.replace(/\s+/g, '_').toLowerCase()}`,
                      sport: normalizeSportKey(sport),
                      bet_type: 'outright',
                      home_team: playerName,
                      away_team: tournamentTitle,
                      line: null,
                      home_odds: outcome.price ?? null,
                      away_odds: null,
                      over_odds: null,
                      under_odds: null,
                      bookmaker: bookmaker.key,
                      commence_time: commenceTime,
                      is_active: true,
                    });
                  }
                }
              }
            }
            console.log(`[Full] Golf outrights fetched for ${sport}`);
          } else {
            console.log(`[Full] Golf outrights fetch failed for ${sport}: ${outrightsResp.status}`);
          }
        } catch (golfErr) {
          console.error(`[Full] Golf outrights error for ${sport}:`, golfErr);
        }
        continue; // Skip standard player props / team markets for golf
      }

      // Check budget before fetching props for this sport
      const batches = PLAYER_MARKET_BATCHES[sport] || [];
      const propsCallsNeeded = relevantEvents.length * batches.length;
      const teamCallsNeeded = relevantEvents.length; // 1 call per event for team props (batched markets)
      const sportBudgetOk = await checkBudget(propsCallsNeeded + teamCallsNeeded);
      if (!sportBudgetOk) {
        console.log(`[Full] Budget exceeded, stopping at sport ${sport}`);
        break;
      }

      // Phase 2: Fetch BATCHED player props (reduces calls by ~50%)
      for (const event of relevantEvents) {
        for (const batch of batches) {
          try {
            const marketsParam = batch.join(',');
            const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(',')}`;
            const propsResponse = await fetch(propsUrl);
            await trackApiCall();

            if (!propsResponse.ok) {
              if (propsResponse.status === 404) continue;
              console.error(`[Full] Props batch failed for ${event.id}: ${propsResponse.status}`);
              continue;
            }

            const propsData = await propsResponse.json();
            for (const bookmaker of (propsData.bookmakers || []) as Bookmaker[]) {
              for (const propMarket of bookmaker.markets) {
                const playerMap = new Map<string, { over?: PropOutcome; under?: PropOutcome }>();
                for (const outcome of propMarket.outcomes) {
                  const playerName = outcome.description || outcome.name;
                  if (!playerName || playerName.length < 3) continue;
                  if (!playerMap.has(playerName)) playerMap.set(playerName, {});
                  const po = playerMap.get(playerName)!;
                  if (outcome.name === 'Over') po.over = outcome;
                  else if (outcome.name === 'Under') po.under = outcome;
                }
                for (const [playerName, outcomes] of playerMap) {
                  const line = outcomes.over?.point ?? outcomes.under?.point;
                  if (line === undefined || line === null) continue;
                  allPlayerProps.push({
                    player_name: playerName,
                    prop_type: propMarket.key,
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
          } catch (e) {
            console.error(`[Full] Error fetching batch for ${event.id}:`, e);
          }
        }

        // Phase 3: Fetch team props (spreads/totals/h2h) - single batched call
        try {
          const teamUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${TEAM_MARKETS.join(',')}&oddsFormat=american&bookmakers=${BOOKMAKERS.join(',')}`;
          const teamResponse = await fetch(teamUrl);
          await trackApiCall();

          if (teamResponse.ok) {
            const teamData = await teamResponse.json();
            for (const bookmaker of (teamData.bookmakers || []) as Bookmaker[]) {
              for (const market of bookmaker.markets) {
                if (market.key === 'spreads') {
                  const homeOutcome = market.outcomes.find(o => o.name === event.home_team);
                  const awayOutcome = market.outcomes.find(o => o.name === event.away_team);
                  if (homeOutcome || awayOutcome) {
                    allTeamBets.push({
                      game_id: event.id, sport: normalizeSportKey(sport), bet_type: 'spread',
                      home_team: event.home_team, away_team: event.away_team,
                      line: homeOutcome?.point ?? null,
                      home_odds: homeOutcome?.price ?? null, away_odds: awayOutcome?.price ?? null,
                      over_odds: null, under_odds: null,
                      bookmaker: bookmaker.key, commence_time: event.commence_time, is_active: true,
                    });
                  }
                } else if (market.key === 'totals') {
                  const overOutcome = market.outcomes.find(o => o.name === 'Over');
                  const underOutcome = market.outcomes.find(o => o.name === 'Under');
                  if (overOutcome || underOutcome) {
                    allTeamBets.push({
                      game_id: event.id, sport: normalizeSportKey(sport), bet_type: 'total',
                      home_team: event.home_team, away_team: event.away_team,
                      line: overOutcome?.point ?? underOutcome?.point ?? null,
                      home_odds: null, away_odds: null,
                      over_odds: overOutcome?.price ?? null, under_odds: underOutcome?.price ?? null,
                      bookmaker: bookmaker.key, commence_time: event.commence_time, is_active: true,
                    });
                  }
                } else if (market.key === 'h2h') {
                  const homeOutcome = market.outcomes.find(o => o.name === event.home_team);
                  const awayOutcome = market.outcomes.find(o => o.name === event.away_team);
                  if (homeOutcome || awayOutcome) {
                    allTeamBets.push({
                      game_id: event.id, sport: normalizeSportKey(sport), bet_type: 'h2h',
                      home_team: event.home_team, away_team: event.away_team,
                      line: null,
                      home_odds: homeOutcome?.price ?? null, away_odds: awayOutcome?.price ?? null,
                      over_odds: null, under_odds: null,
                      bookmaker: bookmaker.key, commence_time: event.commence_time, is_active: true,
                    });
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error(`[Full] Team props error for ${event.id}:`, e);
        }

        await new Promise(r => setTimeout(r, 50));
      }
    }

    console.log(`[Full] Collected ${allPlayerProps.length} player props, ${allTeamBets.length} team bets from ${totalApiCalls} API calls`);

    // ========== UPSERT PLAYER PROPS ==========
    if (allPlayerProps.length > 0) {
      const uniqueProps = new Map<string, UnifiedPropInsert>();
      for (const prop of allPlayerProps) {
        uniqueProps.set(`${prop.event_id}_${prop.player_name}_${prop.prop_type}_${prop.bookmaker}`, prop);
      }
      const propsToInsert = Array.from(uniqueProps.values());
      let insertedCount = 0;
      for (let i = 0; i < propsToInsert.length; i += 100) {
        const { error } = await supabase.from('unified_props').upsert(propsToInsert.slice(i, i + 100), {
          onConflict: 'event_id,player_name,prop_type,bookmaker',
          ignoreDuplicates: false,
        });
        if (!error) insertedCount += Math.min(100, propsToInsert.length - i);
        else console.error('[Full] Props upsert error:', error);
      }
      console.log(`[Full] Upserted ${insertedCount} player props`);
    }

    // ========== UPSERT TEAM BETS ==========
    if (allTeamBets.length > 0) {
      const uniqueBets = new Map<string, GameBetInsert>();
      for (const bet of allTeamBets) {
        uniqueBets.set(`${bet.game_id}_${bet.bet_type}_${bet.bookmaker}`, bet);
      }
      const betsToInsert = Array.from(uniqueBets.values());
      let insertedCount = 0;
      for (let i = 0; i < betsToInsert.length; i += 100) {
        const { error } = await supabase.from('game_bets').upsert(betsToInsert.slice(i, i + 100), {
          onConflict: 'game_id,bet_type,bookmaker',
          ignoreDuplicates: false,
        });
        if (!error) insertedCount += Math.min(100, betsToInsert.length - i);
        else console.error('[Full] Team bets upsert error:', error);
      }
      console.log(`[Full] Upserted ${insertedCount} team bets`);
    }

    // Mark old props as inactive
    await supabase.from('unified_props').update({ is_active: false }).lt('commence_time', now.toISOString());
    await supabase.from('game_bets').update({ is_active: false }).lt('commence_time', now.toISOString());

    // ========== LINE MOVEMENT ALERTS (only in full mode) ==========
    try {
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
            await supabase.functions.invoke('bot-send-telegram', {
              body: { type: 'strategy_update', data: { strategyName: 'Line Movement', action: alertMsg, reason: `${pick.player_name} ${pick.prop_type} moved ${diff.toFixed(1)}` } },
            });
            lineAlerts++;
          }
        }
        if (lineAlerts > 0) console.log(`[Full] Sent ${lineAlerts} line movement alerts`);
      }
    } catch (lineErr) {
      console.error('[Full] Line movement check error:', lineErr);
    }

    // Update tracker
    await supabase.from('api_budget_tracker').upsert({
      date: today, last_full_scrape: now.toISOString(),
    }, { onConflict: 'date' });

    await supabase.from('cron_job_history').insert({
      job_name: 'whale-odds-scraper',
      status: 'completed',
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        mode: 'full',
        playerPropsCollected: allPlayerProps.length,
        teamBetsCollected: allTeamBets.length,
        apiCalls: totalApiCalls,
        sports: activeSports,
      },
    });

    return new Response(JSON.stringify({
      success: true, mode: 'full',
      playerPropsCollected: allPlayerProps.length,
      teamBetsCollected: allTeamBets.length,
      apiCalls: totalApiCalls,
      sports: activeSports,
      samplePlayerProps: allPlayerProps.slice(0, 5).map(p => ({
        player: p.player_name, market: p.prop_type, line: p.current_line, sport: p.sport, book: p.bookmaker,
      })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Scraper] Fatal error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

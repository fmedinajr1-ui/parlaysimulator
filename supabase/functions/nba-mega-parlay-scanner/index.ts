// Native Deno.serve used below
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/\./g, '').replace(/'/g, '').replace(/jr$/i, '').replace(/sr$/i, '').replace(/iii$/i, '').replace(/ii$/i, '').trim();

function normalizePropType(raw: string): string {
  const s = (raw || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}

// Props banned from parlays — too binary/volatile
const BLOCKED_PARLAY_PROPS = new Set(['player_steals', 'player_blocks', 'steals', 'blocks']);
const MAX_REBOUND_LEGS_PER_PARLAY = 1;

// === POISON FLIP MAP: block historically-losing sides ===
const POISON_FLIP_MAP: Record<string, 'over' | 'under'> = {
  'rebounds': 'under',
  'threes': 'under',
  'three_pointers': 'under',
  'steals': 'under',
  'assists': 'under',
  'player_assists': 'under',
};

// ============= STRICT PROP OVERLAP PREVENTION =============
const COMBO_BASES: Record<string, string[]> = {
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

// Extended correlation blocking: includes team bet stacking
function hasCorrelatedProp(
  existingLegs: Array<{ player_name: string; prop_type: string; event_id?: string; market_type?: string }>,
  candidatePlayer: string,
  candidateProp: string,
  candidateEventId?: string,
  candidateMarketType?: string
): boolean {
  const player = candidatePlayer.toLowerCase().trim();
  const prop = normalizePropType(candidateProp);

  // Block stacking team bets (h2h + h2h_q1) from same game
  if (candidateMarketType === 'team_bet' && candidateEventId) {
    const sameGameTeamBets = existingLegs.filter(
      l => l.market_type === 'team_bet' && l.event_id === candidateEventId
    );
    if (sameGameTeamBets.length > 0) return true;
  }

  // Block multiple first basket props from same game (mutually exclusive outcomes)
  if (normalizePropType(candidateProp) === 'first_basket' && candidateEventId) {
    const sameGameFirstBasket = existingLegs.filter(
      l => normalizePropType(l.prop_type) === 'first_basket' && l.event_id === candidateEventId
    );
    if (sameGameFirstBasket.length > 0) return true;
  }

  const playerLegs = existingLegs
    .filter(l => l.player_name.toLowerCase().trim() === player)
    .map(l => normalizePropType(l.prop_type));

  if (playerLegs.length === 0) return false;

  const combos = Object.keys(COMBO_BASES);
  if (combos.includes(prop)) {
    const bases = COMBO_BASES[prop];
    if (playerLegs.some(s => bases.includes(s))) return true;
    if (playerLegs.some(s => combos.includes(s))) return true;
  }
  for (const existing of playerLegs) {
    if (combos.includes(existing)) {
      const bases = COMBO_BASES[existing];
      if (bases?.includes(prop)) return true;
    }
  }

  return true; // Same player = always block
}

function americanToImpliedProb(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function americanToDecimal(odds: number): number {
  if (odds >= 100) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

const GUARD_POSITIONS = ['PG', 'SG', 'G'];
const FORWARD_POSITIONS = ['SF', 'PF', 'F'];
const CENTER_POSITIONS = ['C'];

function isGuard(position: string | null): boolean {
  if (!position) return false;
  return GUARD_POSITIONS.some(p => position.toUpperCase().includes(p));
}

function roleStatAligned(position: string | null, propType: string): boolean {
  if (!position) return true;
  const pt = propType.toLowerCase();
  if (isGuard(position) && (pt.includes('rebound') || pt === 'player_rebounds')) return false;
  if (CENTER_POSITIONS.some(p => (position || '').toUpperCase().includes(p)) && pt.includes('three')) return false;
  return true;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function propToDefenseCategory(propType: string): string | null {
  const pt = normalizePropType(propType);
  if (pt === 'points' || pt === 'player_points') return 'points';
  if (pt === 'rebounds' || pt === 'player_rebounds') return 'rebounds';
  if (pt === 'assists' || pt === 'player_assists') return 'assists';
  if (pt === 'threes' || pt === 'player_threes') return 'threes';
  if (pt === 'pra') return 'points';
  return null;
}

function getYesterdayEasternDate(): string {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(yesterday);
}

// Exotic market categories
const EXOTIC_PLAYER_MARKETS = ['player_first_basket', 'player_double_double', 'player_triple_double'];
const TEAM_BET_MARKETS = ['h2h', 'h2h_q1'];
const STANDARD_PLAYER_MARKETS = ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists'];

function getMarketType(marketKey: string): 'player_prop' | 'exotic_player' | 'team_bet' {
  if (EXOTIC_PLAYER_MARKETS.includes(marketKey)) return 'exotic_player';
  if (TEAM_BET_MARKETS.includes(marketKey)) return 'team_bet';
  return 'player_prop';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Standard tier re-enabled — high_roller and mega_jackpot remain disabled
  console.log("[mega-parlay-scanner] Standard tier enabled, HR/Mega disabled");

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    let replayMode = false;
    let excludePlayers: string[] = [];
    let forceMode = false;
    let voidTier: string | null = null;
    try {
      const body = await req.json();
      replayMode = body?.replay === true;
      excludePlayers = Array.isArray(body?.exclude_players) ? body.exclude_players : [];
      forceMode = body?.force === true;
      voidTier = body?.void_tier ?? null;
    } catch { /* no body */ }

    if (!apiKey) throw new Error('THE_ODDS_API_KEY not configured');

    const today = getEasternDate();

    // === FORCE MODE: void existing lottery tickets so they get regenerated ===
    if (forceMode) {
      let voidQuery = supabase
        .from('bot_daily_parlays')
        .update({ outcome: 'void', lesson_learned: 'force_regen_lottery' })
        .eq('parlay_date', today)
        .eq('strategy_name', 'mega_lottery_scanner')
        .neq('outcome', 'void');
      
      if (voidTier) {
        voidQuery = voidQuery.eq('tier', voidTier);
      }
      
      const { data: voidedRows, error: voidErr } = await voidQuery.select('id');
      const voidCount = voidedRows?.length ?? 0;
      console.log(`[MegaParlay] FORCE MODE: voided ${voidCount} existing lottery tickets for ${today}${voidTier ? ` (tier: ${voidTier})` : ' (all tiers)'}${voidErr ? ` (error: ${voidErr.message})` : ''}`);
    }

    // === AUTO-DEDUP: Query existing lottery parlays for today ===
    const { data: existingLotteryParlays } = await supabase
      .from('bot_daily_parlays')
      .select('legs')
      .eq('parlay_date', today)
      .eq('strategy_name', 'mega_lottery_scanner')
      .neq('outcome', 'void');

    const existingPlayerNames: string[] = [];
    if (existingLotteryParlays && existingLotteryParlays.length > 0) {
      // If we already have 3+ tickets today, skip
      if (existingLotteryParlays.length >= 5) {
        console.log(`[MegaParlay] Already have ${existingLotteryParlays.length} lottery tickets today, skipping`);
        return new Response(JSON.stringify({ success: true, skipped: true, reason: '3 tickets already generated today' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      for (const p of existingLotteryParlays) {
        const legs = Array.isArray(p.legs) ? p.legs : [];
        for (const leg of legs) {
          if ((leg as any)?.player_name) {
            existingPlayerNames.push((leg as any).player_name);
          }
        }
      }
    }

    // === INJURY FILTER: exclude OUT/DOUBTFUL players ===
    const { data: injuryAlerts } = await supabase
      .from('lineup_alerts')
      .select('player_name, alert_type')
      .eq('game_date', today)
      .in('alert_type', ['OUT', 'DOUBTFUL']);

    const injuredPlayers = (injuryAlerts || []).map(a => normalizeName(a.player_name));
    console.log(`[MegaParlay] Injury filter: ${injuredPlayers.length} OUT/DOUBTFUL players excluded`);

    const excludeSet = new Set([
      ...excludePlayers.map(normalizeName),
      ...existingPlayerNames.map(normalizeName),
      ...injuredPlayers,
    ]);

    if (excludeSet.size > 0) {
      console.log(`[MegaParlay] Excluding ${excludeSet.size} players from previous tickets`);
    }

    console.log(`[MegaParlay] V2 3-Ticket Scanner for ${today}${replayMode ? ' [REPLAY]' : ''}`);

    // Step 1: Get NBA events
    const eventsListUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${apiKey}`;
    const eventsListRes = await fetchWithTimeout(eventsListUrl);
    if (!eventsListRes.ok) throw new Error(`Events API returned ${eventsListRes.status}: ${await eventsListRes.text()}`);
    const allEvents: any[] = await eventsListRes.json();
    
    // Filter to only today's games (Eastern Time) to prevent including future games
    const toEasternDate = (iso: string): string =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(iso));

    const eventsList = allEvents.filter(evt => {
      if (!evt.commence_time) return false;
      return toEasternDate(evt.commence_time) === today;
    });
    
    const filtered = allEvents.length - eventsList.length;
    console.log(`[MegaParlay] Found ${allEvents.length} NBA events, kept ${eventsList.length} for today (${today}), filtered out ${filtered}`);

    // Standard + exotic markets
    const standardMarkets = STANDARD_PLAYER_MARKETS.join(',');
    const exoticMarkets = [...EXOTIC_PLAYER_MARKETS, ...TEAM_BET_MARKETS].join(',');
    const allMarkets = `${standardMarkets},${exoticMarkets}`;

    // Fetch props per event (standard + exotic in one call)
    const eventPropsPromises = eventsList.map(async (evt) => {
      const eventUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${evt.id}/odds?apiKey=${apiKey}&regions=us&markets=${allMarkets}&oddsFormat=american&bookmakers=fanduel,hardrockbet`;
      try {
        const res = await fetchWithTimeout(eventUrl);
        if (!res.ok) {
          console.warn(`[MegaParlay] Event ${evt.id} returned ${res.status}`);
          await res.text();
          return null;
        }
        return await res.json();
      } catch (e) {
        console.warn(`[MegaParlay] Failed to fetch event ${evt.id}:`, e);
        return null;
      }
    });

    const eventResults = await Promise.all(eventPropsPromises);
    const events: any[] = eventResults.filter(Boolean);
    console.log(`[MegaParlay] Got props from ${events.length}/${eventsList.length} events`);

    // Step 2: Extract all props
    interface RawProp {
      player_name: string;
      prop_type: string;
      side: string;
      odds: number;
      line: number;
      bookmaker: string;
      event_id: string;
      home_team: string;
      away_team: string;
      game: string;
      market_type: 'player_prop' | 'exotic_player' | 'team_bet';
    }

    const rawProps: RawProp[] = [];

    for (const event of events) {
      const game = `${event.away_team} @ ${event.home_team}`;
      for (const bm of (event.bookmakers || [])) {
        for (const market of (bm.markets || [])) {
          const marketType = getMarketType(market.key);

          // === TEAM BET MARKETS (h2h, h2h_q1) — extract underdog (plus-money) side only ===
          if (marketType === 'team_bet') {
            for (const outcome of (market.outcomes || [])) {
              if (outcome.price >= 130) { // Only underdogs with +130 or higher
                rawProps.push({
                  player_name: outcome.name, // Team name
                  prop_type: market.key,
                  side: 'WIN',
                  odds: outcome.price,
                  line: 0,
                  bookmaker: bm.key,
                  event_id: event.id,
                  home_team: event.home_team,
                  away_team: event.away_team,
                  game,
                  market_type: 'team_bet',
                });
              }
            }
            continue;
          }

          // === EXOTIC PLAYER MARKETS (first basket, double/triple double) — Yes outcomes only ===
          if (marketType === 'exotic_player') {
            for (const outcome of (market.outcomes || [])) {
              // First basket uses player names directly; double/triple double have Yes/No
              const isYesOutcome = outcome.name === 'Yes' || !['Yes', 'No', 'Over', 'Under'].includes(outcome.name);
              if (isYesOutcome && outcome.price >= 150) {
                const playerName = outcome.description || outcome.name;
                rawProps.push({
                  player_name: playerName,
                  prop_type: market.key,
                  side: 'YES',
                  odds: outcome.price,
                  line: 0.5, // Yes/No market
                  bookmaker: bm.key,
                  event_id: event.id,
                  home_team: event.home_team,
                  away_team: event.away_team,
                  game,
                  market_type: 'exotic_player',
                });
              }
            }
            continue;
          }

          // === STANDARD PLAYER PROPS — existing Over/Under logic ===
          const playerOutcomes = new Map<string, { over?: any; under?: any }>();
          for (const outcome of (market.outcomes || [])) {
            const desc = outcome.description || '';
            if (!desc) continue;
            if (!playerOutcomes.has(desc)) playerOutcomes.set(desc, {});
            const entry = playerOutcomes.get(desc)!;
            if (outcome.name === 'Over') entry.over = outcome;
            if (outcome.name === 'Under') entry.under = outcome;
          }

          for (const [playerDesc, outcomes] of playerOutcomes) {
            if (outcomes.over && outcomes.over.price >= 100) {
              rawProps.push({
                player_name: playerDesc,
                prop_type: market.key,
                side: 'OVER',
                odds: outcomes.over.price,
                line: outcomes.over.point,
                bookmaker: bm.key,
                event_id: event.id,
                home_team: event.home_team,
                away_team: event.away_team,
                game,
                market_type: 'player_prop',
              });
            }
            if (outcomes.under && outcomes.under.price >= 100) {
              rawProps.push({
                player_name: playerDesc,
                prop_type: market.key,
                side: 'UNDER',
                odds: outcomes.under.price,
                line: outcomes.under.point ?? outcomes.over?.point,
                bookmaker: bm.key,
                event_id: event.id,
                home_team: event.home_team,
                away_team: event.away_team,
                game,
                market_type: 'player_prop',
              });
            }
          }
        }
      }
    }

    // === FALLBACK: If Odds API failed, load from unified_props ===
    if (rawProps.length === 0) {
      console.log(`[MegaParlay] Odds API returned 0 props, falling back to unified_props...`);
      const { data: dbProps, error: dbPropsErr } = await supabase
        .from('unified_props')
        .select('player_name, prop_type, recommended_side, over_price, under_price, current_line, bookmaker, event_id, game_description, sport')
        .eq('is_active', true)
        .eq('sport', 'basketball_nba');

      if (dbPropsErr) {
        console.error(`[MegaParlay] unified_props fallback error:`, dbPropsErr.message);
      } else if (dbProps && dbProps.length > 0) {
        for (const dp of dbProps) {
          const gameDesc = dp.game_description || '';
          const marketType = getMarketType(dp.prop_type || '');
          const side = (dp.recommended_side || 'OVER').toUpperCase();
          const odds = side === 'OVER' ? (dp.over_price || 100) : (dp.under_price || 100);
          if (odds < 100) continue; // skip heavy favorites
          const parts = gameDesc.split(/\s+(?:vs\.?|@)\s+/i);
          rawProps.push({
            player_name: dp.player_name || '',
            prop_type: dp.prop_type || '',
            side,
            odds,
            line: dp.current_line || 0,
            bookmaker: dp.bookmaker || 'unknown',
            event_id: dp.event_id || '',
            home_team: parts[1]?.trim() || '',
            away_team: parts[0]?.trim() || '',
            game: gameDesc,
            market_type: marketType,
          });
          // Also add the opposite side if it has good odds
          const oppSide = side === 'OVER' ? 'UNDER' : 'OVER';
          const oppOdds = oppSide === 'OVER' ? (dp.over_price || 0) : (dp.under_price || 0);
          if (oppOdds >= 100) {
            rawProps.push({
              player_name: dp.player_name || '',
              prop_type: dp.prop_type || '',
              side: oppSide,
              odds: oppOdds,
              line: dp.current_line || 0,
              bookmaker: dp.bookmaker || 'unknown',
              event_id: dp.event_id || '',
              home_team: parts[1]?.trim() || '',
              away_team: parts[0]?.trim() || '',
              game: gameDesc,
              market_type: marketType,
            });
          }
        }
        console.log(`[MegaParlay] Loaded ${rawProps.length} props from unified_props fallback`);
      } else {
        console.log(`[MegaParlay] unified_props fallback returned 0 props`);
      }
    }

    const exoticCount = rawProps.filter(p => p.market_type === 'exotic_player').length;
    const teamBetCount = rawProps.filter(p => p.market_type === 'team_bet').length;
    console.log(`[MegaParlay] Found ${rawProps.length} total props (${exoticCount} exotic, ${teamBetCount} team bets)`);

    const dedupMap = new Map<string, RawProp>();
    for (const p of rawProps) {
      const key = `${normalizeName(p.player_name)}|${p.prop_type}|${p.side}`;
      const existing = dedupMap.get(key);
      if (!existing || p.odds > existing.odds) {
        dedupMap.set(key, p);
      }
    }
    const uniqueProps = Array.from(dedupMap.values());
    console.log(`[MegaParlay] ${uniqueProps.length} unique props after dedup`);

    // Step 3: Cross-reference with database (include L20)
    const [sweetSpotsRes, mispricedRes, gameLogsRes, defenseRes, archetypesRes, teamDefenseRes, l20Res, streakRes, tierPerfRes] = await Promise.all([
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, recommended_side, l10_hit_rate, l10_avg, l10_median, actual_line, category, confidence_score, l10_std_dev, l10_min, l10_max, l3_avg, l5_avg, season_avg, h2h_avg_vs_opponent, projected_value, line_verified_at')
        .eq('analysis_date', today),
      supabase
        .from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, book_line, player_avg')
        .eq('analysis_date', today)
        .gte('edge_pct', 3),
      supabase
        .from('category_sweet_spots')
        .select('player_name, prop_type, l10_avg, l10_median, category')
        .not('l10_avg', 'is', null)
        .order('analysis_date', { ascending: false })
        .limit(1000),
      supabase
        .from('nba_opponent_defense_stats')
        .select('team_name, stat_category, defensive_rank, pts_allowed_rank'),
      supabase
        .from('bdl_player_cache')
        .select('player_name, position'),
      supabase
        .from('team_defense_rankings')
        .select('team_name, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank'),
      // L20 data from mispriced_lines (player_avg is season avg, use as L20 proxy)
      supabase
        .from('mispriced_lines')
        .select('player_name, prop_type, player_avg')
        .eq('analysis_date', today)
        .not('player_avg', 'is', null),
      // Hot streak data from bot_player_performance
      supabase
        .from('bot_player_performance')
        .select('player_name, prop_type, side, streak, legs_played')
        .gte('streak', 3)
        .gte('legs_played', 5),
      // Lottery tier performance for dynamic adjustments
      supabase
        .from('bot_lottery_tier_performance')
        .select('tier, win_rate, total_tickets, total_profit, streak'),
    ]);

    const sweetSpots = sweetSpotsRes.data || [];
    const mispricedLines = mispricedRes.data || [];
    const gameLogs = gameLogsRes.data || [];
    const defenseStats = defenseRes.data || [];
    const playerPositions = archetypesRes.data || [];
    const teamDefenseRankings = teamDefenseRes.data || [];
    const l20Data = l20Res.data || [];
    const streakData = streakRes.data || [];
    const tierPerfData = tierPerfRes.data || [];

    // Build tier performance map for dynamic adjustments
    const tierPerfMap = new Map<string, { win_rate: number; total_tickets: number; total_profit: number; streak: number }>();
    for (const tp of tierPerfData) {
      tierPerfMap.set(tp.tier, { win_rate: tp.win_rate, total_tickets: tp.total_tickets, total_profit: tp.total_profit, streak: tp.streak });
    }

    // Log tier performance context
    for (const [tier, perf] of tierPerfMap) {
      const label = perf.win_rate > 20 && perf.total_tickets >= 10 ? '🔥 HOT' : perf.win_rate < 5 && perf.total_tickets >= 20 ? '❄️ COLD' : '➡️';
      console.log(`[MegaParlay] Tier perf: ${tier} ${label} ${perf.win_rate}% (${perf.total_tickets} tickets, $${perf.total_profit} P/L, streak: ${perf.streak})`);
    }

    // Dynamic stake/quality adjustments per tier
    function getTierAdjustments(tier: string, baseStake: number, baseMinHitRate: number): { stake: number; minHitRate: number } {
      const perf = tierPerfMap.get(tier);
      let stake = baseStake;
      let minHitRate = baseMinHitRate;
      if (perf) {
        if (perf.win_rate > 20 && perf.total_tickets >= 10) {
          stake = Math.round(baseStake * 1.4);
          console.log(`[MegaParlay] ${tier}: HOT tier bump $${baseStake} → $${stake}`);
        } else if (perf.win_rate < 5 && perf.total_tickets >= 20) {
          stake = Math.round(baseStake * 0.6);
          minHitRate += 5;
          console.log(`[MegaParlay] ${tier}: COLD tier reduce $${baseStake} → $${stake}, minHitRate +5% → ${minHitRate}%`);
        }
      }
      return { stake, minHitRate };
    }

    console.log(`[MegaParlay] DB: ${sweetSpots.length} sweet spots, ${mispricedLines.length} mispriced, ${gameLogs.length} game logs, ${defenseStats.length} defense, ${l20Data.length} L20 records, ${streakData.length} hot streaks`);

    // Build hot streak lookup map
    const streakMap = new Map<string, { streak: number; legs_played: number }>();
    for (const s of streakData) {
      const key = `${normalizeName(s.player_name)}|${normalizePropType(s.prop_type)}|${(s.side || 'over').toLowerCase()}`;
      streakMap.set(key, { streak: s.streak, legs_played: s.legs_played });
    }

    // Build lookup maps
    const sweetSpotMap = new Map<string, any>();
    for (const ss of sweetSpots) {
      sweetSpotMap.set(`${normalizeName(ss.player_name)}|${normalizePropType(ss.prop_type)}`, ss);
    }

    const mispricedMap = new Map<string, any>();
    for (const ml of mispricedLines) {
      mispricedMap.set(`${normalizeName(ml.player_name)}|${normalizePropType(ml.prop_type)}`, ml);
    }

    const gameLogMap = new Map<string, any>();
    for (const gl of gameLogs) {
      const key = `${normalizeName(gl.player_name)}|${normalizePropType(gl.prop_type)}`;
      if (!gameLogMap.has(key)) gameLogMap.set(key, gl);
    }

    // L20 map (using player_avg from mispriced_lines as L20 proxy)
    const l20Map = new Map<string, number>();
    for (const l of l20Data) {
      const key = `${normalizeName(l.player_name)}|${normalizePropType(l.prop_type)}`;
      if (!l20Map.has(key)) l20Map.set(key, l.player_avg);
    }

    const positionMap = new Map<string, string>();
    for (const p of playerPositions) {
      positionMap.set(normalizeName(p.player_name), p.position || '');
    }

    const defenseStatMap = new Map<string, any>();
    for (const ds of defenseStats) {
      defenseStatMap.set(`${(ds.team_name || '').toLowerCase()}|${(ds.stat_category || '').toLowerCase()}`, ds);
    }

    const teamDefenseMap = new Map<string, any>();
    for (const td of teamDefenseRankings) {
      teamDefenseMap.set((td.team_name || '').toLowerCase(), td);
    }

    function getDefenseRank(teamName: string, propType: string): number | null {
      const team = teamName.toLowerCase();
      const category = propToDefenseCategory(propType);
      if (!category) return null;
      const td = teamDefenseMap.get(team);
      if (td) {
        if (category === 'points' && td.opp_points_rank) return td.opp_points_rank;
        if (category === 'threes' && td.opp_threes_rank) return td.opp_threes_rank;
        if (category === 'rebounds' && td.opp_rebounds_rank) return td.opp_rebounds_rank;
        if (category === 'assists' && td.opp_assists_rank) return td.opp_assists_rank;
      }
      const dsKey = `${team}|${category}`;
      const ds = defenseStatMap.get(dsKey);
      if (ds?.defensive_rank) return ds.defensive_rank;
      return null;
    }

    // Step 4: Score each prop
    interface ScoredProp extends RawProp {
      hitRate: number;
      edgePct: number;
      medianGap: number;
      compositeScore: number;
      l10Avg: number | null;
      l20Avg: number | null;
      l10Median: number | null;
      position: string | null;
      sweetSpotSide: string | null;
      mispricedSide: string | null;
      defenseRank: number | null;
      defenseBonus: number;
      volumeCandidate: boolean;
      streakLength: number;
      streakBonus: number;
      // DNA-compatible fields
      l10StdDev: number | null;
      l10Min: number | null;
      l10Max: number | null;
      l3Avg: number | null;
      l5Avg: number | null;
      seasonAvg: number | null;
      h2hAvg: number | null;
      projectedValue: number | null;
      hasRealLine: boolean;
      lineSource: string | null;
    }

    const scoredProps: ScoredProp[] = [];

    for (const prop of uniqueProps) {
      const nameNorm = normalizeName(prop.player_name);
      const ptNorm = normalizePropType(prop.prop_type);
      const lookupKey = `${nameNorm}|${ptNorm}`;

      const ss = sweetSpotMap.get(lookupKey);
      const ml = mispricedMap.get(lookupKey);
      const gl = gameLogMap.get(lookupKey);
      const position = positionMap.get(nameNorm) || null;
      const l20Avg = l20Map.get(lookupKey) ?? null;

      // Role-stat alignment (skip for exotic/team bets)
      if (prop.market_type === 'player_prop' && !roleStatAligned(position, prop.prop_type)) continue;

      // === CONDITIONAL POISON FLIP GATE (data-driven) ===
      const normPropFlip = normalizePropType(prop.prop_type);
      const forcedSide = POISON_FLIP_MAP[normPropFlip];
      if (forcedSide && prop.side?.toLowerCase() !== forcedSide) {
        // Only enforce flip if L10 avg supports it; if L10 avg is ABOVE the line, respect OVER
        const flipKey = `${nameNorm}|${normPropFlip}`;
        const flipGl = gameLogMap.get(flipKey);
        const flipL10 = flipGl?.l10_avg ?? null;
        if (forcedSide === 'under' && flipL10 !== null && flipL10 > prop.line * 1.05) {
          // L10 avg is well above the line — data says OVER is correct, skip the flip
          console.log(`[MegaParlay] POISON FLIP OVERRIDE: ${prop.player_name} ${normPropFlip} L10=${flipL10} > line=${prop.line}, keeping OVER`);
        } else {
          continue; // Enforce the flip — skip OVER side
        }
      }

      // Hit rate from sweet spots, with game-log fallback
      let hitRate = ss?.l10_hit_rate || 0;
      if (hitRate > 0 && hitRate <= 1) hitRate = hitRate * 100;

      if (hitRate === 0 && gl && gl.l10_avg != null) {
        const avg = gl.l10_avg;
        if (prop.side === 'OVER') {
          hitRate = Math.min(90, Math.max(0, (avg / prop.line) * 55));
        } else if (prop.side === 'UNDER') {
          hitRate = Math.min(90, Math.max(0, (prop.line / avg) * 55));
        }
      }

      // FIX #2: DD L10 gate — ALWAYS require L10 data for DD picks regardless of hit rate
      if (prop.prop_type === 'player_double_double') {
        const ddPlayerPts = gameLogMap.get(`${nameNorm}|points`);
        const ddPlayerReb = gameLogMap.get(`${nameNorm}|rebounds`);
        const ddPlayerAst = gameLogMap.get(`${nameNorm}|assists`);
        const hasL10 = (ddPlayerPts?.l10_avg != null) || (ddPlayerReb?.l10_avg != null) || (ddPlayerAst?.l10_avg != null);
        if (!hasL10) {
          console.log(`[MegaParlay] DD SKIP (no L10): ${prop.player_name}`);
          continue;
        }
        // Override hit rate with L10-based DD probability
        const ptsAvg = ddPlayerPts?.l10_avg || 0;
        const rebAvg = ddPlayerReb?.l10_avg || 0;
        const astAvg = ddPlayerAst?.l10_avg || 0;
        const cats = [ptsAvg >= 10, rebAvg >= 10, astAvg >= 10].filter(Boolean).length;
        if (cats >= 2) hitRate = Math.max(hitRate, 45);
        else if (cats === 1) {
          const nearDD = [ptsAvg >= 8, rebAvg >= 8, astAvg >= 8].filter(Boolean).length;
          hitRate = Math.max(hitRate, nearDD >= 2 ? 30 : 15);
        } else hitRate = Math.max(hitRate, 10);
      }

      // For exotic/team bets without data, assign baseline hit rates
      if (hitRate === 0 && prop.market_type === 'exotic_player') {
        if (prop.prop_type === 'player_first_basket') hitRate = 8;
        else if (prop.prop_type === 'player_triple_double') hitRate = 5;
      }

      // DD Defense Gate: only allow double-double if opponent is weak in 2+ categories
      if (prop.prop_type === 'player_double_double') {
        const homeOppPts = getDefenseRank(prop.home_team, 'player_points');
        const homeOppReb = getDefenseRank(prop.home_team, 'player_rebounds');
        const homeOppAst = getDefenseRank(prop.home_team, 'player_assists');
        const awayOppPts = getDefenseRank(prop.away_team, 'player_points');
        const awayOppReb = getDefenseRank(prop.away_team, 'player_rebounds');
        const awayOppAst = getDefenseRank(prop.away_team, 'player_assists');
        // Check if either team's defense is weak in 2+ categories (rank >= 18)
        const homeWeakCount = [homeOppPts, homeOppReb, homeOppAst].filter(r => r !== null && r >= 18).length;
        const awayWeakCount = [awayOppPts, awayOppReb, awayOppAst].filter(r => r !== null && r >= 18).length;
        const bestWeakCount = Math.max(homeWeakCount, awayWeakCount);
        if (bestWeakCount < 2) {
          continue; // Skip DD against defensively strong opponents
        }
      }

      // Star player bonus for first basket (stars more likely to score first)
      if (prop.prop_type === 'player_first_basket') {
        const playerL10 = gameLogMap.get(`${nameNorm}|points`);
        if (playerL10?.l10_avg && playerL10.l10_avg >= 20) {
          hitRate += 4; // Stars more likely to score first
        }
        if (playerL10?.l10_avg && playerL10.l10_avg >= 28) {
          hitRate += 4; // Elite scorers even more likely
        }
      }
      if (hitRate === 0 && prop.market_type === 'team_bet') {
        // Underdog ML implied from odds
        hitRate = americanToImpliedProb(prop.odds) * 100;
      }

      // Edge
      let edgePct = 0;
      const mispricedSide = ml?.signal?.toUpperCase() || null;
      if (ml && ml.edge_pct >= 3) {
        if (mispricedSide === prop.side) {
          edgePct = ml.edge_pct;
        }
      }

      const sweetSpotSide = ss?.recommended_side?.toUpperCase() || null;

      let directionBonus = 0;
      if (sweetSpotSide === prop.side) directionBonus += 10;
      if (mispricedSide === prop.side && edgePct >= 3) directionBonus += 10;

      const median = gl?.l10_median ?? ss?.l10_median ?? null;
      let medianGap = 0;
      if (median != null) {
        if (prop.side === 'OVER') {
          medianGap = Math.max(0, (median - prop.line) / prop.line) * 100;
        } else if (prop.side === 'UNDER') {
          medianGap = Math.max(0, (prop.line - median) / prop.line) * 100;
        }
      }

      // Defense matchup
      const homeDefRank = getDefenseRank(prop.home_team, prop.prop_type);
      const awayDefRank = getDefenseRank(prop.away_team, prop.prop_type);
      let defenseRank: number | null = null;
      if (homeDefRank && awayDefRank) {
        defenseRank = Math.max(homeDefRank, awayDefRank);
      } else {
        defenseRank = homeDefRank || awayDefRank || null;
      }

      // For team bets, use the opponent's overall defensive rank
      if (prop.market_type === 'team_bet') {
        // The player_name is the team name for team bets, opponent is the other team
        const isHome = prop.player_name.toLowerCase() === prop.home_team.toLowerCase();
        const oppTeam = isHome ? prop.away_team : prop.home_team;
        const oppDefRank = getDefenseRank(oppTeam, 'points'); // Use points as general metric
        if (oppDefRank) defenseRank = oppDefRank;
      }

      let defenseBonus = 0;
      if (defenseRank !== null) {
        if (prop.side === 'OVER' || prop.side === 'WIN' || prop.side === 'YES') {
          if (defenseRank >= 25) defenseBonus = 15;
          else if (defenseRank >= 21) defenseBonus = 10;
          else if (defenseRank >= 18) defenseBonus = 6;
          else if (defenseRank <= 5) defenseBonus = -15;
          else if (defenseRank <= 10) defenseBonus = -10;
        } else {
          if (defenseRank <= 5) defenseBonus = 8;
          else if (defenseRank <= 10) defenseBonus = 5;
          else if (defenseRank >= 25) defenseBonus = -10;
        }
      }

      const oddsValue = Math.min(100, (prop.odds - 100) / 3 + 50);
      const l10Avg = gl?.l10_avg ?? ss?.l10_avg ?? null;
      const l10Median = median;

      const volumeCandidate = !!(
        l10Avg &&
        prop.side === 'OVER' &&
        l10Avg >= prop.line * 1.3 &&
        defenseRank !== null &&
        defenseRank >= 18 &&
        edgePct >= 5
      );

      // Hot streak bonus
      const streakKey = `${nameNorm}|${ptNorm}|${prop.side.toLowerCase()}`;
      const streakInfo = streakMap.get(streakKey);
      let streakLength = 0;
      let streakBonus = 0;
      if (streakInfo && streakInfo.streak >= 3) {
        streakLength = streakInfo.streak;
        if (streakLength >= 8) streakBonus = 18;
        else if (streakLength >= 5) streakBonus = 12;
        else streakBonus = 8;
      }

      const compositeScore =
        (hitRate * 0.35) +
        (edgePct * 0.20) +
        (medianGap * 0.10) +
        directionBonus +
        defenseBonus +
        streakBonus +
        (oddsValue * 0.10) +
        (volumeCandidate ? 15 : 0);

      scoredProps.push({
        ...prop,
        hitRate,
        edgePct,
        medianGap,
        compositeScore,
        l10Avg,
        l20Avg,
        l10Median,
        position,
        sweetSpotSide,
        mispricedSide,
        defenseRank,
        defenseBonus,
        volumeCandidate,
        streakLength,
        streakBonus,
        // DNA-compatible fields from sweet spots
        l10StdDev: ss?.l10_std_dev ?? null,
        l10Min: ss?.l10_min ?? null,
        l10Max: ss?.l10_max ?? null,
        l3Avg: ss?.l3_avg ?? null,
        l5Avg: ss?.l5_avg ?? null,
        seasonAvg: ss?.season_avg ?? null,
        h2hAvg: ss?.h2h_avg_vs_opponent ?? null,
        projectedValue: ss?.projected_value ?? l10Avg,
        hasRealLine: !!(ss?.actual_line && ss?.line_verified_at),
        lineSource: ss?.actual_line ? 'fanduel' : (prop.bookmaker || null),
      });
    }

    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);
    console.log(`[MegaParlay] ${scoredProps.length} scored props (${scoredProps.filter(p => p.market_type === 'exotic_player').length} exotic, ${scoredProps.filter(p => p.market_type === 'team_bet').length} team bets)`);
    const streakBoosted = scoredProps.filter(p => p.streakBonus > 0);
    if (streakBoosted.length > 0) {
      console.log(`[MegaParlay] 🔥 ${streakBoosted.length} props with hot streak bonus: ${streakBoosted.slice(0, 5).map(p => `${p.player_name} ${p.prop_type} ${p.side} (${p.streakLength}-game streak, +${p.streakBonus})`).join(', ')}`);
    }

    // === CROSS-VERIFY LINES AGAINST unified_props (real FanDuel lines) ===
    const { data: verifiedProps } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, current_line, bookmaker')
      .eq('is_active', true)
      .eq('sport', 'basketball_nba');

    const verifiedLineMap = new Map<string, { line: number; bookmaker: string }>();
    for (const vp of (verifiedProps || [])) {
      const key = `${normalizeName(vp.player_name)}|${normalizePropType(vp.prop_type || '')}`;
      verifiedLineMap.set(key, { line: vp.current_line || 0, bookmaker: vp.bookmaker || 'unknown' });
    }
    console.log(`[MegaParlay] Cross-verify: ${verifiedLineMap.size} verified lines from unified_props`);

    // Mark props with verified lines and flag stale ones
    for (const prop of scoredProps) {
      if (prop.market_type !== 'player_prop') continue;
      const vKey = `${normalizeName(prop.player_name)}|${normalizePropType(prop.prop_type)}`;
      const verified = verifiedLineMap.get(vKey);
      if (verified) {
        const lineDiff = Math.abs(prop.line - verified.line);
        if (lineDiff <= 1) {
          prop.hasRealLine = true;
          prop.lineSource = verified.bookmaker || 'fanduel';
        } else {
          // Line diverges from verified — flag as stale
          prop.hasRealLine = false;
          prop.lineSource = 'stale_diverged';
          prop.compositeScore -= 10; // Penalize stale lines
          console.log(`[MegaParlay] ⚠ STALE LINE: ${prop.player_name} ${prop.prop_type} line=${prop.line} vs verified=${verified.line} (diff=${lineDiff.toFixed(1)})`);
        }
      } else {
        // No verified line found — mark unverified
        prop.hasRealLine = false;
        prop.lineSource = prop.bookmaker || 'unverified';
      }
    }

    // HARD GATE: Remove any props without verified FanDuel lines
    const beforeFilter = scoredProps.length;
    scoredProps = scoredProps.filter(p => p.hasRealLine);
    console.log(`[MegaParlay] Real-line gate: ${beforeFilter} → ${scoredProps.length} props (removed ${beforeFilter - scoredProps.length} without FanDuel lines)`);

    // Re-sort after cross-verification penalties
    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);

    // === ALT LINE HUNTING (expanded to include under threes candidates) ===
    const underThreesCandidates = scoredProps.filter(p => 
      p.side === 'under' && 
      ['threes', 'player_threes'].includes(normalizePropType(p.prop_type)) &&
      p.l10Median != null && p.l10Median >= (p.line + 1) &&
      p.event_id
    ).slice(0, 5);
    const volumeCandidates = scoredProps.filter(p => p.volumeCandidate).slice(0, 10);
    // Merge both candidate lists, dedup by player+prop
    const altFetchSet = new Set<string>();
    const altFetchCandidates: typeof scoredProps = [];
    for (const c of [...volumeCandidates, ...underThreesCandidates]) {
      const key = `${normalizeName(c.player_name)}|${normalizePropType(c.prop_type)}`;
      if (!altFetchSet.has(key)) {
        altFetchSet.add(key);
        altFetchCandidates.push(c);
      }
    }
    const altLineResults = new Map<string, any>();
    if (altFetchCandidates.length > 0) {
      const altLinePromises = altFetchCandidates.map(async (vc) => {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId: vc.event_id,
              playerName: vc.player_name,
              propType: normalizePropType(vc.prop_type),
            }),
          });
          if (res.ok) {
            const data = await res.json();
            return { key: `${normalizeName(vc.player_name)}|${normalizePropType(vc.prop_type)}`, data };
          }
          await res.text();
        } catch (e) {
          console.warn(`[MegaParlay] Alt line fetch failed for ${vc.player_name}:`, e);
        }
        return null;
      });

      const altResults = await Promise.all(altLinePromises);
      for (const r of altResults) {
        if (r?.data?.lines?.length > 0) altLineResults.set(r.key, r.data.lines);
      }
    }

    for (const prop of scoredProps) {
      if (!prop.volumeCandidate || !prop.l10Avg) continue;
      const altKey = `${normalizeName(prop.player_name)}|${normalizePropType(prop.prop_type)}`;
      const altLines = altLineResults.get(altKey);
      if (!altLines) continue;
      const viableAlts = altLines
        .filter((al: any) => al.line > prop.line && prop.l10Avg! >= al.line * 1.1 && al.overOdds >= 100)
        .sort((a: any, b: any) => b.line - a.line);
      if (viableAlts.length > 0) {
        const bestAlt = viableAlts[0];
        console.log(`[MegaParlay] ALT SWAP: ${prop.player_name} ${prop.line} → ${bestAlt.line} (+${bestAlt.overOdds})`);
        prop.line = bestAlt.line;
        prop.odds = bestAlt.overOdds;
        prop.compositeScore += 5;
        prop.hasRealLine = false; // Alt line may not be on FanDuel
        prop.lineSource = 'alt_line';
      }
    }

    // === UNDER-SIDE ALT LINE SWAP ===
    for (const prop of scoredProps) {
      if (prop.side !== 'under') continue;
      const altKey = `${normalizeName(prop.player_name)}|${normalizePropType(prop.prop_type)}`;
      const altLines = altLineResults.get(altKey);
      if (altLines && altLines.length > 0) {
        // Look for higher lines (safer for unders) with reasonable juice
        const viableUnderAlts = altLines
          .filter((al: any) => al.line > prop.line && al.underOdds <= -130 && al.underOdds >= -250)
          .sort((a: any, b: any) => a.line - b.line); // lowest viable alt first (safest without excessive bump)
        if (viableUnderAlts.length > 0) {
          const bestAlt = viableUnderAlts[0];
          console.log(`[MegaParlay] UNDER ALT SWAP: ${prop.player_name} ${prop.prop_type} U${prop.line} → U${bestAlt.line} (${bestAlt.underOdds})`);
          prop.line = bestAlt.line;
          prop.odds = bestAlt.underOdds;
          prop.compositeScore += 3;
          (prop as any).alt_swapped = true;
          prop.hasRealLine = false; // Alt line may not be on FanDuel
          prop.lineSource = 'alt_line';
          continue;
        }
      }

      // === GHOST LINE REMOVED — only real verified lines allowed ===
      // Ghost lines fabricated fake lines that don't exist on any sportsbook.
      // This caused DNA audit and integrity failures. Removed in v2.1.
    }

    scoredProps.sort((a, b) => b.compositeScore - a.compositeScore);

    // ============= 3-TICKET BUILDER =============
    const LOTTERY_MIN_LINES: Record<string, number> = {
      player_blocks: 1.5,
      player_steals: 1.5,
    };
    const MAX_PER_GAME = 2;
    const MAX_SAME_PROP = 2;

    function passesBasicChecks(
      prop: ScoredProp,
      existingLegs: ScoredProp[],
      gameCount: Map<string, number>,
      skipDedup = false
    ): boolean {
      if (!skipDedup && excludeSet.has(normalizeName(prop.player_name))) return false;
      const lotteryMin = LOTTERY_MIN_LINES[prop.prop_type];
      if (lotteryMin && prop.line < lotteryMin) return false;
      const gc = gameCount.get(prop.game) || 0;
      if (gc >= MAX_PER_GAME) return false;
      const existingForCheck = existingLegs.map(p => ({
        player_name: p.player_name,
        prop_type: p.prop_type,
        event_id: p.event_id,
        market_type: p.market_type,
      }));
      if (hasCorrelatedProp(existingForCheck, prop.player_name, prop.prop_type, prop.event_id, prop.market_type)) return false;
      const propNorm = normalizePropType(prop.prop_type);
      const sameTypeCount = existingLegs.filter(l => normalizePropType(l.prop_type) === propNorm).length;
      if (sameTypeCount >= MAX_SAME_PROP) return false;
      // Median-line proximity gate: skip coin-flip picks
      if (prop.market_type === 'player_prop' && prop.l10Median != null) {
        const gap = Math.abs(prop.l10Median - prop.line);
        if (gap < 0.5) return false;
      }
      // Block same-game double-double picks (no two DD from same game)
      if (prop.prop_type === 'player_double_double') {
        const existingDD = existingLegs.filter(
          l => l.prop_type === 'player_double_double' && l.game === prop.game
        );
        if (existingDD.length > 0) return false;
      }
      return true;
    }

    function addLeg(
      prop: ScoredProp,
      legs: (ScoredProp & { leg_role: string; ticket_tier: string })[],
      gameCount: Map<string, number>,
      usedPlayers: Set<string>,
      role: string,
      tier: string
    ): boolean {
      // Ghost leg gate
      if (!prop.player_name) { console.log(`[GhostBlock] MegaScanner: skipped leg with no player_name`); return false; }
      // Volatile prop block
      const normProp = normalizePropType(prop.prop_type || '');
      if (BLOCKED_PARLAY_PROPS.has(normProp)) { console.log(`[VolatileBlock] MegaScanner: blocked ${prop.player_name} ${prop.prop_type}`); return false; }
      // Rebound cap
      const rebCount = legs.filter(l => normalizePropType(l.prop_type || '') === 'rebounds' || normalizePropType(l.prop_type || '') === 'player_rebounds').length;
      if ((normProp === 'rebounds' || normProp === 'player_rebounds') && rebCount >= MAX_REBOUND_LEGS_PER_PARLAY) { console.log(`[ReboundCap] MegaScanner: blocked ${prop.player_name}`); return false; }

      legs.push({ ...prop, leg_role: role, ticket_tier: tier });
      gameCount.set(prop.game, (gameCount.get(prop.game) || 0) + 1);
      usedPlayers.add(normalizeName(prop.player_name));
      return true;
    }

    function calcCombinedOdds(legs: ScoredProp[]): number {
      let dec = 1;
      for (const l of legs) dec *= americanToDecimal(l.odds);
      return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
    }

    // Track used players across all 3 tickets
    const allUsedPlayers = new Set<string>();
    const allTickets: {
      tier: string;
      legs: (ScoredProp & { leg_role: string; ticket_tier: string })[];
      stake: number;
      combinedOdds: number;
    }[] = [];

    // ============= TICKET 1: STANDARD LOTTERY (2-4 legs, +500 to +2000) =============
    const stdAdj = getTierAdjustments('standard', 5, 45);
    console.log(`\n[MegaParlay] === TICKET 1: STANDARD LOTTERY ($${stdAdj.stake}) ===`);
    {
      const legs: (ScoredProp & { leg_role: string; ticket_tier: string })[] = [];
      const gc = new Map<string, number>();
      const used = new Set<string>();

      // SAFE leg
      const safeCandidates = scoredProps.filter(p => {
        if (p.market_type !== 'player_prop') return false;
        if (p.hitRate < 70) return false;
        if (p.edgePct < 3) return false;
        if (p.defenseRank !== null && p.defenseRank < 15) return false;
        // Double signal: require sweet spot alignment AND (mispriced or edge >= 5)
        if (p.sweetSpotSide !== p.side) return false;
        if (p.mispricedSide !== p.side && (p.edgePct == null || p.edgePct < 5)) return false;
        if (p.l10Avg !== null && p.side === 'OVER' && p.l10Avg < p.line * 1.1) return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => b.hitRate - a.hitRate);

      if (safeCandidates.length > 0) {
        addLeg(safeCandidates[0], legs, gc, used, 'safe', 'standard');
        console.log(`[MegaParlay] STANDARD SAFE: ${safeCandidates[0].player_name} +${safeCandidates[0].odds}`);
      }

      // BALANCED leg
      const balCandidates = scoredProps.filter(p => {
        if (p.market_type !== 'player_prop') return false;
        if (p.hitRate < 70) return false;
        if (p.edgePct < 5) return false;
        if (p.defenseRank !== null && p.defenseRank < 18) return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => b.compositeScore - a.compositeScore);

      if (balCandidates.length > 0) {
        addLeg(balCandidates[0], legs, gc, used, 'balanced', 'standard');
        console.log(`[MegaParlay] STANDARD BALANCED: ${balCandidates[0].player_name} +${balCandidates[0].odds}`);
      }

      // GREAT ODDS leg
      const greatCandidates = scoredProps.filter(p => {
        if (p.market_type !== 'player_prop') return false;
        if (p.odds < 120) return false;
        if (p.hitRate < 55) return false;
        if (p.l10Avg !== null && p.side === 'OVER' && p.l10Avg < p.line * 1.3) return false;
        if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
        return passesBasicChecks(p, legs, gc);
      }).sort((a, b) => b.odds - a.odds);

      if (greatCandidates.length > 0) {
        addLeg(greatCandidates[0], legs, gc, used, 'great_odds', 'standard');
        console.log(`[MegaParlay] STANDARD GREAT: ${greatCandidates[0].player_name} +${greatCandidates[0].odds}`);
      }

      // Fill to 4 legs if combined odds < 500 — max 1 filler, require 70% hit rate + L10 data
      const fillerCount = legs.filter(l => l.leg_role === 'filler').length;
      if (fillerCount < 1 && legs.length < 4 && calcCombinedOdds(legs) < 500) {
        const filler = scoredProps.find(p => {
          if (p.market_type !== 'player_prop') return false;
          if (p.hitRate < 80) return false;
          if (p.l10Avg == null) return false;
          if (p.edgePct < 3) return false;
          if (p.defenseRank !== null && p.defenseRank < 18) return false;
          if (allUsedPlayers.has(normalizeName(p.player_name))) return false;
          return passesBasicChecks(p, legs, gc);
        });
        if (filler) {
          addLeg(filler, legs, gc, used, 'filler', 'standard');
          console.log(`[MegaParlay] STANDARD FILLER: ${filler.player_name} +${filler.odds} (hitRate=${filler.hitRate}%, edge=${filler.edgePct}%)`);
        }
      }

      // Relaxed fallback if < 3 legs — ensure minimum 3-leg requirement
      if (legs.length < 3) {
        for (const p of scoredProps) {
          if (legs.length >= 3) break;
          if (p.market_type !== 'player_prop') continue;
          if (p.hitRate < 65) continue;
          if (p.l10Avg == null) continue;
          if (allUsedPlayers.has(normalizeName(p.player_name))) continue;
          if (!passesBasicChecks(p, legs, gc)) continue;
          addLeg(p, legs, gc, used, 'fallback', 'standard');
        }
      }

      if (legs.length >= 3) {
        const odds = calcCombinedOdds(legs);
        allTickets.push({ tier: 'standard', legs, stake: stdAdj.stake, combinedOdds: odds });
        for (const n of used) allUsedPlayers.add(n);
        console.log(`[MegaParlay] STANDARD: ${legs.length} legs at +${odds}`);
      } else {
        console.log(`[MegaParlay] STANDARD: Failed to build (only ${legs.length} legs, need 3+)`);
      }
    }

    // ============= TICKET 2: HIGH ROLLER — DISABLED (losing tier) =============
    console.log(`\n[MegaParlay] === HIGH ROLLER: DISABLED (negative ROI) ===`);

    // ============= TICKET 3: MEGA JACKPOT — DISABLED (losing tier) =============
    console.log(`\n[MegaParlay] === MEGA JACKPOT: DISABLED (negative ROI) ===`);

    console.log(`\n[MegaParlay] Built ${allTickets.length}/3 tickets`);

    // ============= SAVE ALL TICKETS =============
    for (const ticket of allTickets) {
      try {
        const parlayLegsJson = ticket.legs.map(leg => ({
          player_name: leg.player_name,
          prop_type: leg.prop_type,
          side: leg.side,
          line: leg.line,
          odds: leg.odds,
          bookmaker: leg.bookmaker,
          game: leg.game,
          hit_rate: leg.hitRate,
          edge_pct: leg.edgePct,
          l10_avg: leg.l10Avg,
          l20_avg: leg.l20Avg,
          l10_median: leg.l10Median,
          defense_rank: leg.defenseRank,
          defense_bonus: leg.defenseBonus,
          volume_candidate: leg.volumeCandidate,
          alt_swapped: (leg as any).alt_swapped || false,
          ghost_alt: false, // Ghost lines removed in v2.1
          leg_role: leg.leg_role,
          ticket_tier: ticket.tier,
          market_type: leg.market_type,
          // DNA-compatible fields
          has_real_line: leg.hasRealLine || false,
          line_source: leg.lineSource || leg.bookmaker || 'odds_api',
          l10_std_dev: leg.l10StdDev || 0,
          l10_min: leg.l10Min || 0,
          l10_max: leg.l10Max || 0,
          l3_avg: leg.l3Avg || leg.l10Avg,
          l5_avg: leg.l5Avg || leg.l10Avg,
          season_avg: leg.seasonAvg || leg.l10Avg,
          h2h_avg_vs_opponent: leg.h2hAvg || 0,
          projected_value: leg.projectedValue || leg.l10Avg || 0,
        }));

        const combinedProb = ticket.legs.reduce((acc, leg) => acc * americanToImpliedProb(leg.odds), 1);
        const decimalOdds = ticket.legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);

        const { error: insertError } = await supabase
          .from('bot_daily_parlays')
          .insert({
            parlay_date: today,
            strategy_name: 'mega_lottery_scanner',
            tier: ticket.tier,
            legs: parlayLegsJson,
            leg_count: ticket.legs.length,
            combined_probability: combinedProb,
            expected_odds: ticket.combinedOdds,
            simulated_stake: ticket.stake,
            simulated_payout: ticket.stake * decimalOdds,
            is_simulated: true,
            selection_rationale: `V2 3-ticket system: ${ticket.tier} (${ticket.legs.length} legs, +${ticket.combinedOdds}, $${ticket.stake} stake)`,
          });

        if (insertError) {
          console.error(`[MegaParlay] Failed to save ${ticket.tier}:`, insertError);
        } else {
          console.log(`[MegaParlay] ✅ ${ticket.tier} saved`);
        }
      } catch (e) {
        console.error(`[MegaParlay] DB save error for ${ticket.tier}:`, e);
      }
    }

    // ============= TELEGRAM MESSAGE =============
    try {
      const telegramData = allTickets.map(t => ({
        tier: t.tier,
        stake: t.stake,
        combinedOdds: t.combinedOdds,
        payout: (t.stake * t.legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1)).toFixed(2),
        legs: t.legs.map((leg, i) => ({
          leg: i + 1,
          player: leg.player_name,
          prop: leg.prop_type.replace('player_', ''),
          side: leg.side,
          line: leg.line,
          odds: `+${leg.odds}`,
          market_type: leg.market_type,
          defense_rank: leg.defenseRank,
          hit_rate: leg.hitRate?.toFixed(1),
          game: leg.game,
        })),
      }));

      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mega_lottery_v2',
          data: {
            date: today,
            tickets: telegramData,
            ticketCount: allTickets.length,
            scanned: rawProps.length,
            events: events.length,
            exoticProps: exoticCount,
            teamBets: teamBetCount,
          }
        }),
      });
    } catch (e) {
      console.error('[MegaParlay] Telegram failed:', e);
    }

    // ============= RESPONSE =============
    const result = {
      success: true,
      date: today,
      version: 'v2_3ticket',
      events_found: events.length,
      total_props: rawProps.length,
      exotic_props: exoticCount,
      team_bets: teamBetCount,
      scored_props: scoredProps.length,
      tickets: allTickets.map(t => ({
        tier: t.tier,
        leg_count: t.legs.length,
        combined_odds: `+${t.combinedOdds}`,
        stake: `$${t.stake}`,
        potential_payout: `$${(t.stake * t.legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1)).toFixed(2)}`,
        legs: t.legs.map((leg, i) => ({
          leg: i + 1,
          role: leg.leg_role,
          player: leg.player_name,
          prop: leg.prop_type.replace('player_', ''),
          side: leg.side,
          line: leg.line,
          odds: `+${leg.odds}`,
          market_type: leg.market_type,
          hit_rate: leg.hitRate?.toFixed(1) + '%',
          defense_rank: leg.defenseRank,
          l10_avg: leg.l10Avg,
          l20_avg: leg.l20Avg,
          game: leg.game,
        })),
      })),
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[MegaParlay] Error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

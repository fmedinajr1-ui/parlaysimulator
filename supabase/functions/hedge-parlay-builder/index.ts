import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Get today's date in Eastern Time
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Team name normalization
const TEAM_ABBREV_MAP: Record<string, string> = {
  'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets',
  'CHA': 'Charlotte Hornets', 'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers',
  'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets', 'DET': 'Detroit Pistons',
  'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
  'LAC': 'LA Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies',
  'MIA': 'Miami Heat', 'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves',
  'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks', 'OKC': 'Oklahoma City Thunder',
  'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs',
  'TOR': 'Toronto Raptors', 'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards'
};

function normalizeTeamName(team: string): string {
  if (!team) return '';
  const upper = team.toUpperCase().trim();
  if (TEAM_ABBREV_MAP[upper]) return TEAM_ABBREV_MAP[upper];
  
  // Try partial match
  for (const [abbrev, fullName] of Object.entries(TEAM_ABBREV_MAP)) {
    if (fullName.toLowerCase().includes(team.toLowerCase()) || 
        team.toLowerCase().includes(fullName.split(' ').pop()?.toLowerCase() || '')) {
      return fullName;
    }
  }
  return team;
}

interface RiskPick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  over_price: number;
  under_price: number;
  confidence_score: number;
  team_name: string;
  opponent: string;
  event_id: string;
  archetype?: string;
  l10_hit_rate?: number;
  edge_score?: number;
}

interface MatchupHistory {
  player_name: string;
  opponent: string;
  prop_type: string;
  games_played: number;
  avg_stat: number;
  max_stat: number;
  min_stat: number;
}

interface DefenseRating {
  team_name: string;
  defensive_rank: number;
  points_allowed_per_game?: number;
  rebounds_allowed_per_game?: number;
  assists_allowed_per_game?: number;
}

interface QualifiedPick extends RiskPick {
  h2h_games: number;
  h2h_avg: number;
  h2h_hit_rate: number;
  line_gap: number;
  h2h_edge: number;
  defense_rank: number;
  defense_grade: 'A' | 'B' | 'C' | 'D' | 'F';
  composite_score: number;
  hedge_role: 'ANCHOR' | 'HEDGE' | 'VALUE';
  odds: number;  // Calculated from over_price/under_price based on side
}

interface HedgePair {
  leg1: QualifiedPick;
  leg2: QualifiedPick;
  hedgeType: 'SAME_GAME_OPPOSITE' | 'CROSS_GAME_CORRELATION' | 'DEFENSE_CONTRAST';
  hedgeScore: number;
  reason: string;
}

interface HedgeParlayLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  odds: number;
  h2h_games: number;
  h2h_avg: number;
  h2h_hit_rate: number;
  defense_grade: string;
  hedge_role: string;
  team_name: string;
  opponent: string;
  composite_score: number;
}

// Calculate H2H edge based on history vs current line
function calculateH2HEdge(pick: RiskPick, history: MatchupHistory): { h2hHitRate: number; lineGap: number; h2hEdge: number } {
  const lineGap = history.avg_stat - pick.line;
  const side = pick.side.toLowerCase();
  
  // Estimate hit rate based on avg vs line
  let h2hHitRate: number;
  if (side === 'over') {
    // For OVER: higher avg relative to line = higher hit rate
    h2hHitRate = lineGap > 2 ? 0.85 : lineGap > 0 ? 0.65 : lineGap > -2 ? 0.45 : 0.25;
  } else {
    // For UNDER: lower avg relative to line = higher hit rate
    h2hHitRate = lineGap < -2 ? 0.85 : lineGap < 0 ? 0.65 : lineGap < 2 ? 0.45 : 0.25;
  }
  
  // Boost for more games played (more reliable data)
  if (history.games_played >= 5) h2hHitRate = Math.min(h2hHitRate + 0.05, 0.95);
  
  // Edge score: combine hit rate with confidence from sample size
  const h2hEdge = (h2hHitRate * 10) + (Math.min(history.games_played, 10) * 0.3) + (Math.abs(lineGap) * 0.3);
  
  return { h2hHitRate, lineGap, h2hEdge };
}

// Grade defensive matchup
function gradeDefensiveMatchup(propType: string, side: string, defenseRank: number): { grade: 'A' | 'B' | 'C' | 'D' | 'F'; boost: number } {
  const isOver = side.toLowerCase() === 'over';
  const isWeakDefense = defenseRank > 20;
  const isStrongDefense = defenseRank <= 10;
  const isMidDefense = defenseRank > 10 && defenseRank <= 20;
  
  // OVER vs weak defense = good, UNDER vs strong defense = good
  if ((isOver && isWeakDefense) || (!isOver && isStrongDefense)) {
    return { grade: 'A', boost: 2.0 };
  } else if ((isOver && defenseRank > 15) || (!isOver && defenseRank <= 15)) {
    return { grade: 'B', boost: 1.0 };
  } else if (isMidDefense) {
    return { grade: 'C', boost: 0 };
  } else if ((isOver && isStrongDefense) || (!isOver && isWeakDefense)) {
    return { grade: 'D', boost: -1.0 };
  }
  return { grade: 'F', boost: -2.0 };
}

// Find hedge pairs from qualified picks
function findHedgePairs(picks: QualifiedPick[]): HedgePair[] {
  const pairs: HedgePair[] = [];
  
  for (let i = 0; i < picks.length; i++) {
    for (let j = i + 1; j < picks.length; j++) {
      const p1 = picks[i];
      const p2 = picks[j];
      
      // CRITICAL: Skip if same player
      if (p1.player_name === p2.player_name) continue;
      
      // Same game opposite side = natural hedge (best)
      if (p1.event_id === p2.event_id && p1.side.toLowerCase() !== p2.side.toLowerCase()) {
        pairs.push({
          leg1: p1,
          leg2: p2,
          hedgeType: 'SAME_GAME_OPPOSITE',
          hedgeScore: 9.0 + (p1.h2h_hit_rate + p2.h2h_hit_rate) / 2,
          reason: `Same game hedge: ${p1.player_name} ${p1.side.toUpperCase()} + ${p2.player_name} ${p2.side.toUpperCase()}`
        });
      }
      
      // Defense contrast hedge
      if (p1.defense_grade === 'A' && p2.defense_grade === 'A' && 
          p1.side.toLowerCase() !== p2.side.toLowerCase() &&
          p1.event_id !== p2.event_id) {
        pairs.push({
          leg1: p1,
          leg2: p2,
          hedgeType: 'DEFENSE_CONTRAST',
          hedgeScore: 8.0 + (p1.h2h_hit_rate + p2.h2h_hit_rate) / 2,
          reason: `Defense exploitation: both A-grade matchups with opposite sides`
        });
      }
      
      // Cross-game correlation (diversification)
      if (p1.event_id !== p2.event_id && p1.team_name !== p2.team_name) {
        pairs.push({
          leg1: p1,
          leg2: p2,
          hedgeType: 'CROSS_GAME_CORRELATION',
          hedgeScore: 6.0 + (p1.composite_score + p2.composite_score) / 20,
          reason: `Cross-game diversification`
        });
      }
    }
  }
  
  return pairs.sort((a, b) => b.hedgeScore - a.hedgeScore);
}

// Calculate combined odds
function calculateCombinedOdds(legs: HedgeParlayLeg[]): number {
  let decimalOdds = 1;
  for (const leg of legs) {
    const american = leg.odds;
    const decimal = american > 0 ? (american / 100) + 1 : (100 / Math.abs(american)) + 1;
    decimalOdds *= decimal;
  }
  // Convert back to American
  if (decimalOdds >= 2) {
    return Math.round((decimalOdds - 1) * 100);
  } else {
    return Math.round(-100 / (decimalOdds - 1));
  }
}

// Normalize prop types for H2H matching
function normalizePropType(propType: string): string {
  return propType.toLowerCase()
    .replace('player_', '')
    .replace('_', '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const today = getEasternDate();
    console.log(`[HedgeParlayBuilder] Building hedge parlays for ${today}...`);

    // 1. Fetch approved risk engine picks with good confidence
    const { data: riskPicks, error: riskError } = await supabase
      .from('nba_risk_engine_picks')
      .select('*')
      .eq('game_date', today)
      .gte('confidence_score', 5.5)
      .eq('outcome', 'pending')
      .order('confidence_score', { ascending: false });

    if (riskError) {
      console.error('[HedgeParlayBuilder] Risk picks error:', JSON.stringify(riskError));
      throw new Error(`Risk picks query failed: ${riskError.message}`);
    }
    
    if (!riskPicks || riskPicks.length === 0) {
      console.log('[HedgeParlayBuilder] No risk picks available for today');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No picks available for hedge parlays',
        parlays: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[HedgeParlayBuilder] Found ${riskPicks.length} risk picks to analyze`);

    // 2. Fetch player team data from bdl_player_cache
    const playerNames = [...new Set(riskPicks.map(p => p.player_name))];
    const { data: playerCache, error: cacheError } = await supabase
      .from('bdl_player_cache')
      .select('player_name, team_name')
      .in('player_name', playerNames);

    if (cacheError) {
      console.warn('[HedgeParlayBuilder] Player cache error:', cacheError);
    }

    const playerTeamMap = new Map<string, string>();
    for (const p of playerCache || []) {
      if (p.team_name) playerTeamMap.set(p.player_name, p.team_name);
    }
    console.log(`[HedgeParlayBuilder] Mapped ${playerTeamMap.size} players to teams`);

    // 3. Fetch game descriptions from unified_props to get teams
    const eventIds = [...new Set(riskPicks.map(p => p.event_id).filter(Boolean))];
    const { data: eventGames, error: gamesError } = await supabase
      .from('unified_props')
      .select('event_id, game_description')
      .in('event_id', eventIds);

    if (gamesError) {
      console.warn('[HedgeParlayBuilder] Games fetch error:', gamesError);
    }

    // Parse game_description to get team matchups: "Away Team @ Home Team"
    const eventTeamMap = new Map<string, { home: string; away: string }>();
    for (const game of eventGames || []) {
      if (!game.game_description) continue;
      const match = game.game_description.match(/^(.+?)\s*@\s*(.+)$/);
      if (match) {
        const away = normalizeTeamName(match[1].trim());
        const home = normalizeTeamName(match[2].trim());
        eventTeamMap.set(game.event_id, { home, away });
      }
    }
    console.log(`[HedgeParlayBuilder] Parsed ${eventTeamMap.size} event matchups`);

    // 4. Fetch matchup history for all players
    const { data: matchupHistory, error: matchupError } = await supabase
      .from('matchup_history')
      .select('*')
      .in('player_name', playerNames);

    if (matchupError) {
      console.warn('[HedgeParlayBuilder] Matchup history error:', matchupError);
    }

    // 5. Fetch defensive ratings
    const { data: defenseRatings, error: defenseError } = await supabase
      .from('team_defensive_ratings')
      .select('*');

    if (defenseError) {
      console.warn('[HedgeParlayBuilder] Defense ratings error:', defenseError);
    }

    // Create lookup maps
    const historyMap = new Map<string, MatchupHistory[]>();
    for (const h of matchupHistory || []) {
      const key = h.player_name;
      if (!historyMap.has(key)) historyMap.set(key, []);
      historyMap.get(key)!.push(h);
    }

    const defenseMap = new Map<string, DefenseRating>();
    for (const d of defenseRatings || []) {
      defenseMap.set(normalizeTeamName(d.team_name), d);
    }

    // 6. Qualify picks with H2H data and defensive matchups
    const qualifiedPicks: QualifiedPick[] = [];

    for (const pick of riskPicks as RiskPick[]) {
      // Enrich team from player cache
      const enrichedTeam = pick.team_name || playerTeamMap.get(pick.player_name) || '';
      const normalizedTeam = normalizeTeamName(enrichedTeam);
      
      // Get opponent from event matchup
      let enrichedOpponent = pick.opponent || '';
      if (!enrichedOpponent && pick.event_id) {
        const matchup = eventTeamMap.get(pick.event_id);
        if (matchup && normalizedTeam) {
          // If player's team is home, opponent is away (and vice versa)
          enrichedOpponent = normalizedTeam === matchup.home ? matchup.away : matchup.home;
        }
      }
      const normalizedOpponent = normalizeTeamName(enrichedOpponent);
      
      console.log(`[HedgeParlayBuilder] ${pick.player_name}: team=${normalizedTeam}, opponent=${normalizedOpponent}`);
      
      const playerHistory = historyMap.get(pick.player_name) || [];
      
      // Find H2H history with normalized prop type matching
      const pickPropNorm = normalizePropType(pick.prop_type);
      const h2hMatch = playerHistory.find(h => {
        const historyPropNorm = normalizePropType(h.prop_type);
        const opponentMatch = normalizeTeamName(h.opponent) === normalizedOpponent;
        const propMatch = historyPropNorm === pickPropNorm || 
                          historyPropNorm.includes(pickPropNorm) || 
                          pickPropNorm.includes(historyPropNorm);
        return opponentMatch && propMatch;
      });

      // Get defensive rating for opponent
      const defenseRating = defenseMap.get(normalizedOpponent);
      const defenseRank = defenseRating?.defensive_rank || 15;

      // Calculate H2H edge
      let h2hGames = 0;
      let h2hAvg = 0;
      let h2hHitRate = 0.5;
      let lineGap = 0;
      let h2hEdge = 5.0;

      if (h2hMatch && h2hMatch.games_played >= 2) {
        const edgeCalc = calculateH2HEdge(pick, h2hMatch);
        h2hGames = h2hMatch.games_played;
        h2hAvg = h2hMatch.avg_stat;
        h2hHitRate = edgeCalc.h2hHitRate;
        lineGap = edgeCalc.lineGap;
        h2hEdge = edgeCalc.h2hEdge;
        console.log(`[HedgeParlayBuilder] H2H match found: ${pick.player_name} vs ${normalizedOpponent} - ${h2hGames} games, avg ${h2hAvg}`);
      }

      // Grade defensive matchup
      const defenseGrade = gradeDefensiveMatchup(pick.prop_type, pick.side, defenseRank);

      // Calculate composite score
      const compositeScore = (
        (pick.confidence_score * 1.5) +
        (h2hEdge) +
        (defenseGrade.boost * 2) +
        ((pick.l10_hit_rate || 0.5) * 5)
      );

      // Always qualify picks - enrich with team/opponent data
      const odds = pick.side.toLowerCase() === 'over' ? pick.over_price : pick.under_price;
      
      qualifiedPicks.push({
        ...pick,
        team_name: enrichedTeam || pick.team_name,
        opponent: enrichedOpponent || pick.opponent,
        h2h_games: h2hGames,
        h2h_avg: h2hAvg,
        h2h_hit_rate: h2hHitRate,
        line_gap: lineGap,
        h2h_edge: h2hEdge,
        defense_rank: defenseRank,
        defense_grade: defenseGrade.grade,
        composite_score: compositeScore,
        hedge_role: 'VALUE',
        odds
      });
    }

    console.log(`[HedgeParlayBuilder] Qualified ${qualifiedPicks.length} picks with H2H/defense data`);

    if (qualifiedPicks.length < 3) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Not enough qualified picks for hedge parlays',
        qualified_picks: qualifiedPicks.length,
        parlays: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Find hedge pairs
    const hedgePairs = findHedgePairs(qualifiedPicks);
    console.log(`[HedgeParlayBuilder] Found ${hedgePairs.length} potential hedge pairs`);

    // 6. Build three types of parlays: CONSERVATIVE, BALANCED, AGGRESSIVE
    // Very permissive configs to ensure parlays are built
    const parlayConfigs = [
      { type: 'CONSERVATIVE', minComposite: 0, targetLegs: 3 },
      { type: 'BALANCED', minComposite: 0, targetLegs: 4 },
      { type: 'AGGRESSIVE', minComposite: 0, targetLegs: 4 }
    ];

    console.log(`[HedgeParlayBuilder] Sample pick composite scores:`, qualifiedPicks.slice(0,3).map(p => ({ player: p.player_name, composite: p.composite_score, defense: p.defense_grade })));

    const builtParlays = [];

    for (const config of parlayConfigs) {
      const selectedLegs: HedgeParlayLeg[] = [];
      const usedPlayers = new Set<string>();
      const usedTeams = new Set<string>();

      // Start with best hedge pair if available (no H2H filter - just take best pair)
      const bestPair = hedgePairs[0];

      if (bestPair) {
        selectedLegs.push({
          player_name: bestPair.leg1.player_name,
          prop_type: bestPair.leg1.prop_type,
          line: bestPair.leg1.line,
          side: bestPair.leg1.side,
          odds: bestPair.leg1.odds,
          h2h_games: bestPair.leg1.h2h_games,
          h2h_avg: bestPair.leg1.h2h_avg,
          h2h_hit_rate: bestPair.leg1.h2h_hit_rate,
          defense_grade: bestPair.leg1.defense_grade,
          hedge_role: 'ANCHOR',
          team_name: bestPair.leg1.team_name,
          opponent: bestPair.leg1.opponent,
          composite_score: bestPair.leg1.composite_score
        });
        selectedLegs.push({
          player_name: bestPair.leg2.player_name,
          prop_type: bestPair.leg2.prop_type,
          line: bestPair.leg2.line,
          side: bestPair.leg2.side,
          odds: bestPair.leg2.odds,
          h2h_games: bestPair.leg2.h2h_games,
          h2h_avg: bestPair.leg2.h2h_avg,
          h2h_hit_rate: bestPair.leg2.h2h_hit_rate,
          defense_grade: bestPair.leg2.defense_grade,
          hedge_role: 'HEDGE',
          team_name: bestPair.leg2.team_name,
          opponent: bestPair.leg2.opponent,
          composite_score: bestPair.leg2.composite_score
        });
        usedPlayers.add(bestPair.leg1.player_name);
        usedPlayers.add(bestPair.leg2.player_name);
        usedTeams.add(bestPair.leg1.team_name);
        usedTeams.add(bestPair.leg2.team_name);
      }

      // Fill remaining legs from qualified picks (relaxed filtering)
      const remainingPicks = qualifiedPicks
        .filter(p => 
          !usedPlayers.has(p.player_name) &&
          p.composite_score >= config.minComposite &&
          p.defense_grade !== 'F'
        )
        .sort((a, b) => b.composite_score - a.composite_score);

      for (const pick of remainingPicks) {
        if (selectedLegs.length >= config.targetLegs) break;
        
        // Skip same player, allow same team for now
        if (usedPlayers.has(pick.player_name)) continue;

        selectedLegs.push({
          player_name: pick.player_name,
          prop_type: pick.prop_type,
          line: pick.line,
          side: pick.side,
          odds: pick.odds,
          h2h_games: pick.h2h_games,
          h2h_avg: pick.h2h_avg,
          h2h_hit_rate: pick.h2h_hit_rate,
          defense_grade: pick.defense_grade,
          hedge_role: 'VALUE',
          team_name: pick.team_name,
          opponent: pick.opponent,
          composite_score: pick.composite_score
        });
        usedPlayers.add(pick.player_name);
        usedTeams.add(pick.team_name);
      }

      if (selectedLegs.length >= 3) {
        const hedgeScore = selectedLegs.reduce((sum, l) => sum + l.composite_score, 0) / selectedLegs.length;
        const correlationScore = 1 - (usedTeams.size / selectedLegs.length); // Lower = better diversification
        const h2hConfidence = selectedLegs.reduce((sum, l) => sum + l.h2h_hit_rate, 0) / selectedLegs.length;
        const totalOdds = calculateCombinedOdds(selectedLegs);

        builtParlays.push({
          parlay_type: config.type,
          legs: selectedLegs,
          hedge_score: Math.round(hedgeScore * 10) / 10,
          correlation_score: Math.round(correlationScore * 100) / 100,
          h2h_confidence: Math.round(h2hConfidence * 100) / 100,
          total_odds: totalOdds
        });

        // Upsert to database
        await supabase.from('hedge_parlays').upsert({
          parlay_date: today,
          parlay_type: config.type,
          legs: selectedLegs,
          hedge_score: hedgeScore,
          correlation_score: correlationScore,
          h2h_confidence: h2hConfidence,
          total_odds: totalOdds,
          outcome: 'pending'
        }, { onConflict: 'parlay_date,parlay_type' });

        console.log(`[HedgeParlayBuilder] Built ${config.type} parlay with ${selectedLegs.length} legs`);
      }
    }

    console.log(`[HedgeParlayBuilder] Built ${builtParlays.length} hedge parlays`);

    return new Response(JSON.stringify({
      success: true,
      message: `Built ${builtParlays.length} hedge parlays`,
      date: today,
      qualified_picks: qualifiedPicks.length,
      hedge_pairs_found: hedgePairs.length,
      parlays: builtParlays
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
    console.error('[HedgeParlayBuilder] Error:', errorMessage);

    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

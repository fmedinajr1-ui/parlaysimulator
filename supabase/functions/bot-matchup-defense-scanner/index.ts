import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Returns a noon-ET-to-noon-ET window in UTC ISO strings
// This captures tonight's games which tip off in the evening ET
// but have UTC timestamps on the next calendar day
function getEasternDateRange(): { today: string; startUtc: string; endUtc: string } {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  // Noon ET today to noon ET tomorrow
  // ET is UTC-5 (EST) or UTC-4 (EDT)
  // We use 17:00 UTC (noon ET during EST) as start
  // and 17:00 UTC next day as end
  const [year, month, day] = today.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day, 17, 0, 0)); // noon ET = 17:00 UTC (EST)
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

  return {
    today,
    startUtc: startDate.toISOString(),
    endUtc: endDate.toISOString(),
  };
}

// NBA team full name -> abbreviation map
const NBA_TEAM_NAME_TO_ABBREV: Record<string, string> = {
  'atlanta hawks': 'ATL',
  'boston celtics': 'BOS',
  'brooklyn nets': 'BKN',
  'charlotte hornets': 'CHA',
  'chicago bulls': 'CHI',
  'cleveland cavaliers': 'CLE',
  'dallas mavericks': 'DAL',
  'denver nuggets': 'DEN',
  'detroit pistons': 'DET',
  'golden state warriors': 'GSW',
  'houston rockets': 'HOU',
  'indiana pacers': 'IND',
  'los angeles clippers': 'LAC',
  'la clippers': 'LAC',
  'los angeles lakers': 'LAL',
  'la lakers': 'LAL',
  'memphis grizzlies': 'MEM',
  'miami heat': 'MIA',
  'milwaukee bucks': 'MIL',
  'minnesota timberwolves': 'MIN',
  'new orleans pelicans': 'NOP',
  'new york knicks': 'NYK',
  'oklahoma city thunder': 'OKC',
  'orlando magic': 'ORL',
  'philadelphia 76ers': 'PHI',
  'phoenix suns': 'PHX',
  'portland trail blazers': 'POR',
  'sacramento kings': 'SAC',
  'san antonio spurs': 'SAS',
  'toronto raptors': 'TOR',
  'utah jazz': 'UTA',
  'washington wizards': 'WAS',
  // Common short forms
  'hawks': 'ATL', 'celtics': 'BOS', 'nets': 'BKN', 'hornets': 'CHA',
  'bulls': 'CHI', 'cavaliers': 'CLE', 'cavs': 'CLE', 'mavericks': 'DAL',
  'mavs': 'DAL', 'nuggets': 'DEN', 'pistons': 'DET', 'warriors': 'GSW',
  'rockets': 'HOU', 'pacers': 'IND', 'clippers': 'LAC', 'lakers': 'LAL',
  'grizzlies': 'MEM', 'heat': 'MIA', 'bucks': 'MIL', 'timberwolves': 'MIN',
  'wolves': 'MIN', 'pelicans': 'NOP', 'knicks': 'NYK', 'thunder': 'OKC',
  'magic': 'ORL', '76ers': 'PHI', 'sixers': 'PHI', 'suns': 'PHX',
  'trail blazers': 'POR', 'blazers': 'POR', 'kings': 'SAC', 'spurs': 'SAS',
  'raptors': 'TOR', 'jazz': 'UTA', 'wizards': 'WAS',
};

function resolveTeamAbbrev(teamName: string): string {
  if (!teamName) return '';
  const lower = teamName.trim().toLowerCase();
  // Check if it's already an abbreviation (3 chars, all uppercase originally)
  if (teamName.trim().length <= 4 && teamName.trim() === teamName.trim().toUpperCase()) {
    return teamName.trim().toUpperCase();
  }
  return NBA_TEAM_NAME_TO_ABBREV[lower] || teamName.trim().toUpperCase();
}

interface DefenseProfile {
  team_abbreviation: string;
  overall_rank: number | null;
  opp_points_rank: number | null;
  opp_threes_rank: number | null;
  opp_rebounds_rank: number | null;
  opp_assists_rank: number | null;
}

interface MatchupRecommendation {
  attacking_team: string;
  defending_team: string;
  prop_type: string;
  side: string;
  defense_rank: number;
  priority: 'prime' | 'favorable' | 'avoid';
}

interface GameMatchupMap {
  home_team: string;
  away_team: string;
  home_soft_spots: { stat: string; rank: number }[];
  away_soft_spots: { stat: string; rank: number }[];
  home_elite_defense: { stat: string; rank: number }[];
  away_elite_defense: { stat: string; rank: number }[];
  recommended_props: MatchupRecommendation[];
}

const STAT_CATEGORIES = [
  { key: 'points', rankField: 'opp_points_rank', propTypes: ['points', 'pts'] },
  { key: 'threes', rankField: 'opp_threes_rank', propTypes: ['threes', '3pm', 'three_pointers'] },
  { key: 'rebounds', rankField: 'opp_rebounds_rank', propTypes: ['rebounds', 'reb'] },
  { key: 'assists', rankField: 'opp_assists_rank', propTypes: ['assists', 'ast'] },
];

function classifyRank(rank: number): 'prime' | 'favorable' | 'avoid' | null {
  if (rank >= 25) return 'prime';
  if (rank >= 18) return 'favorable';
  if (rank <= 5) return 'avoid';
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { today, startUtc, endUtc } = getEasternDateRange();
    console.log(`[MatchupScanner] Starting defense scan for ${today} (window: ${startUtc} to ${endUtc})`);

    // Fetch today's games using noon-to-noon ET window
    const { data: rawGames } = await supabase
      .from('game_bets')
      .select('home_team, away_team, event_id, sport')
      .in('sport', ['basketball_nba', 'basketball_wnba', 'basketball_ncaab'])
      .gte('commence_time', startUtc)
      .lte('commence_time', endUtc);

    if (!rawGames || rawGames.length === 0) {
      console.log('[MatchupScanner] No games found for today');
      return new Response(JSON.stringify({ message: 'No games today', games: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate by event_id (multiple bookmaker rows per game)
    const seenEvents = new Set<string>();
    const games = rawGames.filter(g => {
      if (seenEvents.has(g.event_id)) return false;
      seenEvents.add(g.event_id);
      return true;
    });

    console.log(`[MatchupScanner] Found ${games.length} unique games (from ${rawGames.length} rows)`);

    // Load all defense rankings
    const { data: defenseData } = await supabase
      .from('team_defense_rankings')
      .select('team_abbreviation, overall_rank, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank')
      .eq('is_current', true);

    const defenseMap = new Map<string, DefenseProfile>();
    if (defenseData) {
      for (const row of defenseData) {
        defenseMap.set((row.team_abbreviation || '').toUpperCase(), row as DefenseProfile);
      }
    }
    console.log(`[MatchupScanner] Loaded ${defenseMap.size} team defense profiles`);

    const allMatchups: GameMatchupMap[] = [];
    const allRecommendations: MatchupRecommendation[] = [];

    for (const game of games) {
      // Resolve full team names to abbreviations
      const homeAbbrev = resolveTeamAbbrev(game.home_team || '');
      const awayAbbrev = resolveTeamAbbrev(game.away_team || '');

      console.log(`[MatchupScanner] Game: ${game.home_team} -> ${homeAbbrev} vs ${game.away_team} -> ${awayAbbrev}`);

      const homeDef = defenseMap.get(homeAbbrev);
      const awayDef = defenseMap.get(awayAbbrev);

      if (!homeDef && !awayDef) {
        console.log(`[MatchupScanner] No defense data for ${homeAbbrev} vs ${awayAbbrev}, skipping`);
        continue;
      }

      const matchup: GameMatchupMap = {
        home_team: homeAbbrev,
        away_team: awayAbbrev,
        home_soft_spots: [],
        away_soft_spots: [],
        home_elite_defense: [],
        away_elite_defense: [],
        recommended_props: [],
      };

      // Analyze home team defense (away players attack it)
      if (homeDef) {
        for (const stat of STAT_CATEGORIES) {
          const rank = (homeDef as any)[stat.rankField] ?? homeDef.overall_rank;
          if (rank == null) continue;

          const classification = classifyRank(rank);
          if (classification === 'prime' || classification === 'favorable') {
            matchup.home_soft_spots.push({ stat: stat.key, rank });
            const rec: MatchupRecommendation = {
              attacking_team: awayAbbrev,
              defending_team: homeAbbrev,
              prop_type: stat.key,
              side: 'over',
              defense_rank: rank,
              priority: classification,
            };
            matchup.recommended_props.push(rec);
            allRecommendations.push(rec);
          } else if (classification === 'avoid') {
            matchup.home_elite_defense.push({ stat: stat.key, rank });
            const rec: MatchupRecommendation = {
              attacking_team: awayAbbrev,
              defending_team: homeAbbrev,
              prop_type: stat.key,
              side: 'over',
              defense_rank: rank,
              priority: 'avoid',
            };
            matchup.recommended_props.push(rec);
            allRecommendations.push(rec);
          }
        }
      }

      // Analyze away team defense (home players attack it)
      if (awayDef) {
        for (const stat of STAT_CATEGORIES) {
          const rank = (awayDef as any)[stat.rankField] ?? awayDef.overall_rank;
          if (rank == null) continue;

          const classification = classifyRank(rank);
          if (classification === 'prime' || classification === 'favorable') {
            matchup.away_soft_spots.push({ stat: stat.key, rank });
            const rec: MatchupRecommendation = {
              attacking_team: homeAbbrev,
              defending_team: awayAbbrev,
              prop_type: stat.key,
              side: 'over',
              defense_rank: rank,
              priority: classification,
            };
            matchup.recommended_props.push(rec);
            allRecommendations.push(rec);
          } else if (classification === 'avoid') {
            matchup.away_elite_defense.push({ stat: stat.key, rank });
            const rec: MatchupRecommendation = {
              attacking_team: homeAbbrev,
              defending_team: awayAbbrev,
              prop_type: stat.key,
              side: 'over',
              defense_rank: rank,
              priority: 'avoid',
            };
            matchup.recommended_props.push(rec);
            allRecommendations.push(rec);
          }
        }
      }

      if (matchup.recommended_props.length > 0) {
        allMatchups.push(matchup);
      }
    }

    const primeCount = allRecommendations.filter(r => r.priority === 'prime').length;
    const favorableCount = allRecommendations.filter(r => r.priority === 'favorable').length;
    const avoidCount = allRecommendations.filter(r => r.priority === 'avoid').length;

    console.log(`[MatchupScanner] Results: ${allMatchups.length} games with matchup data | ${primeCount} prime, ${favorableCount} favorable, ${avoidCount} avoid`);

    // Write to bot_research_findings
    const summaryLines = allMatchups.map(m => {
      const softHome = m.home_soft_spots.map(s => `${s.stat}(${s.rank})`).join(',');
      const softAway = m.away_soft_spots.map(s => `${s.stat}(${s.rank})`).join(',');
      return `${m.away_team}@${m.home_team}: HomeDef weak=[${softHome}] AwayDef weak=[${softAway}]`;
    }).join(' | ');

    await supabase.from('bot_research_findings').upsert({
      title: `Matchup Defense Scan ${today}`,
      category: 'matchup_defense_scan',
      research_date: today,
      summary: summaryLines.slice(0, 2000) || 'No actionable matchups found',
      actionable: allRecommendations.length > 0,
      relevance_score: Math.min(10, Math.max(1, Math.round(primeCount * 2 + favorableCount))),
      key_insights: {
        scan_date: today,
        games_scanned: games.length,
        games_with_matchups: allMatchups.length,
        prime_opportunities: primeCount,
        favorable_opportunities: favorableCount,
        avoid_zones: avoidCount,
        matchups: allMatchups,
        recommendations: allRecommendations,
      },
      sources: ['team_defense_rankings', 'game_bets'],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'category,research_date' });

    const result = {
      scan_date: today,
      games_scanned: games.length,
      games_with_matchups: allMatchups.length,
      prime: primeCount,
      favorable: favorableCount,
      avoid: avoidCount,
      total_recommendations: allRecommendations.length,
    };

    console.log('[MatchupScanner] Complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MatchupScanner] Fatal:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

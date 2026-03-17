import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDateRange(): { today: string; startUtc: string; endUtc: string } {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  const [year, month, day] = today.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

  return { today, startUtc: startDate.toISOString(), endUtc: endDate.toISOString() };
}

const NBA_TEAM_NAME_TO_ABBREV: Record<string, string> = {
  'atlanta hawks': 'ATL', 'boston celtics': 'BOS', 'brooklyn nets': 'BKN',
  'charlotte hornets': 'CHA', 'chicago bulls': 'CHI', 'cleveland cavaliers': 'CLE',
  'dallas mavericks': 'DAL', 'denver nuggets': 'DEN', 'detroit pistons': 'DET',
  'golden state warriors': 'GSW', 'houston rockets': 'HOU', 'indiana pacers': 'IND',
  'los angeles clippers': 'LAC', 'la clippers': 'LAC', 'los angeles lakers': 'LAL',
  'la lakers': 'LAL', 'memphis grizzlies': 'MEM', 'miami heat': 'MIA',
  'milwaukee bucks': 'MIL', 'minnesota timberwolves': 'MIN', 'new orleans pelicans': 'NOP',
  'new york knicks': 'NYK', 'oklahoma city thunder': 'OKC', 'orlando magic': 'ORL',
  'philadelphia 76ers': 'PHI', 'phoenix suns': 'PHX', 'portland trail blazers': 'POR',
  'sacramento kings': 'SAC', 'san antonio spurs': 'SAS', 'toronto raptors': 'TOR',
  'utah jazz': 'UTA', 'washington wizards': 'WAS',
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
  if (teamName.trim().length <= 4 && teamName.trim() === teamName.trim().toUpperCase()) {
    return teamName.trim().toUpperCase();
  }
  return NBA_TEAM_NAME_TO_ABBREV[lower] || teamName.trim().toUpperCase();
}

// Map scanner stat keys to prop_type values used in category_sweet_spots
const STAT_TO_PROP_TYPES: Record<string, string[]> = {
  points: ['points', 'pts', 'player_points'],
  threes: ['threes', '3pm', 'three_pointers', 'player_threes'],
  rebounds: ['rebounds', 'reb', 'total_rebounds', 'player_rebounds'],
  assists: ['assists', 'ast', 'player_assists'],
};

interface TeamProfile {
  team_abbreviation: string;
  overall_rank: number | null;
  opp_points_rank: number | null;
  opp_threes_rank: number | null;
  opp_rebounds_rank: number | null;
  opp_assists_rank: number | null;
  off_points_rank: number | null;
  off_threes_rank: number | null;
  off_rebounds_rank: number | null;
  off_assists_rank: number | null;
  off_pace_rank: number | null;
}

interface PlayerTarget {
  player_name: string;
  line: number;
  l10_avg: number;
  l10_hit_rate: number;
  l10_min: number;
  margin: number; // l10_avg - line
  // NEW: risk context fields
  l3_avg: number | null;
  risk_tags: string[];
  l3_trend: 'hot' | 'cold' | 'steady' | null;
  spread: number | null;
}

interface MatchupRecommendation {
  attacking_team: string;
  defending_team: string;
  prop_type: string;
  side: string;
  defense_rank: number;
  offense_rank: number;
  matchup_score: number;
  matchup_label: 'elite' | 'prime' | 'favorable' | 'neutral' | 'avoid' | 'bench_under';
  player_backed: boolean;
  player_targets: PlayerTarget[];
}

interface GameMatchupMap {
  home_team: string;
  away_team: string;
  home_soft_spots: { stat: string; def_rank: number; off_rank: number; score: number }[];
  away_soft_spots: { stat: string; def_rank: number; off_rank: number; score: number }[];
  home_elite_defense: { stat: string; def_rank: number; off_rank: number; score: number }[];
  away_elite_defense: { stat: string; def_rank: number; off_rank: number; score: number }[];
  recommended_props: MatchupRecommendation[];
}

const STAT_CATEGORIES = [
  { key: 'points', defField: 'opp_points_rank', offField: 'off_points_rank', propTypes: ['points', 'pts'] },
  { key: 'threes', defField: 'opp_threes_rank', offField: 'off_threes_rank', propTypes: ['threes', '3pm', 'three_pointers'] },
  { key: 'rebounds', defField: 'opp_rebounds_rank', offField: 'off_rebounds_rank', propTypes: ['rebounds', 'reb'] },
  { key: 'assists', defField: 'opp_assists_rank', offField: 'off_assists_rank', propTypes: ['assists', 'ast'] },
];

function computeMatchupScore(defRank: number, offRank: number): number {
  const invertedOff = 31 - offRank;
  return defRank * 0.6 + invertedOff * 0.4;
}

function classifyMatchupScore(score: number): 'elite' | 'prime' | 'favorable' | 'neutral' | 'avoid' {
  if (score >= 22) return 'elite';
  if (score >= 18) return 'prime';
  if (score >= 14) return 'favorable';
  if (score <= 8) return 'avoid';
  return 'neutral';
}

/**
 * Build risk tags for a player target based on L3 trend, spread, and side.
 * Never blocks — only tags for user awareness.
 */
function buildRiskTags(
  side: string,
  l3Avg: number | null,
  l10Avg: number,
  line: number,
  spread: number | null
): { tags: string[]; trend: 'hot' | 'cold' | 'steady' | null } {
  const tags: string[] = [];
  let trend: 'hot' | 'cold' | 'steady' | null = null;

  // === L3 directional tags ===
  if (l3Avg !== null && l10Avg > 0) {
    const ratio = l3Avg / l10Avg;

    // Trend classification
    if (ratio < 0.85) trend = 'cold';
    else if (ratio > 1.15) trend = 'hot';
    else trend = 'steady';

    // Check confirmation first to allow mutual exclusion
    let confirmed = false;
    if (side === 'over' && l3Avg > line && ratio >= 0.90) {
      confirmed = true;
    } else if (side === 'under' && l3Avg < line && ratio <= 1.10) {
      confirmed = true;
    }

    // Severe decline/surge warnings — suppress if trend HELPS the side (confirmed)
    const declineFires = ratio < 0.80;
    const surgeFires = ratio > 1.20;

    if (declineFires && !(confirmed && side === 'under')) {
      tags.push('L3_DECLINE');
    }
    if (surgeFires && side === 'under' && !confirmed) {
      tags.push('L3_SURGE');
    }
    if (surgeFires && side === 'over' && confirmed) {
      // surge on an over is good — suppress, confirmation covers it
    } else if (surgeFires && side === 'over' && !confirmed) {
      // surge on over but not confirmed (l3 still below line?) — no tag needed
    }

    // L3 vs line directional signal
    if (side === 'over' && l3Avg < line) {
      tags.push('L3_BELOW_LINE');
    } else if (side === 'under' && l3Avg > line) {
      tags.push('L3_ABOVE_LINE');
    }

    // Confirmation tag
    if (confirmed) {
      tags.push('L3_CONFIRMED');
    }
  }

  // === Blowout risk tags ===
  if (spread !== null) {
    const absSpread = Math.abs(spread);
    if (absSpread >= 10 && side === 'over') {
      tags.push(`BLOWOUT_RISK(${spread > 0 ? '-' : '+'}${absSpread})`);
    } else if (absSpread >= 7) {
      tags.push(`ELEVATED_SPREAD(${spread > 0 ? '-' : '+'}${absSpread})`);
    }
  }

  return { tags, trend };
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
    console.log(`[MatchupScanner] Bidirectional scan for ${today} (${startUtc} to ${endUtc})`);

    // Fetch today's games
    const { data: rawGames } = await supabase
      .from('game_bets')
      .select('home_team, away_team, game_id, sport')
      .in('sport', ['basketball_nba', 'basketball_wnba', 'basketball_ncaab'])
      .gte('commence_time', startUtc)
      .lte('commence_time', endUtc);

    let games: Array<{ home_team: string; away_team: string; game_id: string; sport: string }> = [];

    if (!rawGames || rawGames.length === 0) {
      console.log('[MatchupScanner] game_bets empty — falling back to unified_props');

      // Derive games from unified_props game_description
      const { data: propEvents } = await supabase
        .from('unified_props')
        .select('game_description, sport, commence_time')
        .eq('is_active', true)
        .in('sport', ['basketball_nba', 'basketball_wnba', 'basketball_ncaab'])
        .gte('commence_time', startUtc)
        .lte('commence_time', endUtc);

      if (!propEvents || propEvents.length === 0) {
        console.log('[MatchupScanner] No games found in game_bets or unified_props');
        return new Response(JSON.stringify({ message: 'No games today', games: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Parse unique games from event names (format: "Team A vs Team B" or "Away @ Home")
      const seenMatchups = new Set<string>();
      for (const ev of propEvents) {
        if (!ev.game_description) continue;
        const eventKey = ev.game_description.toLowerCase().trim();
        if (seenMatchups.has(eventKey)) continue;
        seenMatchups.add(eventKey);

        // Try "Away vs Home" or "Away @ Home"
        const parts = ev.game_description.split(/\s+(?:vs\.?|@)\s+/i);
        if (parts.length === 2) {
          const awayName = parts[0].trim();
          const homeName = parts[1].trim();
          const awayAbbrev = resolveTeamAbbrev(awayName);
          const homeAbbrev = resolveTeamAbbrev(homeName);
          games.push({
            home_team: homeAbbrev || homeName,
            away_team: awayAbbrev || awayName,
            game_id: `props_${awayAbbrev}_${homeAbbrev}_${today}`,
            sport: ev.sport || 'basketball_nba',
          });
        }
      }

      console.log(`[MatchupScanner] Derived ${games.length} games from unified_props fallback`);
      if (games.length === 0) {
        return new Response(JSON.stringify({ message: 'Could not parse games from props', games: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {

      const seenEvents = new Set<string>();
      games = rawGames.filter(g => {
        if (seenEvents.has(g.game_id)) return false;
        seenEvents.add(g.game_id);
        return true;
      });

      console.log(`[MatchupScanner] ${games.length} unique games (from ${rawGames.length} rows)`);
    }

    // Load BOTH offense + defense rankings
    const { data: rankData } = await supabase
      .from('team_defense_rankings')
      .select('team_abbreviation, overall_rank, opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank, off_points_rank, off_threes_rank, off_rebounds_rank, off_assists_rank, off_pace_rank')
      .eq('is_current', true);

    const profileMap = new Map<string, TeamProfile>();
    if (rankData) {
      for (const row of rankData) {
        profileMap.set((row.team_abbreviation || '').toUpperCase(), row as TeamProfile);
      }
    }
    console.log(`[MatchupScanner] Loaded ${profileMap.size} team profiles (offense + defense)`);

    // Load bdl_player_cache to build player → team map
    const { data: playerCache } = await supabase
      .from('bdl_player_cache')
      .select('player_name, team_name')
      .eq('is_active', true);

    const playerTeamMap = new Map<string, string>();
    if (playerCache) {
      for (const p of playerCache) {
        if (p.player_name && p.team_name) {
          playerTeamMap.set(p.player_name, resolveTeamAbbrev(p.team_name));
        }
      }
    }
    console.log(`[MatchupScanner] Loaded ${playerTeamMap.size} player→team mappings from bdl_player_cache`);

    // === SPREAD LOOKUP: Build spreadMap for blowout detection ===
    const { data: spreadData } = await supabase
      .from('whale_picks')
      .select('home_team, away_team, market_key, current_line')
      .gte('start_time', startUtc)
      .lte('start_time', endUtc);

    // spreadMap: key = "TEAM_ABBREV", value = spread (negative = favored)
    // e.g. DET -14.5 means DET is favored by 14.5
    const spreadMap = new Map<string, number>();
    if (spreadData) {
      for (const wp of spreadData) {
        if (!wp.market_key?.includes('spread') || wp.current_line == null) continue;
        const homeAbbr = resolveTeamAbbrev(wp.home_team || '');
        const awayAbbr = resolveTeamAbbrev(wp.away_team || '');
        if (homeAbbr) spreadMap.set(homeAbbr, wp.current_line); // home spread
        if (awayAbbr) spreadMap.set(awayAbbr, -wp.current_line); // away spread is inverse
      }
    }
    console.log(`[MatchupScanner] Loaded spreads for ${spreadMap.size} teams: ${[...spreadMap.entries()].map(([t,s]) => `${t}(${s})`).join(', ')}`);

    // === INJURY / LINEUP FILTER ===
    const { data: alertsData } = await supabase
      .from('lineup_alerts')
      .select('player_name, alert_type')
      .eq('game_date', today);

    const excludedPlayers = new Set<string>();
    const gtdPlayers = new Set<string>();
    if (alertsData) {
      for (const alert of alertsData) {
        const name = (alert.player_name || '').trim();
        if (!name) continue;
        const status = (alert.alert_type || '').toUpperCase();
        if (status === 'OUT' || status === 'DOUBTFUL') {
          excludedPlayers.add(name);
        } else if (status === 'GTD' || status === 'QUESTIONABLE') {
          gtdPlayers.add(name);
        }
      }
    }
    console.log(`[MatchupScanner] Injury filter: ${excludedPlayers.size} OUT/DOUBTFUL excluded, ${gtdPlayers.size} GTD/QUESTIONABLE flagged`);

    // Load active sweet spots for player-level cross-reference
    const { data: sweetSpots } = await supabase
      .from('category_sweet_spots')
      .select('player_name, category, prop_type, recommended_line, l10_avg, l10_hit_rate, l10_min, l10_max, actual_line, recommended_side, l3_avg')
      .eq('is_active', true)
      .gte('l10_hit_rate', 0.6);

    // Index sweet spots by prop_type for fast lookup
    const sweetSpotsByPropType = new Map<string, any[]>();
    if (sweetSpots) {
      for (const ss of sweetSpots) {
        const pt = (ss.prop_type || '').toLowerCase();
        if (!sweetSpotsByPropType.has(pt)) sweetSpotsByPropType.set(pt, []);
        sweetSpotsByPropType.get(pt)!.push(ss);
      }
    }
    console.log(`[MatchupScanner] Loaded ${sweetSpots?.length || 0} active sweet spots, indexed by prop_type (${sweetSpotsByPropType.size} unique prop types: ${[...sweetSpotsByPropType.keys()].join(', ')})`);

    // === L3 CACHE: Batch-fetch last 3 games for all players on today's teams ===
    // This fills in L3 data for bench players missing l3_avg in category_sweet_spots
    const todayTeams = new Set<string>();
    for (const game of games) {
      todayTeams.add(resolveTeamAbbrev(game.home_team || ''));
      todayTeams.add(resolveTeamAbbrev(game.away_team || ''));
    }
    // Find all player names on today's teams
    const playersOnTodayTeams: string[] = [];
    for (const [name, team] of playerTeamMap) {
      if (todayTeams.has(team)) playersOnTodayTeams.push(name);
    }

    // Fetch last 3 game logs per player (ordered by date desc, limit 3 per player via overfetch)
    const l3Cache = new Map<string, Record<string, number>>();
    if (playersOnTodayTeams.length > 0) {
      // Batch in chunks of 100 players
      const CHUNK = 100;
      for (let i = 0; i < playersOnTodayTeams.length; i += CHUNK) {
        const chunk = playersOnTodayTeams.slice(i, i + CHUNK);
        const { data: gameLogs } = await supabase
          .from('nba_player_game_logs')
          .select('player_name, points, assists, rebounds, threes_made, blocks, min, game_date')
          .in('player_name', chunk)
          .order('game_date', { ascending: false })
          .limit(chunk.length * 3);

        if (gameLogs) {
          const countMap = new Map<string, number>();
          for (const log of gameLogs) {
            const name = log.player_name;
            const count = countMap.get(name) || 0;
            if (count >= 3) continue; // only take 3 most recent
            countMap.set(name, count + 1);

            if (!l3Cache.has(name)) {
              l3Cache.set(name, { points: 0, assists: 0, rebounds: 0, threes: 0, blocks: 0, _games: 0 });
            }
            const entry = l3Cache.get(name)!;
            entry.points += (log.points ?? 0);
            entry.assists += (log.assists ?? 0);
            entry.rebounds += (log.rebounds ?? 0);
            entry.threes += (log.threes_made ?? 0);
            entry.blocks += (log.blocks ?? 0);
            entry._games += 1;
          }
        }
      }
      // Convert sums to averages ONCE after all chunks are processed
      for (const [name, entry] of l3Cache) {
        if (entry._games > 0) {
          entry.points = Math.round((entry.points / entry._games) * 10) / 10;
          entry.assists = Math.round((entry.assists / entry._games) * 10) / 10;
          entry.rebounds = Math.round((entry.rebounds / entry._games) * 10) / 10;
          entry.threes = Math.round((entry.threes / entry._games) * 10) / 10;
          entry.blocks = Math.round((entry.blocks / entry._games) * 10) / 10;
        }
      }
      // Log sample L3 cache entries for debugging
      const sampleEntries = [...l3Cache.entries()].slice(0, 5);
      for (const [name, entry] of sampleEntries) {
        console.log(`[L3 Cache Sample] ${name}: PTS=${entry.points} AST=${entry.assists} REB=${entry.rebounds} 3PM=${entry.threes} BLK=${entry.blocks} (${entry._games} games)`);
      }
    }
    console.log(`[MatchupScanner] L3 cache built for ${l3Cache.size} players from nba_player_game_logs`);

    // Map stat keys to game log field names for L3 cache lookup
    const STAT_TO_LOG_FIELD: Record<string, string> = {
      points: 'points', threes: 'threes', rebounds: 'rebounds', assists: 'assists', blocks: 'blocks',
    };
    // Helper: find player targets for a team + stat category
    function findPlayerTargets(teamAbbrev: string, statKey: string, side: string): PlayerTarget[] {
      const propTypes = STAT_TO_PROP_TYPES[statKey] || [];
      const targets: PlayerTarget[] = [];
      const logField = STAT_TO_LOG_FIELD[statKey] || statKey;

      // Get the team's spread for blowout tagging
      const teamSpread = spreadMap.get(teamAbbrev) ?? null;

      for (const pt of propTypes) {
        const spots = sweetSpotsByPropType.get(pt) || [];
        for (const ss of spots) {
          const playerName = ss.player_name || '';
          
          // Team filter: only include players on the attacking team
          const playerTeam = playerTeamMap.get(playerName);
          if (playerTeam !== teamAbbrev) continue;

          // Injury filter: skip OUT/DOUBTFUL players entirely
          if (excludedPlayers.has(playerName)) continue;

          const line = ss.recommended_line ?? ss.actual_line ?? 0;
          const l10Avg = ss.l10_avg ?? 0;
          const l10HitRate = ss.l10_hit_rate ?? 0;
          const l10Min = ss.l10_min ?? 0;
          const recSide = (ss.recommended_side || '').toLowerCase();
          
          // L3: use sweet_spots l3_avg first, fall back to game logs cache
          let l3Avg: number | null = ss.l3_avg ?? null;
          if (l3Avg === null) {
            const cached = l3Cache.get(playerName);
            if (cached && cached._games >= 2) {
              l3Avg = cached[logField] ?? null;
            }
          }

          // Build risk tags for this player target
          const { tags: riskTags, trend: l3Trend } = buildRiskTags(side, l3Avg, l10Avg, line, teamSpread);

          // L3 contradiction filter: skip if L3 strongly contradicts recommended side
          if (side === 'over' && l3Avg !== null && l3Avg < line * 0.90) {
            continue;
          }
          if (side === 'under' && l3Avg !== null && l3Avg > line * 1.10) {
            continue;
          }

          // For OVER recommendations: l10_avg must comfortably clear the line
          if (side === 'over' && recSide === 'over' && l10Avg > line + 0.3 && l10HitRate >= 0.6) {
            targets.push({
              player_name: playerName,
              line,
              l10_avg: Math.round(l10Avg * 10) / 10,
              l10_hit_rate: Math.round(l10HitRate * 100),
              l10_min: l10Min,
              margin: Math.round((l10Avg - line) * 10) / 10,
              l3_avg: l3Avg !== null ? Math.round(l3Avg * 10) / 10 : null,
              risk_tags: riskTags,
              l3_trend: l3Trend,
              spread: teamSpread,
            });
          }
          // For UNDER recommendations
          if (side === 'under' && recSide === 'under' && l10Avg < line - 0.3 && l10HitRate >= 0.6) {
            targets.push({
              player_name: playerName,
              line,
              l10_avg: Math.round(l10Avg * 10) / 10,
              l10_hit_rate: Math.round(l10HitRate * 100),
              l10_min: l10Min,
              margin: Math.round((line - l10Avg) * 10) / 10,
              l3_avg: l3Avg !== null ? Math.round(l3Avg * 10) / 10 : null,
              risk_tags: riskTags,
              l3_trend: l3Trend,
              spread: teamSpread,
            });
          }
        }
      }

      // === SOURCE-LEVEL DEDUP: collapse by player_name, keep best entry ===
      const dedupTargets = new Map<string, PlayerTarget>();
      for (const t of targets) {
        const existing = dedupTargets.get(t.player_name);
        if (!existing || t.l10_hit_rate > existing.l10_hit_rate ||
            (t.l10_hit_rate === existing.l10_hit_rate && t.margin > existing.margin)) {
          dedupTargets.set(t.player_name, t);
        }
      }
      const uniqueTargets = [...dedupTargets.values()];

      // Sort by margin (strongest first), take top 5
      uniqueTargets.sort((a, b) => b.margin - a.margin);
      return uniqueTargets.slice(0, 5);
    }

    const allMatchups: GameMatchupMap[] = [];
    const allRecommendations: MatchupRecommendation[] = [];

    function processDirection(
      attackerAbbrev: string,
      defenderAbbrev: string,
      attackerProfile: TeamProfile,
      defenderProfile: TeamProfile,
      matchup: GameMatchupMap,
      softSpots: { stat: string; def_rank: number; off_rank: number; score: number }[],
      eliteDefense: { stat: string; def_rank: number; off_rank: number; score: number }[]
    ) {
      for (const stat of STAT_CATEGORIES) {
        const defRank = (defenderProfile as any)[stat.defField] ?? defenderProfile.overall_rank;
        const offRank = (attackerProfile as any)[stat.offField];
        if (defRank == null || offRank == null) continue;

        const score = computeMatchupScore(defRank, offRank);
        const label = classifyMatchupScore(score);

        console.log(`[MatchupScanner] ${attackerAbbrev} ${stat.key} OFF(${offRank}) vs ${defenderAbbrev} DEF(${defRank}) → score=${score.toFixed(1)} [${label}]`);

        const entry = { stat: stat.key, def_rank: defRank, off_rank: offRank, score: Math.round(score * 10) / 10 };

        if (label === 'elite' || label === 'prime' || label === 'favorable') {
          softSpots.push(entry);
        } else if (label === 'avoid') {
          eliteDefense.push(entry);
        }

        if (label !== 'neutral') {
          const side = label === 'avoid' ? 'under' : 'over';
          const playerTargets = findPlayerTargets(attackerAbbrev, stat.key, side);

          const rec: MatchupRecommendation = {
            attacking_team: attackerAbbrev,
            defending_team: defenderAbbrev,
            prop_type: stat.key,
            side,
            defense_rank: defRank,
            offense_rank: offRank,
            matchup_score: Math.round(score * 10) / 10,
            matchup_label: label,
            player_backed: playerTargets.length > 0,
            player_targets: playerTargets,
          };
          matchup.recommended_props.push(rec);
          allRecommendations.push(rec);

          if (playerTargets.length > 0) {
            const tagSummary = playerTargets.flatMap(t => t.risk_tags).filter(Boolean);
            console.log(`[MatchupScanner] ✅ ${attackerAbbrev} ${stat.key} ${side} — ${playerTargets.length} player targets: ${playerTargets.map(t => `${t.player_name}(${t.l10_avg}avg/${t.l10_hit_rate}%${t.risk_tags.length > 0 ? ' ⚠️' + t.risk_tags.join(',') : ''})`).join(', ')}`);
          } else if (label === 'elite' || label === 'prime') {
            console.log(`[MatchupScanner] ⚠️ ${attackerAbbrev} ${stat.key} ${side} — NO player targets found (environment only)`);
          }

          // Bench player UNDER scan
          if (label !== 'avoid') {
            const underTargets = findPlayerTargets(attackerAbbrev, stat.key, 'under');
            if (underTargets.length > 0) {
              const benchUnderRec: MatchupRecommendation = {
                attacking_team: attackerAbbrev,
                defending_team: defenderAbbrev,
                prop_type: stat.key,
                side: 'under',
                defense_rank: defRank,
                offense_rank: offRank,
                matchup_score: Math.round(score * 10) / 10,
                matchup_label: 'bench_under' as any,
                player_backed: true,
                player_targets: underTargets,
              };
              matchup.recommended_props.push(benchUnderRec);
              allRecommendations.push(benchUnderRec);
              console.log(`[MatchupScanner] 📉 ${attackerAbbrev} ${stat.key} BENCH UNDERS — ${underTargets.length} targets: ${underTargets.map(t => `${t.player_name}(${t.l10_avg}avg/${t.l10_hit_rate}%)`).join(', ')}`);
            }
          }
        }
      }
    }

    for (const game of games) {
      const homeAbbrev = resolveTeamAbbrev(game.home_team || '');
      const awayAbbrev = resolveTeamAbbrev(game.away_team || '');

      const homeProfile = profileMap.get(homeAbbrev);
      const awayProfile = profileMap.get(awayAbbrev);

      if (!homeProfile && !awayProfile) {
        console.log(`[MatchupScanner] No data for ${homeAbbrev} vs ${awayAbbrev}, skipping`);
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

      // Away team attacks home defense
      if (homeProfile && awayProfile) {
        processDirection(awayAbbrev, homeAbbrev, awayProfile, homeProfile, matchup, matchup.home_soft_spots, matchup.home_elite_defense);
      }

      // Home team attacks away defense
      if (awayProfile && homeProfile) {
        processDirection(homeAbbrev, awayAbbrev, homeProfile, awayProfile, matchup, matchup.away_soft_spots, matchup.away_elite_defense);
      }

      if (matchup.recommended_props.length > 0) {
        allMatchups.push(matchup);
      }
    }

    const eliteCount = allRecommendations.filter(r => r.matchup_label === 'elite').length;
    const primeCount = allRecommendations.filter(r => r.matchup_label === 'prime').length;
    const favorableCount = allRecommendations.filter(r => r.matchup_label === 'favorable').length;
    const avoidCount = allRecommendations.filter(r => r.matchup_label === 'avoid').length;
    const playerBackedCount = allRecommendations.filter(r => r.player_backed).length;
    const envOnlyCount = allRecommendations.filter(r => !r.player_backed && r.matchup_label !== 'neutral').length;

    // Count risk-tagged targets
    const allTargets = allRecommendations.flatMap(r => r.player_targets);
    const riskTaggedCount = allTargets.filter(t => t.risk_tags && t.risk_tags.length > 0).length;
    const blowoutTaggedCount = allTargets.filter(t => t.risk_tags?.some(tag => tag.startsWith('BLOWOUT'))).length;
    const l3ConfirmedCount = allTargets.filter(t => t.risk_tags?.includes('L3_CONFIRMED')).length;

    console.log(`[MatchupScanner] Results: ${allMatchups.length} games | ${eliteCount} elite, ${primeCount} prime, ${favorableCount} favorable, ${avoidCount} avoid`);
    console.log(`[MatchupScanner] Player validation: ${playerBackedCount} player-backed, ${envOnlyCount} environment-only`);
    console.log(`[MatchupScanner] Risk tags: ${riskTaggedCount} tagged, ${blowoutTaggedCount} blowout risk, ${l3ConfirmedCount} L3 confirmed`);

    // Build summary
    const summaryLines = allMatchups.map(m => {
      const softHome = m.home_soft_spots.map(s => `${s.stat}(OFF${s.off_rank}vDEF${s.def_rank}=${s.score})`).join(',');
      const softAway = m.away_soft_spots.map(s => `${s.stat}(OFF${s.off_rank}vDEF${s.def_rank}=${s.score})`).join(',');
      return `${m.away_team}@${m.home_team}: AwayAttacks=[${softHome}] HomeAttacks=[${softAway}]`;
    }).join(' | ');

    const upsertPayload = {
      title: `Bidirectional Matchup Scan ${today}`,
      category: 'matchup_defense_scan',
      research_date: today,
      summary: summaryLines.slice(0, 2000) || 'No actionable matchups found',
      actionable: allRecommendations.length > 0,
      relevance_score: Math.min(9.99, Math.max(1, Math.round(eliteCount * 3 + primeCount * 2 + favorableCount))),
      key_insights: {
        scan_date: today,
        engine_version: 'bidirectional_v4_dedup_l3cache',
        games_scanned: games.length,
        games_with_matchups: allMatchups.length,
        elite_opportunities: eliteCount,
        prime_opportunities: primeCount,
        favorable_opportunities: favorableCount,
        avoid_zones: avoidCount,
        player_backed_count: playerBackedCount,
        environment_only_count: envOnlyCount,
        risk_tagged_count: riskTaggedCount,
        blowout_tagged_count: blowoutTaggedCount,
        l3_confirmed_count: l3ConfirmedCount,
        scoring_formula: 'oppDefRank*0.6 + (31-teamOffRank)*0.4',
        thresholds: { elite: '>=22', prime: '>=18', favorable: '>=14', avoid: '<=8' },
        matchups: allMatchups,
        recommendations: allRecommendations,
      },
      sources: ['team_defense_rankings(offense+defense)', 'game_bets', 'category_sweet_spots', 'whale_picks(spreads)'],
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from('bot_research_findings')
      .upsert(upsertPayload, { onConflict: 'category,research_date' });

    if (upsertError) {
      console.error('[MatchupScanner] Upsert failed:', upsertError);
      const { error: insertError } = await supabase
        .from('bot_research_findings')
        .insert({ ...upsertPayload, id: crypto.randomUUID() });
      if (insertError) console.error('[MatchupScanner] Insert fallback also failed:', insertError);
      else console.log('[MatchupScanner] Fallback insert succeeded');
    } else {
      console.log('[MatchupScanner] Successfully wrote bidirectional scan to bot_research_findings');
    }

    const result = {
      scan_date: today,
      engine_version: 'bidirectional_v4_dedup_l3cache',
      games_scanned: games.length,
      games_with_matchups: allMatchups.length,
      elite: eliteCount,
      prime: primeCount,
      favorable: favorableCount,
      avoid: avoidCount,
      player_backed: playerBackedCount,
      environment_only: envOnlyCount,
      risk_tagged: riskTaggedCount,
      blowout_tagged: blowoutTaggedCount,
      l3_confirmed: l3ConfirmedCount,
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

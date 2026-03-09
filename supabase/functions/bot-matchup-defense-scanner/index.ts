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

    if (!rawGames || rawGames.length === 0) {
      console.log('[MatchupScanner] No games found');
      return new Response(JSON.stringify({ message: 'No games today', games: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const seenEvents = new Set<string>();
    const games = rawGames.filter(g => {
      if (seenEvents.has(g.game_id)) return false;
      seenEvents.add(g.game_id);
      return true;
    });

    console.log(`[MatchupScanner] ${games.length} unique games (from ${rawGames.length} rows)`);

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

    // === INJURY / LINEUP FILTER ===
    // Fetch today's lineup alerts to exclude OUT/DOUBTFUL players
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

    // Helper: find player targets for a team + stat category
    function findPlayerTargets(teamAbbrev: string, statKey: string, side: string): PlayerTarget[] {
      const propTypes = STAT_TO_PROP_TYPES[statKey] || [];
      const targets: PlayerTarget[] = [];

      for (const pt of propTypes) {
        const spots = sweetSpotsByPropType.get(pt) || [];
        for (const ss of spots) {
          const playerName = ss.player_name || '';
          
          // Team filter: only include players on the attacking team
          const playerTeam = playerTeamMap.get(playerName);
          if (playerTeam !== teamAbbrev) continue;

          const line = ss.recommended_line ?? ss.actual_line ?? 0;
          const l10Avg = ss.l10_avg ?? 0;
          const l10HitRate = ss.l10_hit_rate ?? 0;
          const l10Min = ss.l10_min ?? 0;
          const recSide = (ss.recommended_side || '').toLowerCase();
          const l3Avg = ss.l3_avg ?? null;

          // v11.0: Universal recency decline filter
          if (l3Avg !== null && l10Avg > 0) {
            const declineRatio = l3Avg / l10Avg;
            if (side === 'over' && declineRatio < 0.75) continue; // L3 25%+ below L10 → skip OVER
            if (side === 'under' && declineRatio > 1.25) continue; // L3 25%+ above L10 → skip UNDER
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
            });
          }
          // For UNDER recommendations (avoid zones): l10_avg must be below the line
          if (side === 'under' && recSide === 'under' && l10Avg < line - 0.3 && l10HitRate >= 0.6) {
            targets.push({
              player_name: playerName,
              line,
              l10_avg: Math.round(l10Avg * 10) / 10,
              l10_hit_rate: Math.round(l10HitRate * 100),
              l10_min: l10Min,
              margin: Math.round((line - l10Avg) * 10) / 10,
            });
          }
        }
      }

      // Sort by margin (strongest first), take top 5
      targets.sort((a, b) => b.margin - a.margin);
      return targets.slice(0, 5);
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
            console.log(`[MatchupScanner] ✅ ${attackerAbbrev} ${stat.key} ${side} — ${playerTargets.length} player targets: ${playerTargets.map(t => `${t.player_name}(${t.l10_avg}avg/${t.l10_hit_rate}%)`).join(', ')}`);
          } else {
            console.log(`[MatchupScanner] ⚠️ ${attackerAbbrev} ${stat.key} ${side} — NO player targets found (environment only)`);
          }

          // Bench player UNDER scan: for non-avoid matchups, also find under targets
          // These are players whose individual L10 data supports UNDER despite a favorable team environment
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

    console.log(`[MatchupScanner] Results: ${allMatchups.length} games | ${eliteCount} elite, ${primeCount} prime, ${favorableCount} favorable, ${avoidCount} avoid`);
    console.log(`[MatchupScanner] Player validation: ${playerBackedCount} player-backed, ${envOnlyCount} environment-only`);

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
        engine_version: 'bidirectional_v2_player_backed',
        games_scanned: games.length,
        games_with_matchups: allMatchups.length,
        elite_opportunities: eliteCount,
        prime_opportunities: primeCount,
        favorable_opportunities: favorableCount,
        avoid_zones: avoidCount,
        player_backed_count: playerBackedCount,
        environment_only_count: envOnlyCount,
        scoring_formula: 'oppDefRank*0.6 + (31-teamOffRank)*0.4',
        thresholds: { elite: '>=22', prime: '>=18', favorable: '>=14', avoid: '<=8' },
        matchups: allMatchups,
        recommendations: allRecommendations,
      },
      sources: ['team_defense_rankings(offense+defense)', 'game_bets', 'category_sweet_spots'],
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
      engine_version: 'bidirectional_v2_player_backed',
      games_scanned: games.length,
      games_with_matchups: allMatchups.length,
      elite: eliteCount,
      prime: primeCount,
      favorable: favorableCount,
      avoid: avoidCount,
      player_backed: playerBackedCount,
      environment_only: envOnlyCount,
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

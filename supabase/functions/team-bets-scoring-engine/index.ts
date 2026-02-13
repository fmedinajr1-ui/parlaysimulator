import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= NCAAB NAME MAP (shared with bot-generate-daily-parlays) =============
const NCAAB_NAME_MAP: Record<string, string> = {
  'Michigan St': 'Michigan State', 'Michigan St Spartans': 'Michigan State Spartans',
  'Ohio St': 'Ohio State', 'Ohio St Buckeyes': 'Ohio State Buckeyes',
  'Penn St': 'Penn State', 'Penn St Nittany Lions': 'Penn State Nittany Lions',
  'Oklahoma St': 'Oklahoma State', 'Oklahoma St Cowboys': 'Oklahoma State Cowboys',
  'Iowa St': 'Iowa State', 'Iowa St Cyclones': 'Iowa State Cyclones',
  'Kansas St': 'Kansas State', 'Kansas St Wildcats': 'Kansas State Wildcats',
  'Boise St': 'Boise State', 'Boise St Broncos': 'Boise State Broncos',
  'San Diego St': 'San Diego State', 'San Diego St Aztecs': 'San Diego State Aztecs',
  'Colorado St': 'Colorado State', 'Colorado St Rams': 'Colorado State Rams',
  'Fresno St': 'Fresno State', 'Fresno St Bulldogs': 'Fresno State Bulldogs',
  'Arizona St': 'Arizona State', 'Arizona St Sun Devils': 'Arizona State Sun Devils',
  'Oregon St': 'Oregon State', 'Oregon St Beavers': 'Oregon State Beavers',
  'Washington St': 'Washington State', 'Washington St Cougars': 'Washington State Cougars',
  'Miss St': 'Mississippi State', 'Miss St Bulldogs': 'Mississippi State Bulldogs',
  'UConn': 'Connecticut', 'UConn Huskies': 'Connecticut Huskies',
  'UNC': 'North Carolina', 'UNC Tar Heels': 'North Carolina Tar Heels',
  'SMU': 'SMU Mustangs', 'UCF': 'UCF Knights', 'UNLV': 'UNLV Rebels',
  'USC': 'USC Trojans', 'LSU': 'LSU Tigers', 'BYU': 'BYU Cougars',
};

interface NcaabTeamStats {
  team_name: string;
  conference: string | null;
  kenpom_rank: number | null;
  adj_offense: number | null;
  adj_defense: number | null;
  adj_tempo: number | null;
  home_record: string | null;
  away_record: string | null;
  ats_record: string | null;
  over_under_record: string | null;
}

interface GameBet {
  id: string;
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
  sharp_score: number | null;
}

function clampScore(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseRecord(record: string | null): { wins: number; losses: number; rate: number } {
  if (!record) return { wins: 0, losses: 0, rate: 0.5 };
  const match = record.match(/(\d+)-(\d+)/);
  if (!match) return { wins: 0, losses: 0, rate: 0.5 };
  const wins = parseInt(match[1]);
  const losses = parseInt(match[2]);
  const total = wins + losses;
  return { wins, losses, rate: total > 0 ? wins / total : 0.5 };
}

function resolveNcaabTeam(teamName: string, statsMap: Map<string, NcaabTeamStats>): NcaabTeamStats | undefined {
  let stats = statsMap.get(teamName);
  if (stats) return stats;
  const mapped = NCAAB_NAME_MAP[teamName];
  if (mapped) { stats = statsMap.get(mapped); if (stats) return stats; }
  for (const [key, val] of statsMap) {
    if (key.includes(teamName) || teamName.includes(key)) return val;
    const teamMascot = teamName.split(' ').pop()?.toLowerCase();
    const statMascot = key.split(' ').pop()?.toLowerCase();
    if (teamMascot && statMascot && teamMascot === statMascot && teamMascot.length > 3) {
      const teamFirst = teamName.split(' ')[0].toLowerCase();
      if (key.toLowerCase().includes(teamFirst)) return val;
    }
  }
  return undefined;
}

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// ============= NCAAB SCORING =============
function scoreNcaab(
  bet: GameBet,
  side: string,
  ncaabMap: Map<string, NcaabTeamStats>
): { score: number; breakdown: Record<string, number | string> } {
  let score = 50;
  const breakdown: Record<string, number | string> = { base: 50 };

  const homeStats = resolveNcaabTeam(bet.home_team, ncaabMap);
  const awayStats = resolveNcaabTeam(bet.away_team, ncaabMap);

  if (!homeStats && !awayStats) {
    breakdown.no_data = 0;
    return { score: 55, breakdown };
  }

  const homeOff = homeStats?.adj_offense || 70;
  const homeDef = homeStats?.adj_defense || 70;
  const awayOff = awayStats?.adj_offense || 70;
  const awayDef = awayStats?.adj_defense || 70;
  const homeRank = homeStats?.kenpom_rank || 200;
  const awayRank = awayStats?.kenpom_rank || 200;
  const homeTempo = homeStats?.adj_tempo || 67;
  const awayTempo = awayStats?.adj_tempo || 67;

  // Rank tier bonus
  const sideRank = side === 'HOME' ? homeRank : awayRank;
  if (sideRank > 200) { score -= 15; breakdown.low_rank_penalty = -15; }
  else if (sideRank <= 25) { score += 10; breakdown.elite_rank = 10; }
  else if (sideRank <= 50) { score += 7; breakdown.top50_rank = 7; }
  else if (sideRank <= 100) { score += 3; breakdown.top100_rank = 3; }

  // Sharp money confirmation layer
  if (bet.sharp_score && bet.sharp_score >= 60) {
    const sharpBonus = clampScore(0, 15, Math.round((bet.sharp_score - 50) * 0.5));
    score += sharpBonus;
    breakdown.sharp_confirmation = sharpBonus;
  }

  if (bet.bet_type === 'spread') {
    const homeNetAdv = (homeOff - awayDef) - (awayOff - homeDef);
    const sideAdv = side === 'HOME' ? homeNetAdv : -homeNetAdv;
    const effBonus = clampScore(-15, 15, sideAdv * 1.0);
    score += effBonus;
    breakdown.efficiency_edge = effBonus;
    if (effBonus > 5) breakdown.efficiency_label = `+${sideAdv.toFixed(1)} pts edge`;

    if (side === 'HOME') { score += 5; breakdown.home_court = 5; }

    const sideTeam = side === 'HOME' ? homeStats : awayStats;
    if (sideTeam?.ats_record) {
      const ats = parseRecord(sideTeam.ats_record);
      if (ats.rate > 0.55 && ats.wins + ats.losses >= 10) {
        const atsBonus = clampScore(0, 8, Math.round((ats.rate - 0.50) * 40));
        score += atsBonus;
        breakdown.ats_record = atsBonus;
        breakdown.ats_label = `ATS ${sideTeam.ats_record}`;
      }
    }

    const absLine = Math.abs(bet.line || 0);
    if (absLine > 0 && absLine < 3) { score -= 8; breakdown.close_spread_penalty = -8; }

    if (homeStats?.conference && awayStats?.conference && homeStats.conference === awayStats.conference) {
      score -= 5; breakdown.conference_game = -5;
    }
  }

  if (bet.bet_type === 'total') {
    const avgTempo = (homeTempo + awayTempo) / 2;
    
    if (side === 'OVER' && avgTempo > 70) {
      const paceBonus = clampScore(0, 18, Math.round((avgTempo - 68) * 4));
      score += paceBonus;
      breakdown.tempo_fast = paceBonus;
      breakdown.tempo_label = `Combined tempo: ${avgTempo.toFixed(1)} (fast)`;
    } else if (side === 'UNDER' && avgTempo < 65) {
      const paceBonus = clampScore(0, 18, Math.round((65 - avgTempo) * 5));
      score += paceBonus;
      breakdown.tempo_slow = paceBonus;
      breakdown.tempo_label = `Combined tempo: ${avgTempo.toFixed(1)} (slow)`;
    } else if ((side === 'OVER' && avgTempo < 64) || (side === 'UNDER' && avgTempo > 71)) {
      score -= 12;
      breakdown.tempo_mismatch = -12;
    }

    const combinedOff = homeOff + awayOff;
    const combinedDef = homeDef + awayDef;
    if (side === 'OVER' && combinedOff > 148) { score += 5; breakdown.high_scoring = 5; }
    if (side === 'UNDER' && combinedDef < 128) { score += 5; breakdown.strong_defense = 5; }

    const sideTeam = side === 'OVER' ? homeStats : awayStats;
    if (sideTeam?.over_under_record) {
      const ou = parseRecord(sideTeam.over_under_record);
      if (ou.rate > 0.55 && ou.wins + ou.losses >= 10) {
        const ouBonus = clampScore(0, 6, Math.round((ou.rate - 0.50) * 30));
        score += ouBonus;
        breakdown.ou_record = ouBonus;
      }
    }
  }

  if (bet.bet_type === 'h2h') {
    const homeNetAdv = (homeOff - awayDef) - (awayOff - homeDef);
    const sideAdv = side === 'HOME' ? homeNetAdv : -homeNetAdv;
    const effBonus = clampScore(-12, 12, sideAdv * 0.8);
    score += effBonus;
    breakdown.efficiency_edge = effBonus;
    if (effBonus > 3) breakdown.efficiency_label = `+${sideAdv.toFixed(1)} pts edge`;

    const rankDiff = side === 'HOME' ? awayRank - homeRank : homeRank - awayRank;
    if (rankDiff > 100) { score += 10; breakdown.rank_mismatch = 10; breakdown.rank_label = `Rank #${sideRank} vs #${side === 'HOME' ? awayRank : homeRank}`; }
    else if (rankDiff > 50) { score += 6; breakdown.rank_edge = 6; breakdown.rank_label = `Rank #${sideRank} vs #${side === 'HOME' ? awayRank : homeRank}`; }

    if (side === 'HOME') { score += 6; breakdown.home_court = 6; }

    if (side === 'HOME' && homeStats?.home_record) {
      const hr = parseRecord(homeStats.home_record);
      if (hr.rate > 0.70 && hr.wins + hr.losses >= 5) {
        score += 5; breakdown.strong_home_record = 5;
      }
    }

    const odds = side === 'HOME' ? (bet.home_odds || -110) : (bet.away_odds || -110);
    const impliedProb = americanToImplied(odds);
    if (impliedProb > 0.80) { score -= 10; breakdown.heavy_fav_penalty = -10; }
  }

  return { score: clampScore(30, 95, score), breakdown };
}

// ============= NHL NAME MAP =============
const NHL_NAME_MAP: Record<string, string> = {
  'NY Rangers': 'New York Rangers', 'NY Islanders': 'New York Islanders',
  'LA Kings': 'Los Angeles Kings', 'TB Lightning': 'Tampa Bay Lightning',
  'St Louis Blues': 'St. Louis Blues', 'NJ Devils': 'New Jersey Devils',
  'SJ Sharks': 'San Jose Sharks', 'Vegas Golden Knights': 'Vegas Golden Knights',
  'Columbus Blue Jackets': 'Columbus Blue Jackets',
};

function resolveNhlTeam(teamName: string, nhlMap: Map<string, any>): any | undefined {
  let stats = nhlMap.get(teamName);
  if (stats) return stats;
  const mapped = NHL_NAME_MAP[teamName];
  if (mapped) { stats = nhlMap.get(mapped); if (stats) return stats; }
  // Fuzzy: check if team name is contained in any key or vice versa
  for (const [key, val] of nhlMap) {
    if (key.includes(teamName) || teamName.includes(key)) return val;
    // Match by last word (e.g. "Avalanche")
    const teamLast = teamName.split(' ').pop()?.toLowerCase();
    const keyLast = key.split(' ').pop()?.toLowerCase();
    if (teamLast && keyLast && teamLast === keyLast && teamLast.length > 3) return val;
  }
  return undefined;
}

// ============= NHL SCORING =============
function scoreNhl(
  bet: GameBet,
  side: string,
  nhlMap: Map<string, any>
): { score: number; breakdown: Record<string, number | string> } {
  let score = 50;
  const breakdown: Record<string, number | string> = { base: 50 };

  const homeStats = resolveNhlTeam(bet.home_team, nhlMap);
  const awayStats = resolveNhlTeam(bet.away_team, nhlMap);

  if (!homeStats && !awayStats) {
    if (bet.sharp_score && bet.sharp_score >= 50) {
      score = bet.sharp_score;
      breakdown.sharp_only = bet.sharp_score - 50;
    }
    return { score: clampScore(30, 95, score), breakdown };
  }

  // Shot differential (±12 pts)
  const homeShotDiff = (homeStats?.shots_for_per_game || 30) - (homeStats?.shots_against_per_game || 30);
  const awayShotDiff = (awayStats?.shots_for_per_game || 30) - (awayStats?.shots_against_per_game || 30);

  if (bet.bet_type === 'spread' || bet.bet_type === 'h2h') {
    const sideShots = side === 'HOME' ? homeShotDiff - awayShotDiff : awayShotDiff - homeShotDiff;
    const shotBonus = clampScore(-12, 12, sideShots * 1.5);
    score += shotBonus;
    breakdown.shot_differential = shotBonus;
    if (Math.abs(shotBonus) > 3) breakdown.shot_label = `${(side === 'HOME' ? homeShotDiff : awayShotDiff).toFixed(1)} shot diff`;

    // Home ice (+4)
    if (side === 'HOME') { score += 4; breakdown.home_ice = 4; }

    // Save percentage edge (±8 pts) — now uses real data
    const homeSv = homeStats?.save_pct || 0.900;
    const awaySv = awayStats?.save_pct || 0.900;
    const svDiff = side === 'HOME' ? (homeSv - awaySv) * 200 : (awaySv - homeSv) * 200;
    const svBonus = clampScore(-8, 8, svDiff);
    score += svBonus;
    breakdown.goaltending = svBonus;
    if (Math.abs(svBonus) > 2) breakdown.sv_label = `SV% .${Math.round((side === 'HOME' ? homeSv : awaySv) * 1000)}`;

    // Win percentage edge (±8 pts)
    const homeWinPct = homeStats?.win_pct || 0.5;
    const awayWinPct = awayStats?.win_pct || 0.5;
    const winDiff = side === 'HOME' ? (homeWinPct - awayWinPct) * 40 : (awayWinPct - homeWinPct) * 40;
    const winBonus = clampScore(-8, 8, winDiff);
    score += winBonus;
    breakdown.win_pct_edge = winBonus;

    // Defensive structure bonus (0-6 pts) — low shots against
    const sideSA = side === 'HOME' ? (homeStats?.shots_against_per_game || 30) : (awayStats?.shots_against_per_game || 30);
    if (sideSA < 28) {
      const defBonus = clampScore(0, 6, Math.round((30 - sideSA) * 2));
      score += defBonus;
      breakdown.defensive_structure = defBonus;
      breakdown.defense_label = `${sideSA.toFixed(1)} SA/G`;
    }
  }

  if (bet.bet_type === 'total') {
    const homeGoalsFor = homeStats?.goals_for_per_game || 3.0;
    const awayGoalsFor = awayStats?.goals_for_per_game || 3.0;
    const combinedScoring = homeGoalsFor + awayGoalsFor;

    if (side === 'OVER' && combinedScoring > 6.2) {
      const bonus = clampScore(0, 12, Math.round((combinedScoring - 6.0) * 10));
      score += bonus;
      breakdown.high_scoring = bonus;
      breakdown.scoring_label = `Combined ${combinedScoring.toFixed(1)} GPG`;
    }
    if (side === 'UNDER' && combinedScoring < 5.8) {
      const bonus = clampScore(0, 12, Math.round((6.0 - combinedScoring) * 10));
      score += bonus;
      breakdown.low_scoring = bonus;
      breakdown.scoring_label = `Combined ${combinedScoring.toFixed(1)} GPG`;
    }

    // Save pct matters for unders
    const homeSv = homeStats?.save_pct || 0.900;
    const awaySv = awayStats?.save_pct || 0.900;
    const avgSv = (homeSv + awaySv) / 2;
    if (side === 'UNDER' && avgSv > 0.910) {
      const svBonus = clampScore(0, 6, Math.round((avgSv - 0.900) * 300));
      score += svBonus;
      breakdown.goaltending = svBonus;
    }
  }

  // Sharp confirmation (0-15 pts)
  if (bet.sharp_score && bet.sharp_score >= 60) {
    const sharpBonus = clampScore(0, 15, Math.round((bet.sharp_score - 50) * 0.5));
    score += sharpBonus;
    breakdown.sharp_confirmation = sharpBonus;
  }

  return { score: clampScore(30, 95, score), breakdown };
}

// ============= GENERIC SCORING (NBA, etc.) =============
function scoreGeneric(
  bet: GameBet,
  side: string
): { score: number; breakdown: Record<string, number | string> } {
  let score = 50;
  const breakdown: Record<string, number | string> = { base: 50 };

  // Use sharp_score as primary signal when no sport-specific data
  if (bet.sharp_score && bet.sharp_score >= 50) {
    const sharpBonus = clampScore(0, 20, Math.round((bet.sharp_score - 40) * 0.6));
    score += sharpBonus;
    breakdown.sharp_signal = sharpBonus;
  }

  if (side === 'HOME') { score += 3; breakdown.home_advantage = 3; }

  return { score: clampScore(30, 95, score), breakdown };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('[Scoring Engine] Starting multi-layer scoring...');

    // Fetch active game_bets
    const { data: bets, error: betsErr } = await supabase
      .from('game_bets')
      .select('*')
      .eq('is_active', true)
      .gt('commence_time', new Date().toISOString());

    if (betsErr) throw betsErr;
    if (!bets || bets.length === 0) {
      return new Response(JSON.stringify({ message: 'No active bets to score', scored: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Scoring Engine] Found ${bets.length} active bets to score`);

    // Load NCAAB stats
    const { data: ncaabStats } = await supabase
      .from('ncaab_team_stats')
      .select('team_name, conference, kenpom_rank, adj_offense, adj_defense, adj_tempo, home_record, away_record, ats_record, over_under_record');

    const ncaabMap = new Map<string, NcaabTeamStats>();
    (ncaabStats || []).forEach((s: any) => ncaabMap.set(s.team_name, s));

    // Load NHL stats
    const { data: nhlStats } = await supabase
      .from('nhl_team_pace_stats')
      .select('*');

    const nhlMap = new Map<string, any>();
    (nhlStats || []).forEach((s: any) => {
      nhlMap.set(s.team_name, s);
      if (s.team_abbrev) nhlMap.set(s.team_abbrev, s);
    });

    // Score each bet with both sides, pick the better one
    let scored = 0;
    const updates: { id: string; composite_score: number; recommended_side: string; score_breakdown: any }[] = [];

    for (const bet of bets as GameBet[]) {
      const isNCAAB = bet.sport?.includes('ncaab');
      const isNHL = bet.sport?.includes('nhl') || bet.sport?.includes('hockey');

      // Determine sides to evaluate
      let sides: string[];
      if (bet.bet_type === 'total') {
        sides = ['OVER', 'UNDER'];
      } else {
        sides = ['HOME', 'AWAY'];
      }

      let bestScore = 0;
      let bestSide = sides[0];
      let bestBreakdown: Record<string, number | string> = {};

      for (const side of sides) {
        let result;
        if (isNCAAB) {
          result = scoreNcaab(bet, side, ncaabMap);
        } else if (isNHL) {
          result = scoreNhl(bet, side, nhlMap);
        } else {
          result = scoreGeneric(bet, side);
        }

        if (result.score > bestScore) {
          bestScore = result.score;
          bestSide = side;
          bestBreakdown = result.breakdown;
        }
      }

      updates.push({
        id: bet.id,
        composite_score: bestScore,
        recommended_side: bestSide,
        score_breakdown: bestBreakdown,
      });
      scored++;
    }

    // Batch update
    for (const update of updates) {
      await supabase
        .from('game_bets')
        .update({
          composite_score: update.composite_score,
          recommended_side: update.recommended_side,
          score_breakdown: update.score_breakdown,
        })
        .eq('id', update.id);
    }

    const highQuality = updates.filter(u => u.composite_score >= 62).length;
    const avgScore = updates.length > 0
      ? Math.round(updates.reduce((s, u) => s + u.composite_score, 0) / updates.length)
      : 0;

    const summary = {
      scored,
      highQuality,
      avgScore,
      sportBreakdown: {
        ncaab: updates.filter(u => bets.find((b: any) => b.id === u.id)?.sport?.includes('ncaab')).length,
        nhl: updates.filter(u => bets.find((b: any) => b.id === u.id)?.sport?.includes('nhl')).length,
        other: updates.filter(u => {
          const sport = bets.find((b: any) => b.id === u.id)?.sport || '';
          return !sport.includes('ncaab') && !sport.includes('nhl');
        }).length,
      },
    };

    console.log('[Scoring Engine] Complete:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Scoring Engine] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

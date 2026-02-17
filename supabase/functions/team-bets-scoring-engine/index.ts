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
  kenpom_adj_o: number | null;
  kenpom_adj_d: number | null;
  sos_rank: number | null;
  kenpom_source: string | null;
}

interface NcaabGameReferee {
  game_date: string;
  home_team: string;
  away_team: string;
  referee_names: string[] | null;
  expected_pace_impact: number;
  expected_total_adjustment: number;
}

interface NcaabFatigueScore {
  team_name: string;
  fatigue_score: number;
  fatigue_category: string;
  is_back_to_back: boolean;
  travel_miles: number;
  is_altitude_game: boolean;
  altitude_differential: number;
  game_date: string;
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
  ncaabMap: Map<string, NcaabTeamStats>,
  refMap: Map<string, NcaabGameReferee>,
  fatigueMap: Map<string, NcaabFatigueScore>
): { score: number; breakdown: Record<string, number | string> } {
  let score = 50;
  const breakdown: Record<string, number | string> = { base: 50 };

  const homeStats = resolveNcaabTeam(bet.home_team, ncaabMap);
  const awayStats = resolveNcaabTeam(bet.away_team, ncaabMap);

  if (!homeStats && !awayStats) {
    breakdown.no_data = 0;
    return { score: 55, breakdown };
  }

  // Use real KenPom AdjO/AdjD if available, fall back to ESPN-derived
  const homeOff = homeStats?.kenpom_adj_o || homeStats?.adj_offense || 70;
  const homeDef = homeStats?.kenpom_adj_d || homeStats?.adj_defense || 70;
  const awayOff = awayStats?.kenpom_adj_o || awayStats?.adj_offense || 70;
  const awayDef = awayStats?.kenpom_adj_d || awayStats?.adj_defense || 70;
  const homeRank = homeStats?.kenpom_rank || 200;
  const awayRank = awayStats?.kenpom_rank || 200;
  const homeTempo = homeStats?.adj_tempo || 67;
  const awayTempo = awayStats?.adj_tempo || 67;

  // Flag if we have real KenPom data
  const hasRealKenpom = homeStats?.kenpom_source === 'kenpom' || homeStats?.kenpom_source === 'barttorvik' ||
                        awayStats?.kenpom_source === 'kenpom' || awayStats?.kenpom_source === 'barttorvik';
  if (hasRealKenpom) breakdown.kenpom_source = 'real';

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

  // ============= FATIGUE & ALTITUDE ADJUSTMENTS =============
  const sideTeamName = side === 'HOME' ? bet.home_team : bet.away_team;
  const oppTeamName = side === 'HOME' ? bet.away_team : bet.home_team;
  const sideFatigue = fatigueMap.get(sideTeamName);
  const oppFatigue = fatigueMap.get(oppTeamName);

  if (sideFatigue && sideFatigue.fatigue_score >= 30) {
    const fatiguePenalty = clampScore(-10, 0, -Math.round(sideFatigue.fatigue_score * 0.2));
    score += fatiguePenalty;
    breakdown.fatigue_penalty = fatiguePenalty;
    breakdown.fatigue_label = `${sideFatigue.fatigue_category} (${sideFatigue.fatigue_score})`;
  }

  if (oppFatigue && oppFatigue.fatigue_score >= 30) {
    const oppFatigueBonus = clampScore(0, 6, Math.round(oppFatigue.fatigue_score * 0.15));
    score += oppFatigueBonus;
    breakdown.opp_fatigue_boost = oppFatigueBonus;
  }

  // Altitude impact (away team at altitude)
  if (sideFatigue?.is_altitude_game && sideFatigue.altitude_differential > 2000 && side !== 'HOME') {
    const altPenalty = clampScore(-6, 0, -Math.round(sideFatigue.altitude_differential / 1000));
    score += altPenalty;
    breakdown.altitude_impact = altPenalty;
    breakdown.altitude_label = `+${sideFatigue.altitude_differential}ft`;
  }

  if (bet.bet_type === 'spread') {
    const homeNetAdv = (homeOff - awayDef) - (awayOff - homeDef);
    const sideAdv = side === 'HOME' ? homeNetAdv : -homeNetAdv;
    const effBonus = clampScore(-15, 15, sideAdv * 1.0);
    score += effBonus;
    breakdown.efficiency_edge = effBonus;
    if (effBonus > 5) breakdown.efficiency_label = `+${sideAdv.toFixed(1)} pts edge`;

    if (side === 'HOME') { score += 8; breakdown.home_court = 8; } // Increased from 5

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
    
    // --- Tempo thresholds ---
    if (side === 'OVER' && avgTempo >= 67) {
      const paceBonus = clampScore(0, 18, Math.round((avgTempo - 65) * 4));
      score += paceBonus;
      breakdown.tempo_fast = paceBonus;
      breakdown.tempo_label = `Combined tempo: ${avgTempo.toFixed(1)} (fast)`;
    } else if (side === 'UNDER' && avgTempo < 67) {
      const paceBonus = clampScore(0, 18, Math.round((67 - avgTempo) * 5));
      score += paceBonus;
      breakdown.tempo_slow = paceBonus;
      breakdown.tempo_label = `Combined tempo: ${avgTempo.toFixed(1)} (slow)`;
    }
    if ((side === 'OVER' && avgTempo < 62) || (side === 'UNDER' && avgTempo > 72)) {
      score -= 12;
      breakdown.tempo_mismatch = -12;
    }

    // --- KenPom Projected Total (real efficiency-based) ---
    const tempoFactor = avgTempo / 67;
    let projectedTotal: number;
    if (hasRealKenpom) {
      // Real KenPom: (AdjO_home + AdjO_away) * tempo / 100 is standard method
      // But we need to account for both sides' offense vs opponent defense
      projectedTotal = ((homeOff + awayOff) * tempoFactor / 100) * 2;
      // Clamp to reasonable range
      projectedTotal = Math.max(100, Math.min(200, projectedTotal));
    } else {
      // Fallback defense-adjusted formula
      const avgD1PPG = 70;
      projectedTotal = (homeOff + awayOff - homeDef - awayDef + avgD1PPG * 2) * tempoFactor;
    }
    
    const lineEdge = projectedTotal - (bet.line || 0);
    breakdown.projected_total = Math.round(projectedTotal * 10) / 10;

    if (side === 'OVER' && lineEdge < -5) {
      const penalty = clampScore(-15, 0, Math.round(lineEdge * 2));
      score += penalty;
      breakdown.line_inflated = penalty;
      breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (inflated)`;
    } else if (side === 'UNDER' && lineEdge < -3) {
      const bonus = clampScore(0, 12, Math.round(Math.abs(lineEdge) * 2));
      score += bonus;
      breakdown.line_value = bonus;
      breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (value under)`;
    } else if (side === 'OVER' && lineEdge > 3) {
      score += 5;
      breakdown.line_value = 5;
      breakdown.line_edge_label = `Proj ${projectedTotal.toFixed(0)} vs Line ${bet.line} (value over)`;
    }

    const combinedOff = homeOff + awayOff;
    const combinedDef = homeDef + awayDef;
    if (side === 'OVER' && combinedOff > 148) { score += 5; breakdown.high_scoring = 5; }
    if (side === 'UNDER' && combinedDef < 128) { score += 5; breakdown.strong_defense = 5; }

    // Conference game UNDER boost
    if (side === 'UNDER' && homeStats?.conference && awayStats?.conference && 
        homeStats.conference === awayStats.conference && avgTempo < 67) {
      score += 8;
      breakdown.conference_under = 8;
      breakdown.conference_label = `Conference game + slow tempo`;
    }

    // ============= REFEREE ADJUSTMENT =============
    const gameKey = `${bet.home_team}|${bet.away_team}`;
    const refData = refMap.get(gameKey);
    if (refData && refData.expected_total_adjustment !== 0) {
      const refAdj = refData.expected_total_adjustment;
      if (side === 'OVER' && refAdj > 0.5) {
        const bonus = clampScore(0, 6, Math.round(refAdj * 3));
        score += bonus;
        breakdown.referee_adjustment = bonus;
        breakdown.referee_label = 'High-foul ref crew';
      } else if (side === 'UNDER' && refAdj < -0.5) {
        const bonus = clampScore(0, 6, Math.round(Math.abs(refAdj) * 3));
        score += bonus;
        breakdown.referee_adjustment = bonus;
        breakdown.referee_label = 'Low-foul ref crew';
      } else if (side === 'OVER' && refAdj < -0.5) {
        score -= 4;
        breakdown.referee_penalty = -4;
        breakdown.referee_label = 'Low-foul ref crew (bad for over)';
      } else if (side === 'UNDER' && refAdj > 0.5) {
        score -= 4;
        breakdown.referee_penalty = -4;
        breakdown.referee_label = 'High-foul ref crew (bad for under)';
      }
    }

    // Fatigue boosts UNDER
    const anyHighFatigue = (sideFatigue && sideFatigue.fatigue_score >= 25) || (oppFatigue && oppFatigue.fatigue_score >= 25);
    if (side === 'UNDER' && anyHighFatigue) {
      score += 5;
      breakdown.fatigue_under_boost = 5;
    }

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

    if (side === 'HOME') { score += 8; breakdown.home_court = 8; } // Increased from 6

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

// ============= NCAA BASEBALL SCORING =============
interface BaseballTeamStats {
  team_name: string;
  conference: string | null;
  national_rank: number | null;
  runs_per_game: number | null;
  runs_allowed_per_game: number | null;
  era: number | null;
  batting_avg: number | null;
  home_record: string | null;
  away_record: string | null;
}

// Alias map: Odds API name -> ESPN name
const BASEBALL_TEAM_ALIASES: Record<string, string> = {
  'Wright St Raiders': 'Wright State Raiders',
  'Georgia St Panthers': 'Georgia State Panthers',
  'Kansas St Wildcats': 'Kansas State Wildcats',
  'Oregon St Beavers': 'Oregon State Beavers',
  'Oklahoma St Cowboys': 'Oklahoma State Cowboys',
  'Michigan St Spartans': 'Michigan State Spartans',
  'Mississippi St Bulldogs': 'Mississippi State Bulldogs',
  'Wichita St Shockers': 'Wichita State Shockers',
  'Fresno St Bulldogs': 'Fresno State Bulldogs',
  'San Diego St Aztecs': 'San Diego State Aztecs',
  'Boise St Broncos': 'Boise State Broncos',
  'Arizona St Sun Devils': 'Arizona State Sun Devils',
  'Penn St Nittany Lions': 'Penn State Nittany Lions',
  'Ohio St Buckeyes': 'Ohio State Buckeyes',
  'Iowa St Cyclones': 'Iowa State Cyclones',
  'NC State Wolfpack': 'NC State Wolfpack',
  'Army Knights': 'Army Black Knights',
  'UConn Huskies': 'Connecticut Huskies',
  'UMass Minutemen': 'Massachusetts Minutemen',
  'UTSA Roadrunners': 'UT San Antonio Roadrunners',
  'UCF Knights': 'UCF Knights',
  'SMU Mustangs': 'SMU Mustangs',
  'LSU Tigers': 'LSU Tigers',
  'USC Trojans': 'USC Trojans',
  'UCLA Bruins': 'UCLA Bruins',
  'BYU Cougars': 'BYU Cougars',
  'UNC Greensboro Spartans': 'UNC Greensboro Spartans',
  'UNC Wilmington Seahawks': 'UNC Wilmington Seahawks',
  'SE Missouri St Redhawks': 'Southeast Missouri State Redhawks',
  'S Illinois Salukis': 'Southern Illinois Salukis',
  'N Illinois Huskies': 'Northern Illinois Huskies',
  'E Kentucky Colonels': 'Eastern Kentucky Colonels',
  'W Kentucky Hilltoppers': 'Western Kentucky Hilltoppers',
  'FGCU Eagles': 'Florida Gulf Coast Eagles',
  'FIU Panthers': 'FIU Panthers',
  'FAU Owls': 'Florida Atlantic Owls',
};

function normalizeBaseballName(name: string): string {
  return name
    .replace(/\bSt\b/g, 'State')
    .replace(/\bN\.\s*/g, 'North ')
    .replace(/\bS\.\s*/g, 'South ')
    .replace(/\bW\.\s*/g, 'West ')
    .replace(/\bE\.\s*/g, 'East ')
    .trim();
}

function resolveBaseballTeam(teamName: string, statsMap: Map<string, BaseballTeamStats>): BaseballTeamStats | undefined {
  // Pass 1: Exact match
  let stats = statsMap.get(teamName);
  if (stats) return stats;

  // Pass 2: Alias lookup
  const alias = BASEBALL_TEAM_ALIASES[teamName];
  if (alias) {
    stats = statsMap.get(alias);
    if (stats) return stats;
  }

  // Pass 3: Normalized name ("St" -> "State", etc.)
  const normalized = normalizeBaseballName(teamName);
  stats = statsMap.get(normalized);
  if (stats) return stats;

  // Pass 4: School name substring (first word(s) before mascot)
  const words = teamName.split(' ');
  if (words.length >= 2) {
    const school = words.slice(0, -1).join(' ').toLowerCase();
    if (school.length >= 4) {
      for (const [key, val] of statsMap) {
        if (key.toLowerCase().startsWith(school)) return val;
      }
    }
  }

  return undefined;
}

function scoreBaseballNcaa(
  bet: GameBet,
  side: string,
  baseballMap: Map<string, BaseballTeamStats>
): { score: number; breakdown: Record<string, number | string> } {
  let score = 50;
  const breakdown: Record<string, number | string> = { base: 50 };

  const homeStats = resolveBaseballTeam(bet.home_team, baseballMap);
  const awayStats = resolveBaseballTeam(bet.away_team, baseballMap);

  if (!homeStats && !awayStats) {
    if (bet.sharp_score && bet.sharp_score >= 50) {
      score = bet.sharp_score;
      breakdown.sharp_only = bet.sharp_score - 50;
    }
    return { score: clampScore(30, 95, score), breakdown };
  }

  const homeRPG = homeStats?.runs_per_game || 4.5;
  const homeRA = homeStats?.runs_allowed_per_game || 4.5;
  const awayRPG = awayStats?.runs_per_game || 4.5;
  const awayRA = awayStats?.runs_allowed_per_game || 4.5;
  const homeRank = homeStats?.national_rank || 150;
  const awayRank = awayStats?.national_rank || 150;
  const homeERA = homeStats?.era || 4.50;
  const awayERA = awayStats?.era || 4.50;
  const homeBA = homeStats?.batting_avg || 0.260;
  const awayBA = awayStats?.batting_avg || 0.260;

  // Rank tier bonus
  const sideRank = side === 'HOME' ? homeRank : awayRank;
  if (sideRank <= 10) { score += 10; breakdown.elite_rank = 10; }
  else if (sideRank <= 25) { score += 7; breakdown.top25_rank = 7; }
  else if (sideRank <= 50) { score += 4; breakdown.top50_rank = 4; }
  else if (sideRank > 150) { score -= 10; breakdown.low_rank_penalty = -10; }

  if (bet.bet_type === 'spread' || bet.bet_type === 'h2h') {
    // Run differential edge
    const homeRunDiff = homeRPG - homeRA;
    const awayRunDiff = awayRPG - awayRA;
    const sideAdv = side === 'HOME' ? homeRunDiff - awayRunDiff : awayRunDiff - homeRunDiff;
    const runBonus = clampScore(-12, 12, sideAdv * 3);
    score += runBonus;
    breakdown.run_differential = runBonus;
    if (Math.abs(runBonus) > 3) breakdown.run_label = `${(side === 'HOME' ? homeRunDiff : awayRunDiff).toFixed(1)} run diff`;

    // Home field
    if (side === 'HOME') { score += 4; breakdown.home_field = 4; }

    // ERA advantage (lower = better pitching)
    const sideERA = side === 'HOME' ? homeERA : awayERA;
    const oppERA = side === 'HOME' ? awayERA : homeERA;
    if (sideERA < oppERA - 0.5) {
      const eraBonus = clampScore(0, 8, Math.round((oppERA - sideERA) * 4));
      score += eraBonus;
      breakdown.era_edge = eraBonus;
    }

    // Batting avg edge
    const sideBA = side === 'HOME' ? homeBA : awayBA;
    if (sideBA > 0.280) { score += 4; breakdown.strong_hitting = 4; }

    // Rank mismatch for ML
    if (bet.bet_type === 'h2h') {
      const rankDiff = side === 'HOME' ? awayRank - homeRank : homeRank - awayRank;
      if (rankDiff > 80) { score += 8; breakdown.rank_mismatch = 8; }
      else if (rankDiff > 40) { score += 4; breakdown.rank_edge = 4; }
    }
  }

  if (bet.bet_type === 'total') {
    const combinedRPG = homeRPG + awayRPG;
    const avgERA = (homeERA + awayERA) / 2;

    if (side === 'OVER') {
      if (combinedRPG > 10) {
        const bonus = clampScore(0, 12, Math.round((combinedRPG - 9) * 6));
        score += bonus;
        breakdown.high_scoring = bonus;
        breakdown.scoring_label = `Combined ${combinedRPG.toFixed(1)} RPG`;
      }
      if (avgERA > 5.0) { score += 5; breakdown.weak_pitching = 5; }
      if (homeBA > 0.270 && awayBA > 0.270) { score += 4; breakdown.both_hitting = 4; }
    }
    if (side === 'UNDER') {
      if (combinedRPG < 8) {
        const bonus = clampScore(0, 12, Math.round((9 - combinedRPG) * 6));
        score += bonus;
        breakdown.low_scoring = bonus;
        breakdown.scoring_label = `Combined ${combinedRPG.toFixed(1)} RPG`;
      }
      if (avgERA < 3.5) {
        const bonus = clampScore(0, 8, Math.round((4.0 - avgERA) * 8));
        score += bonus;
        breakdown.strong_pitching = bonus;
      }
    }
  }

  // Sharp confirmation
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

    // Fetch active game_bets (include games from today, even if already started)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data: bets, error: betsErr } = await supabase
      .from('game_bets')
      .select('*')
      .eq('is_active', true)
      .gte('commence_time', todayStart.toISOString());

    if (betsErr) throw betsErr;
    if (!bets || bets.length === 0) {
      return new Response(JSON.stringify({ message: 'No active bets to score', scored: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Scoring Engine] Found ${bets.length} active bets to score`);

    // Load NCAAB stats (with real KenPom data)
    const { data: ncaabStats } = await supabase
      .from('ncaab_team_stats')
      .select('team_name, conference, kenpom_rank, adj_offense, adj_defense, adj_tempo, home_record, away_record, ats_record, over_under_record, kenpom_adj_o, kenpom_adj_d, sos_rank, kenpom_source');

    const ncaabMap = new Map<string, NcaabTeamStats>();
    (ncaabStats || []).forEach((s: any) => ncaabMap.set(s.team_name, s));

    // Load NCAAB referee data for today
    const todayDate = todayStart.toISOString().substring(0, 10);
    const { data: refData } = await supabase
      .from('ncaab_game_referees')
      .select('*')
      .eq('game_date', todayDate);

    const refMap = new Map<string, NcaabGameReferee>();
    (refData || []).forEach((r: any) => {
      refMap.set(`${r.home_team}|${r.away_team}`, r);
    });

    // Load NCAAB fatigue scores for today
    const { data: fatigueData } = await supabase
      .from('ncaab_fatigue_scores')
      .select('*')
      .eq('game_date', todayDate);

    const fatigueMap = new Map<string, NcaabFatigueScore>();
    (fatigueData || []).forEach((f: any) => fatigueMap.set(f.team_name, f));

    console.log(`[Scoring Engine] NCAAB intelligence: ${ncaabMap.size} teams, ${refMap.size} ref assignments, ${fatigueMap.size} fatigue scores`);

    // Load NHL stats
    const { data: nhlStats } = await supabase
      .from('nhl_team_pace_stats')
      .select('*');

    const nhlMap = new Map<string, any>();
    (nhlStats || []).forEach((s: any) => {
      nhlMap.set(s.team_name, s);
      if (s.team_abbrev) nhlMap.set(s.team_abbrev, s);
    });

    // Load NCAA Baseball stats
    const { data: baseballStats } = await supabase
      .from('ncaa_baseball_team_stats')
      .select('team_name, conference, national_rank, runs_per_game, runs_allowed_per_game, era, batting_avg, home_record, away_record');

    const baseballMap = new Map<string, BaseballTeamStats>();
    (baseballStats || []).forEach((s: any) => baseballMap.set(s.team_name, s));

    // Score each bet with both sides, pick the better one
    let scored = 0;
    const updates: { id: string; composite_score: number; recommended_side: string; score_breakdown: any }[] = [];

    for (const bet of bets as GameBet[]) {
      const isNCAAB = bet.sport?.includes('ncaab') && !bet.sport?.includes('baseball');
      const isNHL = bet.sport?.includes('nhl') || bet.sport?.includes('hockey');
      const isBaseballNcaa = bet.sport?.includes('baseball_ncaa');

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
        if (isBaseballNcaa) {
          result = scoreBaseballNcaa(bet, side, baseballMap);
        } else if (isNCAAB) {
          result = scoreNcaab(bet, side, ncaabMap, refMap, fatigueMap);
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
        ncaab: updates.filter(u => bets.find((b: any) => b.id === u.id)?.sport?.includes('ncaab') && !bets.find((b: any) => b.id === u.id)?.sport?.includes('baseball')).length,
        nhl: updates.filter(u => bets.find((b: any) => b.id === u.id)?.sport?.includes('nhl')).length,
        baseball_ncaa: updates.filter(u => bets.find((b: any) => b.id === u.id)?.sport?.includes('baseball_ncaa')).length,
        other: updates.filter(u => {
          const sport = bets.find((b: any) => b.id === u.id)?.sport || '';
          return !sport.includes('ncaab') && !sport.includes('nhl') && !sport.includes('baseball');
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

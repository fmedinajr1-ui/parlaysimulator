import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CoachProfile {
  id: string;
  coach_name: string;
  team_name: string;
  sport: string;
  tenure_start_date: string;
  tenure_end_date: string | null;
  is_active: boolean;
  // NBA
  pace_preference: string | null;
  rotation_depth: number | null;
  star_usage_pct: number | null;
  b2b_rest_tendency: string | null;
  fourth_quarter_pattern: string | null;
  blowout_minutes_reduction: number | null;
  // NFL
  run_pass_tendency: string | null;
  fourth_down_aggression: string | null;
  garbage_time_behavior: string | null;
  qb_usage_style: string | null;
  red_zone_tendency: string | null;
  // NHL
  line_matching: string | null;
  goalie_pull_tendency: string | null;
  pp_aggression: string | null;
  empty_net_tendency: string | null;
  // MLB
  bullpen_usage: string | null;
  lineup_consistency: string | null;
  platoon_tendency: string | null;
  pinch_hit_frequency: string | null;
}

interface CoachTendencySignal {
  coachName: string;
  teamName: string;
  sport: string;
  tenureMonths: number;
  recommendation: 'pick' | 'fade' | 'neutral';
  confidence: number;
  reasoning: string;
  propAdjustments: Record<string, number>;
}

function calculateTenureMonths(startDate: string, endDate?: string | null): number {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(1, months);
}

// NBA Analysis
function analyzeNBACoach(coach: CoachProfile, propType: string): CoachTendencySignal {
  const tenureMonths = calculateTenureMonths(coach.tenure_start_date, coach.tenure_end_date);
  let recommendation: 'pick' | 'fade' | 'neutral' = 'neutral';
  let confidence = 0.5;
  let reasoning = '';
  const propAdjustments: Record<string, number> = { points: 0, rebounds: 0, assists: 0, minutes: 0 };

  if (propType.includes('points')) {
    if (coach.pace_preference === 'fast') {
      recommendation = 'pick';
      confidence = 0.65;
      reasoning = `${coach.coach_name} runs a fast pace system, favorable for overs`;
      propAdjustments.points = 3;
    } else if (coach.pace_preference === 'slow') {
      recommendation = 'fade';
      confidence = 0.6;
      reasoning = `${coach.coach_name} runs a slow pace system, lean under`;
      propAdjustments.points = -3;
    }
  }

  if (propType.includes('minutes')) {
    if (coach.rotation_depth && coach.rotation_depth >= 10) {
      recommendation = 'fade';
      confidence = 0.6;
      reasoning = `${coach.coach_name} uses deep rotation (${coach.rotation_depth} players)`;
      propAdjustments.minutes = -3;
    } else if (coach.rotation_depth && coach.rotation_depth <= 7) {
      recommendation = 'pick';
      confidence = 0.65;
      reasoning = `${coach.coach_name} uses tight rotation (${coach.rotation_depth} players)`;
      propAdjustments.minutes = 3;
    }
  }

  if (tenureMonths < 6) {
    confidence *= 0.7;
    reasoning += ' (new coach - limited data)';
  }

  return { coachName: coach.coach_name, teamName: coach.team_name, sport: 'NBA', tenureMonths, recommendation, confidence, reasoning, propAdjustments };
}

// NFL Analysis
function analyzeNFLCoach(coach: CoachProfile, propType: string): CoachTendencySignal {
  const tenureMonths = calculateTenureMonths(coach.tenure_start_date, coach.tenure_end_date);
  let recommendation: 'pick' | 'fade' | 'neutral' = 'neutral';
  let confidence = 0.5;
  let reasoning = '';
  const propAdjustments: Record<string, number> = { passing_yards: 0, rushing_yards: 0, receptions: 0, touchdowns: 0 };

  if (propType.includes('pass') || propType.includes('yard')) {
    if (coach.run_pass_tendency === 'pass_heavy') {
      recommendation = 'pick';
      confidence = 0.65;
      reasoning = `${coach.coach_name} runs a pass-heavy offense`;
      propAdjustments.passing_yards = 25;
      propAdjustments.receptions = 2;
    } else if (coach.run_pass_tendency === 'run_heavy') {
      recommendation = 'fade';
      confidence = 0.6;
      reasoning = `${coach.coach_name} establishes the run first`;
      propAdjustments.passing_yards = -20;
    }
  }

  if (propType.includes('rush')) {
    if (coach.run_pass_tendency === 'run_heavy') {
      recommendation = 'pick';
      confidence = 0.65;
      reasoning = `${coach.coach_name} commits to the running game`;
      propAdjustments.rushing_yards = 20;
    } else if (coach.run_pass_tendency === 'pass_heavy') {
      recommendation = 'fade';
      confidence = 0.55;
      reasoning = `${coach.coach_name} de-emphasizes the run`;
      propAdjustments.rushing_yards = -15;
    }
  }

  if (coach.fourth_down_aggression === 'aggressive') {
    propAdjustments.touchdowns = 1;
    reasoning += reasoning ? '. Also aggressive on 4th down' : `${coach.coach_name} is aggressive on 4th down`;
  }

  if (tenureMonths < 6) {
    confidence *= 0.7;
    reasoning += ' (new coach)';
  }

  return { coachName: coach.coach_name, teamName: coach.team_name, sport: 'NFL', tenureMonths, recommendation, confidence, reasoning, propAdjustments };
}

// NHL Analysis
function analyzeNHLCoach(coach: CoachProfile, propType: string): CoachTendencySignal {
  const tenureMonths = calculateTenureMonths(coach.tenure_start_date, coach.tenure_end_date);
  let recommendation: 'pick' | 'fade' | 'neutral' = 'neutral';
  let confidence = 0.5;
  let reasoning = '';
  const propAdjustments: Record<string, number> = { goals: 0, assists: 0, shots: 0, saves: 0, ice_time: 0 };

  if (propType.includes('goal') || propType.includes('point')) {
    if (coach.pp_aggression === 'aggressive') {
      recommendation = 'pick';
      confidence = 0.6;
      reasoning = `${coach.coach_name} runs an aggressive power play`;
      propAdjustments.goals = 0.3;
      propAdjustments.shots = 2;
    }
  }

  if (coach.line_matching === 'heavy') {
    propAdjustments.ice_time = -2;
    reasoning += reasoning ? '. Heavy line matching limits star ice time' : `${coach.coach_name} matches lines heavily`;
  } else if (coach.line_matching === 'minimal') {
    propAdjustments.ice_time = 2;
  }

  if (coach.goalie_pull_tendency === 'early') {
    propAdjustments.goals = (propAdjustments.goals || 0) + 0.5;
  }

  if (tenureMonths < 6) {
    confidence *= 0.7;
    reasoning += ' (new coach)';
  }

  return { coachName: coach.coach_name, teamName: coach.team_name, sport: 'NHL', tenureMonths, recommendation, confidence, reasoning, propAdjustments };
}

// MLB Analysis
function analyzeMLBCoach(coach: CoachProfile, propType: string): CoachTendencySignal {
  const tenureMonths = calculateTenureMonths(coach.tenure_start_date, coach.tenure_end_date);
  let recommendation: 'pick' | 'fade' | 'neutral' = 'neutral';
  let confidence = 0.5;
  let reasoning = '';
  const propAdjustments: Record<string, number> = { strikeouts: 0, hits: 0, runs: 0, rbis: 0, innings: 0 };

  if (propType.includes('strikeout') || propType.includes('k')) {
    if (coach.bullpen_usage === 'starter_focused') {
      recommendation = 'pick';
      confidence = 0.65;
      reasoning = `${coach.coach_name} lets starters work deep into games`;
      propAdjustments.strikeouts = 1;
      propAdjustments.innings = 1;
    } else if (coach.bullpen_usage === 'heavy') {
      recommendation = 'fade';
      confidence = 0.6;
      reasoning = `${coach.coach_name} has a quick hook with starters`;
      propAdjustments.strikeouts = -1;
      propAdjustments.innings = -1;
    }
  }

  if (coach.lineup_consistency === 'platoon_heavy') {
    propAdjustments.hits = -1;
    reasoning += reasoning ? '. Heavy platoon usage affects consistency' : `${coach.coach_name} uses heavy platoons`;
  }

  if (tenureMonths < 6) {
    confidence *= 0.7;
    reasoning += ' (new manager)';
  }

  return { coachName: coach.coach_name, teamName: coach.team_name, sport: 'MLB', tenureMonths, recommendation, confidence, reasoning, propAdjustments };
}

async function analyzeCoachTendencies(supabase: any, teamName: string, sport: string, propType: string): Promise<CoachTendencySignal | null> {
  console.log(`Analyzing coaching tendencies for ${teamName}, sport: ${sport}, prop: ${propType}`);
  
  const { data: coach, error: coachError } = await supabase
    .from('coach_profiles')
    .select('*')
    .eq('team_name', teamName)
    .eq('is_active', true)
    .maybeSingle();
  
  if (coachError || !coach) {
    console.log(`No active coach found for ${teamName}`);
    return null;
  }

  const sportKey = coach.sport?.toLowerCase() || '';
  
  if (sportKey.includes('nfl') || sportKey.includes('football')) {
    return analyzeNFLCoach(coach, propType);
  } else if (sportKey.includes('nhl') || sportKey.includes('hockey')) {
    return analyzeNHLCoach(coach, propType);
  } else if (sportKey.includes('mlb') || sportKey.includes('baseball')) {
    return analyzeMLBCoach(coach, propType);
  } else {
    return analyzeNBACoach(coach, propType);
  }
}

async function seedNBACoaches(supabase: any): Promise<{ seeded: number }> {
  console.log('Seeding NBA coaches...');
  
  const nbaCoaches = [
    { coach_name: 'Erik Spoelstra', team_name: 'Miami Heat', tenure_start_date: '2008-04-28', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Steve Kerr', team_name: 'Golden State Warriors', tenure_start_date: '2014-05-19', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Gregg Popovich', team_name: 'San Antonio Spurs', tenure_start_date: '1996-12-10', pace_preference: 'slow', rotation_depth: 10, star_usage_pct: 45, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Joe Mazzulla', team_name: 'Boston Celtics', tenure_start_date: '2022-09-23', pace_preference: 'fast', rotation_depth: 8, star_usage_pct: 60, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Tyronn Lue', team_name: 'Los Angeles Clippers', tenure_start_date: '2020-10-20', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Mike Budenholzer', team_name: 'Phoenix Suns', tenure_start_date: '2023-06-03', pace_preference: 'moderate', rotation_depth: 8, star_usage_pct: 58, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Doc Rivers', team_name: 'Milwaukee Bucks', tenure_start_date: '2023-01-26', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Tom Thibodeau', team_name: 'New York Knicks', tenure_start_date: '2020-07-30', pace_preference: 'slow', rotation_depth: 7, star_usage_pct: 65, b2b_rest_tendency: 'aggressive' },
    { coach_name: 'JJ Redick', team_name: 'Los Angeles Lakers', tenure_start_date: '2024-06-20', pace_preference: 'fast', rotation_depth: 8, star_usage_pct: 60, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Monty Williams', team_name: 'Detroit Pistons', tenure_start_date: '2023-06-13', pace_preference: 'moderate', rotation_depth: 10, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Nick Nurse', team_name: 'Philadelphia 76ers', tenure_start_date: '2023-06-13', pace_preference: 'moderate', rotation_depth: 8, star_usage_pct: 62, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Michael Malone', team_name: 'Denver Nuggets', tenure_start_date: '2015-06-15', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Taylor Jenkins', team_name: 'Memphis Grizzlies', tenure_start_date: '2019-06-11', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 52, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Ime Udoka', team_name: 'Houston Rockets', tenure_start_date: '2023-04-19', pace_preference: 'moderate', rotation_depth: 10, star_usage_pct: 48, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Rick Carlisle', team_name: 'Indiana Pacers', tenure_start_date: '2021-06-24', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Jason Kidd', team_name: 'Dallas Mavericks', tenure_start_date: '2021-06-28', pace_preference: 'fast', rotation_depth: 8, star_usage_pct: 65, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Charles Lee', team_name: 'Charlotte Hornets', tenure_start_date: '2024-06-17', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Brian Keefe', team_name: 'Washington Wizards', tenure_start_date: '2024-03-21', pace_preference: 'moderate', rotation_depth: 10, star_usage_pct: 48, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Kenny Atkinson', team_name: 'Cleveland Cavaliers', tenure_start_date: '2024-07-01', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Quin Snyder', team_name: 'Atlanta Hawks', tenure_start_date: '2023-02-26', pace_preference: 'moderate', rotation_depth: 8, star_usage_pct: 58, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Mark Daigneault', team_name: 'Oklahoma City Thunder', tenure_start_date: '2020-11-11', pace_preference: 'fast', rotation_depth: 10, star_usage_pct: 48, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Chris Finch', team_name: 'Minnesota Timberwolves', tenure_start_date: '2021-02-22', pace_preference: 'moderate', rotation_depth: 8, star_usage_pct: 58, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Willie Green', team_name: 'New Orleans Pelicans', tenure_start_date: '2021-07-22', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Chauncey Billups', team_name: 'Portland Trail Blazers', tenure_start_date: '2021-06-29', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 52, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Will Hardy', team_name: 'Utah Jazz', tenure_start_date: '2022-06-28', pace_preference: 'fast', rotation_depth: 10, star_usage_pct: 45, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Mike Brown', team_name: 'Sacramento Kings', tenure_start_date: '2022-05-09', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Jordi Fernandez', team_name: 'Brooklyn Nets', tenure_start_date: '2024-01-26', pace_preference: 'moderate', rotation_depth: 10, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Jamahl Mosley', team_name: 'Orlando Magic', tenure_start_date: '2021-07-08', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Darko Rajaković', team_name: 'Toronto Raptors', tenure_start_date: '2023-06-15', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Billy Donovan', team_name: 'Chicago Bulls', tenure_start_date: '2020-09-22', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
  ];
  
  let seeded = 0;
  
  for (const coach of nbaCoaches) {
    const { error } = await supabase
      .from('coach_profiles')
      .upsert({
        ...coach,
        sport: 'basketball_nba',
        is_active: true,
        fourth_quarter_pattern: 'balanced',
        blowout_minutes_reduction: 15
      }, { onConflict: 'coach_name,team_name' });
    
    if (!error) seeded++;
  }
  
  console.log(`Seeded ${seeded} NBA coaches`);
  return { seeded };
}

async function seedNFLCoaches(supabase: any): Promise<{ seeded: number }> {
  console.log('Seeding NFL coaches...');
  
  const nflCoaches = [
    { coach_name: 'Andy Reid', team_name: 'Kansas City Chiefs', tenure_start_date: '2013-01-07', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'rests_starters', qb_usage_style: 'pocket_passer', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'John Harbaugh', team_name: 'Baltimore Ravens', tenure_start_date: '2008-01-19', run_pass_tendency: 'balanced', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'situational', qb_usage_style: 'dual_threat', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Kyle Shanahan', team_name: 'San Francisco 49ers', tenure_start_date: '2017-02-06', run_pass_tendency: 'run_heavy', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Sean McVay', team_name: 'Los Angeles Rams', tenure_start_date: '2017-01-12', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'rests_starters', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Mike Tomlin', team_name: 'Pittsburgh Steelers', tenure_start_date: '2007-01-22', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'plays_through', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Bill Belichick', team_name: 'New England Patriots', tenure_start_date: '2000-01-27', run_pass_tendency: 'balanced', fourth_down_aggression: 'conservative', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Kevin Stefanski', team_name: 'Cleveland Browns', tenure_start_date: '2020-01-13', run_pass_tendency: 'run_heavy', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Matt LaFleur', team_name: 'Green Bay Packers', tenure_start_date: '2019-01-08', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'dual_threat', red_zone_tendency: 'balanced' },
    { coach_name: 'Dan Campbell', team_name: 'Detroit Lions', tenure_start_date: '2021-01-20', run_pass_tendency: 'balanced', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'plays_through', qb_usage_style: 'pocket_passer', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Nick Sirianni', team_name: 'Philadelphia Eagles', tenure_start_date: '2021-01-24', run_pass_tendency: 'run_heavy', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'situational', qb_usage_style: 'dual_threat', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Sean Payton', team_name: 'Denver Broncos', tenure_start_date: '2023-02-05', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'Mike McDaniel', team_name: 'Miami Dolphins', tenure_start_date: '2022-02-06', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'plays_through', qb_usage_style: 'pocket_passer', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'DeMeco Ryans', team_name: 'Houston Texans', tenure_start_date: '2023-02-02', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'dual_threat', red_zone_tendency: 'balanced' },
    { coach_name: 'Brian Daboll', team_name: 'New York Giants', tenure_start_date: '2022-01-28', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Robert Saleh', team_name: 'New York Jets', tenure_start_date: '2021-01-21', run_pass_tendency: 'run_heavy', fourth_down_aggression: 'conservative', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Mike McCarthy', team_name: 'Dallas Cowboys', tenure_start_date: '2020-01-08', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'Pete Carroll', team_name: 'Seattle Seahawks', tenure_start_date: '2010-01-11', run_pass_tendency: 'run_heavy', fourth_down_aggression: 'conservative', garbage_time_behavior: 'plays_through', qb_usage_style: 'dual_threat', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Todd Bowles', team_name: 'Tampa Bay Buccaneers', tenure_start_date: '2022-03-31', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'conservative', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'Jonathan Gannon', team_name: 'Arizona Cardinals', tenure_start_date: '2023-02-16', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'dual_threat', red_zone_tendency: 'balanced' },
    { coach_name: 'Shane Steichen', team_name: 'Indianapolis Colts', tenure_start_date: '2023-02-14', run_pass_tendency: 'run_heavy', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Dennis Allen', team_name: 'New Orleans Saints', tenure_start_date: '2022-02-08', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Kevin O\'Connell', team_name: 'Minnesota Vikings', tenure_start_date: '2022-02-17', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'Doug Pederson', team_name: 'Jacksonville Jaguars', tenure_start_date: '2022-02-03', run_pass_tendency: 'balanced', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Zac Taylor', team_name: 'Cincinnati Bengals', tenure_start_date: '2019-02-04', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'Sean McDermott', team_name: 'Buffalo Bills', tenure_start_date: '2017-01-11', run_pass_tendency: 'pass_heavy', fourth_down_aggression: 'aggressive', garbage_time_behavior: 'rests_starters', qb_usage_style: 'dual_threat', red_zone_tendency: 'pass_heavy' },
    { coach_name: 'Dave Canales', team_name: 'Carolina Panthers', tenure_start_date: '2024-01-25', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'dual_threat', red_zone_tendency: 'balanced' },
    { coach_name: 'Raheem Morris', team_name: 'Atlanta Falcons', tenure_start_date: '2024-01-22', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Antonio Pierce', team_name: 'Las Vegas Raiders', tenure_start_date: '2024-01-26', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Jim Harbaugh', team_name: 'Los Angeles Chargers', tenure_start_date: '2024-01-24', run_pass_tendency: 'run_heavy', fourth_down_aggression: 'moderate', garbage_time_behavior: 'plays_through', qb_usage_style: 'pocket_passer', red_zone_tendency: 'run_heavy' },
    { coach_name: 'Jerod Mayo', team_name: 'New England Patriots', tenure_start_date: '2024-01-17', run_pass_tendency: 'balanced', fourth_down_aggression: 'moderate', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
    { coach_name: 'Matt Eberflus', team_name: 'Chicago Bears', tenure_start_date: '2022-01-27', run_pass_tendency: 'balanced', fourth_down_aggression: 'conservative', garbage_time_behavior: 'situational', qb_usage_style: 'dual_threat', red_zone_tendency: 'balanced' },
    { coach_name: 'Ron Rivera', team_name: 'Washington Commanders', tenure_start_date: '2020-01-01', run_pass_tendency: 'balanced', fourth_down_aggression: 'conservative', garbage_time_behavior: 'situational', qb_usage_style: 'pocket_passer', red_zone_tendency: 'balanced' },
  ];
  
  let seeded = 0;
  
  for (const coach of nflCoaches) {
    const { error } = await supabase
      .from('coach_profiles')
      .upsert({
        ...coach,
        sport: 'americanfootball_nfl',
        is_active: true
      }, { onConflict: 'coach_name,team_name' });
    
    if (!error) seeded++;
  }
  
  console.log(`Seeded ${seeded} NFL coaches`);
  return { seeded };
}

async function seedNHLCoaches(supabase: any): Promise<{ seeded: number }> {
  console.log('Seeding NHL coaches...');
  
  const nhlCoaches = [
    { coach_name: 'Jon Cooper', team_name: 'Tampa Bay Lightning', tenure_start_date: '2013-03-25', line_matching: 'heavy', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Mike Sullivan', team_name: 'Pittsburgh Penguins', tenure_start_date: '2015-12-12', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'aggressive', empty_net_tendency: 'normal' },
    { coach_name: 'Peter Laviolette', team_name: 'New York Rangers', tenure_start_date: '2023-06-08', line_matching: 'heavy', goalie_pull_tendency: 'normal', pp_aggression: 'aggressive', empty_net_tendency: 'normal' },
    { coach_name: 'Jim Montgomery', team_name: 'Boston Bruins', tenure_start_date: '2022-07-01', line_matching: 'moderate', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Bruce Cassidy', team_name: 'Vegas Golden Knights', tenure_start_date: '2022-06-14', line_matching: 'moderate', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Jared Bednar', team_name: 'Colorado Avalanche', tenure_start_date: '2016-08-25', line_matching: 'minimal', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Rod Brind\'Amour', team_name: 'Carolina Hurricanes', tenure_start_date: '2018-05-08', line_matching: 'heavy', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Sheldon Keefe', team_name: 'New Jersey Devils', tenure_start_date: '2024-05-23', line_matching: 'minimal', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Paul Maurice', team_name: 'Florida Panthers', tenure_start_date: '2022-06-22', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'aggressive', empty_net_tendency: 'normal' },
    { coach_name: 'Craig Berube', team_name: 'Toronto Maple Leafs', tenure_start_date: '2024-05-17', line_matching: 'heavy', goalie_pull_tendency: 'late', pp_aggression: 'moderate', empty_net_tendency: 'conservative' },
    { coach_name: 'Rick Tocchet', team_name: 'Vancouver Canucks', tenure_start_date: '2023-01-22', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'aggressive', empty_net_tendency: 'normal' },
    { coach_name: 'Lindy Ruff', team_name: 'Buffalo Sabres', tenure_start_date: '2024-04-23', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Derek Lalonde', team_name: 'Detroit Red Wings', tenure_start_date: '2022-07-01', line_matching: 'minimal', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'John Tortorella', team_name: 'Philadelphia Flyers', tenure_start_date: '2022-06-17', line_matching: 'heavy', goalie_pull_tendency: 'late', pp_aggression: 'conservative', empty_net_tendency: 'conservative' },
    { coach_name: 'Dave Hakstol', team_name: 'Seattle Kraken', tenure_start_date: '2021-06-24', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Kris Knoblauch', team_name: 'Edmonton Oilers', tenure_start_date: '2023-11-12', line_matching: 'minimal', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Rick Bowness', team_name: 'Winnipeg Jets', tenure_start_date: '2022-07-03', line_matching: 'moderate', goalie_pull_tendency: 'late', pp_aggression: 'moderate', empty_net_tendency: 'conservative' },
    { coach_name: 'John Hynes', team_name: 'Nashville Predators', tenure_start_date: '2020-01-07', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Andre Tourigny', team_name: 'Utah Hockey Club', tenure_start_date: '2021-07-01', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Martin St. Louis', team_name: 'Montreal Canadiens', tenure_start_date: '2022-02-09', line_matching: 'minimal', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Travis Green', team_name: 'Ottawa Senators', tenure_start_date: '2023-12-28', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Jim Hiller', team_name: 'Los Angeles Kings', tenure_start_date: '2023-12-11', line_matching: 'heavy', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Ryan Warsofsky', team_name: 'San Jose Sharks', tenure_start_date: '2024-05-20', line_matching: 'minimal', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Greg Cronin', team_name: 'Anaheim Ducks', tenure_start_date: '2023-07-05', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Jared McCann', team_name: 'Columbus Blue Jackets', tenure_start_date: '2024-05-27', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Scott Arniel', team_name: 'Winnipeg Jets', tenure_start_date: '2024-08-27', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Darryl Sutter', team_name: 'Calgary Flames', tenure_start_date: '2021-03-04', line_matching: 'heavy', goalie_pull_tendency: 'late', pp_aggression: 'conservative', empty_net_tendency: 'conservative' },
    { coach_name: 'Luke Richardson', team_name: 'Chicago Blackhawks', tenure_start_date: '2022-06-27', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Patrick Roy', team_name: 'New York Islanders', tenure_start_date: '2024-01-17', line_matching: 'heavy', goalie_pull_tendency: 'early', pp_aggression: 'aggressive', empty_net_tendency: 'aggressive' },
    { coach_name: 'Pete DeBoer', team_name: 'Dallas Stars', tenure_start_date: '2022-06-21', line_matching: 'heavy', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Drew Bannister', team_name: 'St. Louis Blues', tenure_start_date: '2023-12-13', line_matching: 'moderate', goalie_pull_tendency: 'normal', pp_aggression: 'moderate', empty_net_tendency: 'normal' },
    { coach_name: 'Dean Evason', team_name: 'Minnesota Wild', tenure_start_date: '2020-02-14', line_matching: 'heavy', goalie_pull_tendency: 'late', pp_aggression: 'conservative', empty_net_tendency: 'conservative' },
  ];
  
  let seeded = 0;
  
  for (const coach of nhlCoaches) {
    const { error } = await supabase
      .from('coach_profiles')
      .upsert({
        ...coach,
        sport: 'icehockey_nhl',
        is_active: true
      }, { onConflict: 'coach_name,team_name' });
    
    if (!error) seeded++;
  }
  
  console.log(`Seeded ${seeded} NHL coaches`);
  return { seeded };
}

async function seedMLBManagers(supabase: any): Promise<{ seeded: number }> {
  console.log('Seeding MLB managers...');
  
  const mlbManagers = [
    { coach_name: 'Dave Roberts', team_name: 'Los Angeles Dodgers', tenure_start_date: '2016-11-23', bullpen_usage: 'heavy', lineup_consistency: 'platoon_heavy', platoon_tendency: 'heavy', pinch_hit_frequency: 'high' },
    { coach_name: 'Aaron Boone', team_name: 'New York Yankees', tenure_start_date: '2017-12-06', bullpen_usage: 'heavy', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Alex Cora', team_name: 'Boston Red Sox', tenure_start_date: '2021-11-08', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Brandon Hyde', team_name: 'Baltimore Orioles', tenure_start_date: '2018-12-17', bullpen_usage: 'moderate', lineup_consistency: 'very_consistent', platoon_tendency: 'minimal', pinch_hit_frequency: 'low' },
    { coach_name: 'Bruce Bochy', team_name: 'Texas Rangers', tenure_start_date: '2023-10-24', bullpen_usage: 'starter_focused', lineup_consistency: 'very_consistent', platoon_tendency: 'minimal', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Craig Counsell', team_name: 'Chicago Cubs', tenure_start_date: '2023-11-13', bullpen_usage: 'heavy', lineup_consistency: 'platoon_heavy', platoon_tendency: 'heavy', pinch_hit_frequency: 'high' },
    { coach_name: 'Bob Melvin', team_name: 'San Francisco Giants', tenure_start_date: '2024-09-23', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Dusty Baker', team_name: 'Houston Astros', tenure_start_date: '2020-01-29', bullpen_usage: 'starter_focused', lineup_consistency: 'very_consistent', platoon_tendency: 'minimal', pinch_hit_frequency: 'low' },
    { coach_name: 'Kevin Cash', team_name: 'Tampa Bay Rays', tenure_start_date: '2014-12-05', bullpen_usage: 'heavy', lineup_consistency: 'platoon_heavy', platoon_tendency: 'heavy', pinch_hit_frequency: 'high' },
    { coach_name: 'Torey Lovullo', team_name: 'Arizona Diamondbacks', tenure_start_date: '2016-10-31', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Oliver Marmol', team_name: 'St. Louis Cardinals', tenure_start_date: '2021-10-25', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Stephen Vogt', team_name: 'Cleveland Guardians', tenure_start_date: '2023-11-06', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Skip Schumaker', team_name: 'Miami Marlins', tenure_start_date: '2022-11-01', bullpen_usage: 'heavy', lineup_consistency: 'platoon_heavy', platoon_tendency: 'heavy', pinch_hit_frequency: 'high' },
    { coach_name: 'Brian Snitker', team_name: 'Atlanta Braves', tenure_start_date: '2016-05-17', bullpen_usage: 'starter_focused', lineup_consistency: 'very_consistent', platoon_tendency: 'minimal', pinch_hit_frequency: 'low' },
    { coach_name: 'Pat Murphy', team_name: 'Milwaukee Brewers', tenure_start_date: '2024-10-31', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Rocco Baldelli', team_name: 'Minnesota Twins', tenure_start_date: '2018-10-25', bullpen_usage: 'heavy', lineup_consistency: 'platoon_heavy', platoon_tendency: 'heavy', pinch_hit_frequency: 'high' },
    { coach_name: 'Derek Shelton', team_name: 'Pittsburgh Pirates', tenure_start_date: '2019-11-28', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Carlos Mendoza', team_name: 'New York Mets', tenure_start_date: '2024-01-22', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Matt Quatraro', team_name: 'Kansas City Royals', tenure_start_date: '2022-11-03', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Ron Washington', team_name: 'Los Angeles Angels', tenure_start_date: '2024-11-13', bullpen_usage: 'starter_focused', lineup_consistency: 'very_consistent', platoon_tendency: 'minimal', pinch_hit_frequency: 'low' },
    { coach_name: 'A.J. Hinch', team_name: 'Detroit Tigers', tenure_start_date: '2020-10-30', bullpen_usage: 'heavy', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'David Bell', team_name: 'Cincinnati Reds', tenure_start_date: '2018-10-21', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Rob Thomson', team_name: 'Philadelphia Phillies', tenure_start_date: '2022-06-03', bullpen_usage: 'moderate', lineup_consistency: 'very_consistent', platoon_tendency: 'minimal', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Mike Shildt', team_name: 'San Diego Padres', tenure_start_date: '2023-11-15', bullpen_usage: 'starter_focused', lineup_consistency: 'very_consistent', platoon_tendency: 'minimal', pinch_hit_frequency: 'low' },
    { coach_name: 'Scott Servais', team_name: 'Seattle Mariners', tenure_start_date: '2015-10-23', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Pedro Grifol', team_name: 'Chicago White Sox', tenure_start_date: '2022-11-01', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Mark Kotsay', team_name: 'Oakland Athletics', tenure_start_date: '2022-01-12', bullpen_usage: 'heavy', lineup_consistency: 'platoon_heavy', platoon_tendency: 'heavy', pinch_hit_frequency: 'high' },
    { coach_name: 'Bud Black', team_name: 'Colorado Rockies', tenure_start_date: '2017-11-07', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'John Schneider', team_name: 'Toronto Blue Jays', tenure_start_date: '2022-07-13', bullpen_usage: 'heavy', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
    { coach_name: 'Dave Martinez', team_name: 'Washington Nationals', tenure_start_date: '2017-10-31', bullpen_usage: 'moderate', lineup_consistency: 'moderate', platoon_tendency: 'moderate', pinch_hit_frequency: 'moderate' },
  ];
  
  let seeded = 0;
  
  for (const manager of mlbManagers) {
    const { error } = await supabase
      .from('coach_profiles')
      .upsert({
        ...manager,
        sport: 'baseball_mlb',
        is_active: true
      }, { onConflict: 'coach_name,team_name' });
    
    if (!error) seeded++;
  }
  
  console.log(`Seeded ${seeded} MLB managers`);
  return { seeded };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, teamName, sport, propType } = await req.json();
    console.log(`Coach Tendencies Engine - Action: ${action}, Team: ${teamName}, Sport: ${sport}`);

    let result: any;

    switch (action) {
      case 'analyze':
        if (!teamName) throw new Error('teamName is required');
        result = await analyzeCoachTendencies(supabase, teamName, sport || 'basketball_nba', propType || 'points');
        break;

      case 'seed-nba':
        result = await seedNBACoaches(supabase);
        break;

      case 'seed-nfl':
        result = await seedNFLCoaches(supabase);
        break;

      case 'seed-nhl':
        result = await seedNHLCoaches(supabase);
        break;

      case 'seed-mlb':
        result = await seedMLBManagers(supabase);
        break;

      case 'seed-all':
        const nba = await seedNBACoaches(supabase);
        const nfl = await seedNFLCoaches(supabase);
        const nhl = await seedNHLCoaches(supabase);
        const mlb = await seedMLBManagers(supabase);
        result = { 
          nba: nba.seeded, 
          nfl: nfl.seeded, 
          nhl: nhl.seeded, 
          mlb: mlb.seeded,
          total: nba.seeded + nfl.seeded + nhl.seeded + mlb.seeded
        };
        break;

      case 'get-all-profiles':
        const { data: profiles, error: profilesError } = await supabase
          .from('coach_profiles')
          .select('*')
          .eq('is_active', true)
          .order('sport', { ascending: true })
          .order('team_name', { ascending: true });
        
        if (profilesError) throw profilesError;
        result = { profiles, count: profiles?.length || 0 };
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Coach Tendencies Engine error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

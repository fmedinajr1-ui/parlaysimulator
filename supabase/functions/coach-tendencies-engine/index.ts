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
  pace_preference: 'fast' | 'moderate' | 'slow' | null;
  rotation_depth: number | null;
  star_usage_pct: number | null;
  b2b_rest_tendency: 'aggressive' | 'moderate' | 'cautious' | null;
  fourth_quarter_pattern: 'ride_starters' | 'balanced' | 'bench_heavy' | null;
  blowout_minutes_reduction: number | null;
}

interface CoachGameTendency {
  id: string;
  coach_id: string;
  game_date: string;
  event_id: string;
  situation: 'b2b' | 'b2b_road' | 'fresh' | '3_in_4' | '4_in_6';
  rotation_size: number;
  star_minutes_pct: number;
  pace: number;
  total_possessions: number;
}

interface CoachTendencySignal {
  coachName: string;
  teamName: string;
  tenureMonths: number;
  situationalMatch: boolean;
  
  // Tendency scores (0-100)
  paceScore: number;
  rotationScore: number;
  starUsageScore: number;
  b2bRestScore: number;
  
  // Recommendations
  recommendation: 'pick' | 'fade' | 'neutral';
  confidence: number;
  reasoning: string;
  
  // Prop adjustments
  propAdjustments: {
    points: number;
    rebounds: number;
    assists: number;
    minutes: number;
  };
}

function calculateTenureMonths(startDate: string, endDate?: string | null): number {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(1, months);
}

function calculatePaceScore(preference: string | null): number {
  switch (preference) {
    case 'fast': return 80;
    case 'moderate': return 50;
    case 'slow': return 20;
    default: return 50;
  }
}

function calculateRotationScore(depth: number | null): number {
  if (!depth) return 50;
  // Deeper rotation = higher score = more bench minutes
  return Math.min(100, Math.max(0, (depth - 7) * 15 + 50));
}

function calculateStarUsageScore(pct: number | null): number {
  if (!pct) return 50;
  // Higher star usage = higher score = more star-dependent
  return Math.min(100, Math.max(0, pct));
}

function calculateB2BRestScore(tendency: string | null): number {
  switch (tendency) {
    case 'cautious': return 80; // More likely to rest/reduce minutes
    case 'moderate': return 50;
    case 'aggressive': return 20; // Plays through fatigue
    default: return 50;
  }
}

function determinePropAdjustments(
  coach: CoachProfile,
  situation: string,
  propType: string
): { points: number; rebounds: number; assists: number; minutes: number } {
  const baseAdjustments = { points: 0, rebounds: 0, assists: 0, minutes: 0 };
  
  // B2B situations
  if (situation === 'b2b' || situation === 'b2b_road') {
    if (coach.b2b_rest_tendency === 'cautious') {
      baseAdjustments.minutes = -8;
      baseAdjustments.points = -6;
      baseAdjustments.rebounds = -4;
      baseAdjustments.assists = -3;
    } else if (coach.b2b_rest_tendency === 'aggressive') {
      baseAdjustments.minutes = -2;
      baseAdjustments.points = -2;
      baseAdjustments.rebounds = -1;
      baseAdjustments.assists = -1;
    } else {
      baseAdjustments.minutes = -5;
      baseAdjustments.points = -4;
      baseAdjustments.rebounds = -2;
      baseAdjustments.assists = -2;
    }
    
    // Road B2B is harder
    if (situation === 'b2b_road') {
      baseAdjustments.minutes -= 2;
      baseAdjustments.points -= 2;
    }
  }
  
  // Pace adjustments
  if (coach.pace_preference === 'fast') {
    baseAdjustments.points += 3;
    baseAdjustments.assists += 2;
  } else if (coach.pace_preference === 'slow') {
    baseAdjustments.points -= 3;
    baseAdjustments.assists -= 1;
  }
  
  // Rotation depth adjustments (for stars)
  if (coach.rotation_depth && coach.rotation_depth >= 10) {
    // Deep rotation = less star minutes
    baseAdjustments.minutes -= 3;
    baseAdjustments.points -= 2;
  } else if (coach.rotation_depth && coach.rotation_depth <= 7) {
    // Tight rotation = more star minutes
    baseAdjustments.minutes += 3;
    baseAdjustments.points += 2;
  }
  
  return baseAdjustments;
}

async function analyzeCoachTendencies(
  supabase: any,
  teamName: string,
  situation: string,
  propType: string
): Promise<CoachTendencySignal | null> {
  console.log(`Analyzing coaching tendencies for ${teamName}, situation: ${situation}, prop: ${propType}`);
  
  // Get active coach profile
  const { data: coach, error: coachError } = await supabase
    .from('coach_profiles')
    .select('*')
    .eq('team_name', teamName)
    .eq('is_active', true)
    .maybeSingle();
  
  if (coachError) {
    console.error('Error fetching coach:', coachError);
    return null;
  }
  
  if (!coach) {
    console.log(`No active coach found for ${teamName}`);
    return null;
  }
  
  const tenureMonths = calculateTenureMonths(coach.tenure_start_date, coach.tenure_end_date);
  
  // Get historical tendencies for this situation
  const { data: tendencies } = await supabase
    .from('coach_game_tendencies')
    .select('*')
    .eq('coach_id', coach.id)
    .eq('situation', situation)
    .order('game_date', { ascending: false })
    .limit(10);
  
  const situationalMatch = tendencies && tendencies.length >= 3;
  
  // Calculate tendency scores
  const paceScore = calculatePaceScore(coach.pace_preference);
  const rotationScore = calculateRotationScore(coach.rotation_depth);
  const starUsageScore = calculateStarUsageScore(coach.star_usage_pct);
  const b2bRestScore = calculateB2BRestScore(coach.b2b_rest_tendency);
  
  // Calculate prop adjustments
  const propAdjustments = determinePropAdjustments(coach, situation, propType);
  
  // Determine recommendation
  let recommendation: 'pick' | 'fade' | 'neutral' = 'neutral';
  let confidence = 0.5;
  let reasoning = '';
  
  // Points props
  if (propType.includes('points')) {
    if (coach.pace_preference === 'fast') {
      recommendation = 'pick';
      confidence = 0.65;
      reasoning = `${coach.coach_name} runs a fast pace system, favorable for overs`;
    } else if (coach.pace_preference === 'slow') {
      recommendation = 'fade';
      confidence = 0.6;
      reasoning = `${coach.coach_name} runs a slow pace system, lean under`;
    }
    
    // B2B adjustments
    if (situation === 'b2b' || situation === 'b2b_road') {
      if (coach.b2b_rest_tendency === 'cautious') {
        recommendation = 'fade';
        confidence = 0.7;
        reasoning = `${coach.coach_name} is cautious on B2Bs, expect reduced minutes/production`;
      }
    }
  }
  
  // Minutes props
  if (propType.includes('minutes')) {
    if (coach.rotation_depth && coach.rotation_depth >= 10) {
      recommendation = 'fade';
      confidence = 0.6;
      reasoning = `${coach.coach_name} uses deep rotation (${coach.rotation_depth} players), limits star minutes`;
    } else if (coach.rotation_depth && coach.rotation_depth <= 7) {
      recommendation = 'pick';
      confidence = 0.65;
      reasoning = `${coach.coach_name} uses tight rotation (${coach.rotation_depth} players), stars play heavy`;
    }
  }
  
  // Adjust confidence by tenure
  if (tenureMonths < 6) {
    confidence *= 0.7; // New coach = more uncertainty
    reasoning += ' (new coach - limited data)';
  } else if (tenureMonths > 36) {
    confidence *= 1.1; // Established patterns
    confidence = Math.min(confidence, 0.9);
  }
  
  return {
    coachName: coach.coach_name,
    teamName: coach.team_name,
    tenureMonths,
    situationalMatch,
    paceScore,
    rotationScore,
    starUsageScore,
    b2bRestScore,
    recommendation,
    confidence,
    reasoning,
    propAdjustments
  };
}

async function getCoachProfile(supabase: any, teamName: string): Promise<CoachProfile | null> {
  const { data, error } = await supabase
    .from('coach_profiles')
    .select('*')
    .eq('team_name', teamName)
    .eq('is_active', true)
    .maybeSingle();
  
  if (error) {
    console.error('Error fetching coach profile:', error);
    return null;
  }
  
  return data;
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
    { coach_name: 'Darvin Ham', team_name: 'Los Angeles Lakers', tenure_start_date: '2022-06-03', pace_preference: 'fast', rotation_depth: 8, star_usage_pct: 60, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Monty Williams', team_name: 'Detroit Pistons', tenure_start_date: '2023-06-13', pace_preference: 'moderate', rotation_depth: 10, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Nick Nurse', team_name: 'Philadelphia 76ers', tenure_start_date: '2023-06-13', pace_preference: 'moderate', rotation_depth: 8, star_usage_pct: 62, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Michael Malone', team_name: 'Denver Nuggets', tenure_start_date: '2015-06-15', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Taylor Jenkins', team_name: 'Memphis Grizzlies', tenure_start_date: '2019-06-11', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 52, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Ime Udoka', team_name: 'Houston Rockets', tenure_start_date: '2023-04-19', pace_preference: 'moderate', rotation_depth: 10, star_usage_pct: 48, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Rick Carlisle', team_name: 'Indiana Pacers', tenure_start_date: '2021-06-24', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Jason Kidd', team_name: 'Dallas Mavericks', tenure_start_date: '2021-06-28', pace_preference: 'fast', rotation_depth: 8, star_usage_pct: 65, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Steve Clifford', team_name: 'Charlotte Hornets', tenure_start_date: '2023-02-03', pace_preference: 'slow', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'cautious' },
    { coach_name: 'Wes Unseld Jr.', team_name: 'Washington Wizards', tenure_start_date: '2021-07-21', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 52, b2b_rest_tendency: 'moderate' },
    { coach_name: 'JB Bickerstaff', team_name: 'Cleveland Cavaliers', tenure_start_date: '2020-02-19', pace_preference: 'slow', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Quin Snyder', team_name: 'Atlanta Hawks', tenure_start_date: '2023-02-26', pace_preference: 'moderate', rotation_depth: 8, star_usage_pct: 58, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Mark Daigneault', team_name: 'Oklahoma City Thunder', tenure_start_date: '2020-11-11', pace_preference: 'fast', rotation_depth: 10, star_usage_pct: 48, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Chris Finch', team_name: 'Minnesota Timberwolves', tenure_start_date: '2021-02-22', pace_preference: 'moderate', rotation_depth: 8, star_usage_pct: 58, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Willie Green', team_name: 'New Orleans Pelicans', tenure_start_date: '2021-07-22', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Chauncey Billups', team_name: 'Portland Trail Blazers', tenure_start_date: '2021-06-29', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 52, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Will Hardy', team_name: 'Utah Jazz', tenure_start_date: '2022-06-28', pace_preference: 'fast', rotation_depth: 10, star_usage_pct: 45, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Mike Brown', team_name: 'Sacramento Kings', tenure_start_date: '2022-05-09', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Jacque Vaughn', team_name: 'Brooklyn Nets', tenure_start_date: '2022-11-01', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Jamahl Mosley', team_name: 'Orlando Magic', tenure_start_date: '2021-07-08', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Darko Rajaković', team_name: 'Toronto Raptors', tenure_start_date: '2023-06-15', pace_preference: 'fast', rotation_depth: 9, star_usage_pct: 50, b2b_rest_tendency: 'moderate' },
    { coach_name: 'Adrian Griffin', team_name: 'Chicago Bulls', tenure_start_date: '2023-09-12', pace_preference: 'moderate', rotation_depth: 9, star_usage_pct: 55, b2b_rest_tendency: 'moderate' },
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
      }, {
        onConflict: 'coach_name,team_name,tenure_start_date'
      });
    
    if (error) {
      console.error(`Error seeding ${coach.coach_name}:`, error);
    } else {
      seeded++;
    }
  }
  
  console.log(`Seeded ${seeded} NBA coaches`);
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

    const { action, teamName, situation, propType } = await req.json();
    console.log(`Coach Tendencies Engine - Action: ${action}, Team: ${teamName}`);

    let result: any;

    switch (action) {
      case 'analyze':
        if (!teamName) {
          throw new Error('teamName is required for analyze action');
        }
        result = await analyzeCoachTendencies(
          supabase,
          teamName,
          situation || 'fresh',
          propType || 'points'
        );
        break;

      case 'get-profile':
        if (!teamName) {
          throw new Error('teamName is required for get-profile action');
        }
        result = await getCoachProfile(supabase, teamName);
        break;

      case 'seed-coaches':
        result = await seedNBACoaches(supabase);
        break;

      case 'get-all-profiles':
        const { data: profiles, error: profilesError } = await supabase
          .from('coach_profiles')
          .select('*')
          .eq('is_active', true)
          .order('team_name');
        
        if (profilesError) throw profilesError;
        result = profiles;
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    console.error('Coach tendencies engine error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});

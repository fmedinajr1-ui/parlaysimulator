import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * ncaab-fatigue-calculator
 * 
 * Calculates travel fatigue and altitude impact for NCAAB teams.
 * Uses ncaab_team_locations for venue data and game schedule for travel patterns.
 */

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Haversine distance in miles
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Map timezone to offset for crossing calculation
const TZ_OFFSETS: Record<string, number> = {
  'America/New_York': -5,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Boise': -7,
  'America/Los_Angeles': -8,
  'America/Phoenix': -7,
  'Pacific/Honolulu': -10,
};

function getTimezoneChanges(tz1: string, tz2: string): number {
  const o1 = TZ_OFFSETS[tz1] || -5;
  const o2 = TZ_OFFSETS[tz2] || -5;
  return Math.abs(o1 - o2);
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
    console.log(`[NCAAB Fatigue] Calculating fatigue for ${today}...`);

    // Load team locations
    const { data: locations } = await supabase
      .from('ncaab_team_locations')
      .select('*');

    const locationMap = new Map<string, any>();
    (locations || []).forEach((loc: any) => {
      locationMap.set(loc.team_name, loc);
      // Also map without mascot for fuzzy matching
      const school = loc.team_name.split(' ').slice(0, -1).join(' ');
      if (school.length > 3) locationMap.set(school, loc);
    });

    console.log(`[NCAAB Fatigue] ${locationMap.size} locations loaded`);

    // Get today's NCAAB games from game_bets
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const { data: todayGames } = await supabase
      .from('game_bets')
      .select('game_id, home_team, away_team, sport, commence_time')
      .like('sport', '%ncaab%')
      .not('sport', 'like', '%baseball%')
      .gte('commence_time', todayStart.toISOString())
      .lt('commence_time', tomorrowStart.toISOString());

    // Deduplicate by game_id
    const seenGames = new Set<string>();
    const uniqueGames = (todayGames || []).filter((g: any) => {
      if (seenGames.has(g.game_id)) return false;
      seenGames.add(g.game_id);
      return true;
    });

    console.log(`[NCAAB Fatigue] ${uniqueGames.length} unique NCAAB games today`);

    // Get recent games (last 7 days) for back-to-back and 3-in-5 detection
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data: recentGames } = await supabase
      .from('game_bets')
      .select('game_id, home_team, away_team, commence_time')
      .like('sport', '%ncaab%')
      .not('sport', 'like', '%baseball%')
      .gte('commence_time', weekAgo.toISOString())
      .lt('commence_time', todayStart.toISOString());

    // Build team schedule from recent games
    const teamSchedule = new Map<string, Date[]>();
    for (const game of (recentGames || [])) {
      const date = new Date(game.commence_time);
      for (const team of [game.home_team, game.away_team]) {
        if (!teamSchedule.has(team)) teamSchedule.set(team, []);
        teamSchedule.get(team)!.push(date);
      }
    }

    // Calculate fatigue for each team in today's games
    const fatigueResults: any[] = [];

    for (const game of uniqueGames) {
      for (const [team, opponent, isAway] of [
        [game.away_team, game.home_team, true],
        [game.home_team, game.away_team, false],
      ] as [string, string, boolean][]) {
        
        let fatigueScore = 0;
        const factors: string[] = [];

        // Find locations
        const teamLoc = findLocation(team, locationMap);
        const venueLoc = findLocation(game.home_team, locationMap); // Venue = home team's location

        // 1. Travel distance (away team)
        let travelMiles = 0;
        if (isAway && teamLoc && venueLoc) {
          travelMiles = haversineDistance(
            teamLoc.latitude, teamLoc.longitude,
            venueLoc.latitude, venueLoc.longitude
          );
          
          if (travelMiles > 1500) {
            fatigueScore += 15;
            factors.push(`Cross-country ${Math.round(travelMiles)}mi`);
          } else if (travelMiles > 800) {
            fatigueScore += 10;
            factors.push(`Long travel ${Math.round(travelMiles)}mi`);
          } else if (travelMiles > 300) {
            fatigueScore += 5;
            factors.push(`${Math.round(travelMiles)}mi travel`);
          }
        }

        // 2. Timezone changes
        let tzChanges = 0;
        if (isAway && teamLoc && venueLoc) {
          tzChanges = getTimezoneChanges(teamLoc.timezone || 'America/New_York', venueLoc.timezone || 'America/New_York');
          if (tzChanges >= 3) {
            fatigueScore += 12;
            factors.push(`${tzChanges}hr timezone change`);
          } else if (tzChanges >= 2) {
            fatigueScore += 8;
            factors.push(`${tzChanges}hr timezone change`);
          } else if (tzChanges >= 1) {
            fatigueScore += 3;
            factors.push(`${tzChanges}hr timezone change`);
          }
        }

        // 3. Altitude differential (away team playing at altitude)
        let altitudeDiff = 0;
        let isAltitudeGame = false;
        if (isAway && teamLoc && venueLoc) {
          altitudeDiff = (venueLoc.altitude_feet || 0) - (teamLoc.altitude_feet || 0);
          if (altitudeDiff > 3000) {
            fatigueScore += 15;
            isAltitudeGame = true;
            factors.push(`+${altitudeDiff}ft altitude`);
          } else if (altitudeDiff > 2000) {
            fatigueScore += 8;
            isAltitudeGame = true;
            factors.push(`+${altitudeDiff}ft altitude`);
          } else if (altitudeDiff > 1000) {
            fatigueScore += 3;
            factors.push(`+${altitudeDiff}ft altitude`);
          }
        }

        // 4. Back-to-back detection
        const schedule = teamSchedule.get(team) || [];
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().substring(0, 10);
        const isB2B = schedule.some(d => d.toISOString().substring(0, 10) === yesterdayStr);
        
        if (isB2B) {
          fatigueScore += 20;
          factors.push('Back-to-back');
        }

        // 5. 3-in-5-day detection
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
        const gamesInFive = schedule.filter(d => d >= fiveDaysAgo).length;
        if (gamesInFive >= 3) {
          fatigueScore += 10;
          factors.push(`3-in-5 days`);
        } else if (gamesInFive >= 2 && !isB2B) {
          fatigueScore += 5;
          factors.push('2 games in 5 days');
        }

        // Determine category
        let category = 'rested';
        if (fatigueScore >= 40) category = 'exhausted';
        else if (fatigueScore >= 25) category = 'fatigued';
        else if (fatigueScore >= 15) category = 'moderate';
        else if (fatigueScore >= 5) category = 'light';

        fatigueResults.push({
          team_name: team,
          opponent,
          fatigue_score: Math.min(100, fatigueScore),
          fatigue_category: category,
          is_back_to_back: isB2B,
          travel_miles: Math.round(travelMiles),
          timezone_changes: tzChanges,
          is_altitude_game: isAltitudeGame,
          altitude_differential: Math.max(0, altitudeDiff),
          game_date: today,
          event_id: game.game_id,
        });
      }
    }

    // Upsert fatigue scores
    let upserted = 0;
    for (const result of fatigueResults) {
      const { error } = await supabase
        .from('ncaab_fatigue_scores')
        .upsert(result, { onConflict: 'team_name,game_date' });
      if (!error) upserted++;
    }

    const highFatigue = fatigueResults.filter(r => r.fatigue_score >= 25);
    const summary = {
      success: true,
      date: today,
      games_processed: uniqueGames.length,
      fatigue_scores_calculated: fatigueResults.length,
      upserted,
      high_fatigue_teams: highFatigue.map(r => 
        `${r.team_name}: ${r.fatigue_score} (${r.fatigue_category})`
      ),
      locations_available: locationMap.size,
    };

    console.log('[NCAAB Fatigue] Complete:', summary);

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaab-fatigue-calculator',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: summary,
    });

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[NCAAB Fatigue] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function findLocation(teamName: string, locationMap: Map<string, any>): any | undefined {
  // Direct match
  let loc = locationMap.get(teamName);
  if (loc) return loc;
  
  // Try without mascot
  const school = teamName.split(' ').slice(0, -1).join(' ');
  loc = locationMap.get(school);
  if (loc) return loc;

  // Fuzzy: check contains
  for (const [key, val] of locationMap) {
    if (key.includes(teamName) || teamName.includes(key)) return val;
    const keyLast = key.split(' ').pop()?.toLowerCase();
    const teamLast = teamName.split(' ').pop()?.toLowerCase();
    if (keyLast && teamLast && keyLast === teamLast && keyLast.length > 4) {
      const teamFirst = teamName.split(' ')[0].toLowerCase();
      if (key.toLowerCase().includes(teamFirst)) return val;
    }
  }

  return undefined;
}

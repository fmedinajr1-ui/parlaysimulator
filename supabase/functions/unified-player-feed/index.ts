import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_NBA_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const ESPN_NBA_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// Cache to prevent rate limiting - 10 second TTL
const cache: Map<string, { data: any; timestamp: number }> = new Map();
const CACHE_TTL = 10000;

// Role-based baseline production rates (per 36 minutes)
const ROLE_BASELINES: Record<string, Record<string, number>> = {
  star: { points: 24, rebounds: 7, assists: 6, threes: 2.5, steals: 1.2, blocks: 0.8 },
  starter: { points: 14, rebounds: 5, assists: 3.5, threes: 1.5, steals: 0.9, blocks: 0.5 },
  rotation: { points: 9, rebounds: 3.5, assists: 2, threes: 1, steals: 0.6, blocks: 0.3 },
  bench: { points: 5, rebounds: 2, assists: 1, threes: 0.5, steals: 0.3, blocks: 0.2 },
};

// Prop type mappings
const PROP_STATS = ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks'];

interface PlayerStats {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  threes: number;
}

interface PlayerProjection {
  current: number;
  projected: number;
  remaining: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
  ratePerMinute: number;
}

interface UnifiedPlayer {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  currentStats: Record<string, number>;
  projections: Record<string, PlayerProjection>;
  riskFlags: string[];
  minutesPlayed: number;
  estimatedRemaining: number;
  role: string;
  isOnCourt: boolean;
}

interface UnifiedGame {
  eventId: string;
  period: number;
  clock: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'scheduled' | 'in_progress' | 'final' | 'halftime';
  gameProgress: number;
  players: UnifiedPlayer[];
  pace: number;
}

function parseMinutes(minStr: string): number {
  if (!minStr) return 0;
  const parts = minStr.split(':');
  if (parts.length === 2) {
    return parseFloat(parts[0]) + parseFloat(parts[1]) / 60;
  }
  return parseFloat(minStr) || 0;
}

function determineRole(minutes: number, gameProgress: number): string {
  if (gameProgress < 10) return 'rotation'; // Too early to determine
  const projectedMinutes = (minutes / (gameProgress / 100)) || 0;
  if (projectedMinutes >= 32) return 'star';
  if (projectedMinutes >= 24) return 'starter';
  if (projectedMinutes >= 12) return 'rotation';
  return 'bench';
}

function getGameProgress(period: number, clock: string, status: string): number {
  if (status === 'scheduled' || status === 'pre') return 0;
  if (status === 'final' || status === 'post') return 100;
  if (status === 'halftime') return 50;

  // Parse clock
  const clockParts = clock.split(':');
  const minutes = parseInt(clockParts[0]) || 0;
  const seconds = parseInt(clockParts[1]) || 0;
  const remainingInPeriod = minutes + seconds / 60;
  const elapsedInPeriod = 12 - remainingInPeriod;

  // NBA: 4 quarters, 12 min each
  const totalGameMinutes = 48;
  const completedPeriodMinutes = Math.max(0, period - 1) * 12;
  const totalElapsed = completedPeriodMinutes + elapsedInPeriod;

  return Math.min(100, (totalElapsed / totalGameMinutes) * 100);
}

function calculateProjection(
  current: number,
  minutesPlayed: number,
  remainingMinutes: number,
  role: string,
  statType: string,
  riskFlags: string[]
): PlayerProjection {
  // Get baseline rate for this role
  const baseline = ROLE_BASELINES[role]?.[statType] || 0;
  const baselinePerMin = baseline / 36;

  // Calculate live rate
  const liveRate = minutesPlayed > 3 ? current / minutesPlayed : baselinePerMin;

  // Blend live and baseline (more weight to live as minutes increase)
  const liveWeight = Math.min(0.9, minutesPlayed / 20);
  const blendedRate = (liveRate * liveWeight) + (baselinePerMin * (1 - liveWeight));

  // Apply risk penalties
  let riskPenalty = 1.0;
  if (riskFlags.includes('foul_trouble')) riskPenalty *= 0.85;
  if (riskFlags.includes('blowout')) riskPenalty *= 0.7;
  if (riskFlags.includes('losing_blowout')) riskPenalty *= 0.75;

  const adjustedRemaining = remainingMinutes * riskPenalty;
  const projected = current + (blendedRate * adjustedRemaining);

  // Calculate confidence
  let confidence = 50;
  if (minutesPlayed > 0) confidence += Math.min(30, minutesPlayed * 1.5);
  if (riskFlags.length > 0) confidence -= riskFlags.length * 12;
  confidence = Math.max(1, Math.min(99, Math.round(confidence)));

  return {
    current,
    projected: Math.round(projected * 10) / 10,
    remaining: adjustedRemaining,
    confidence,
    trend: 'stable',
    ratePerMinute: Math.round(blendedRate * 100) / 100,
  };
}

function detectRiskFlags(
  game: { homeScore: number; awayScore: number; period: number },
  player: { team: string; fouls: number },
  homeTeam: string
): string[] {
  const flags: string[] = [];
  const scoreDiff = game.homeScore - game.awayScore;
  const isHome = player.team === homeTeam;
  const teamDiff = isHome ? scoreDiff : -scoreDiff;

  // Foul trouble
  if (player.fouls >= 5) flags.push('foul_trouble');
  else if (player.fouls >= 4 && game.period <= 3) flags.push('foul_trouble');

  // Blowout detection
  const period = game.period;
  if (period >= 4) {
    if (Math.abs(scoreDiff) >= 15) {
      flags.push(teamDiff > 0 ? 'blowout' : 'losing_blowout');
    }
  } else if (period >= 3) {
    if (Math.abs(scoreDiff) >= 25) {
      flags.push(teamDiff > 0 ? 'blowout' : 'losing_blowout');
    }
  }

  return flags;
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'AbortError';
      const msg = isTimeout ? '8s timeout exceeded' : (err instanceof Error ? err.message : String(err));
      console.warn(`[UnifiedFeed] Fetch attempt ${attempt}/${retries} ${isTimeout ? 'TIMEOUT' : 'failed'} for ${url}: ${msg}`);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error('Unreachable');
}

async function fetchGameData(eventId: string): Promise<any> {
  const cached = cache.get(eventId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetchWithRetry(`${ESPN_NBA_SUMMARY}?event=${eventId}`);
    if (!response.ok) {
      console.error(`[UnifiedFeed] ESPN API error for ${eventId}: ${response.status}`);
      return null;
    }
    const data = await response.json();
    cache.set(eventId, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    console.error(`[UnifiedFeed] ESPN fetch failed for ${eventId} after retries:`, err);
    return null;
  }
}

async function fetchLiveGames(): Promise<string[]> {
  const cached = cache.get('scoreboard');
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetchWithRetry(ESPN_NBA_SCOREBOARD);
    if (!response.ok) {
      console.error(`[UnifiedFeed] Scoreboard API error: ${response.status}`);
      return [];
    }
    const data = await response.json();
    const eventIds = (data.events || []).map((e: any) => e.id);
    cache.set('scoreboard', { data: eventIds, timestamp: Date.now() });
    return eventIds;
  } catch (err) {
    console.error(`[UnifiedFeed] Scoreboard fetch failed after retries:`, err);
    return [];
  }
}

function processGameData(data: any, eventId: string): UnifiedGame | null {
  try {
    const header = data.header?.competitions?.[0];
    const status = header?.status;
    const boxscore = data.boxscore;

    const period = status?.period || 1;
    const clock = status?.displayClock || '12:00';
    const statusType = status?.type?.name?.toLowerCase() || 'scheduled';
    const gameStatus = statusType.includes('progress') || statusType === 'in' ? 'in_progress' :
                       statusType === 'final' || statusType === 'post' ? 'final' :
                       statusType === 'halftime' ? 'halftime' : 'scheduled';

    const competitors = header?.competitors || [];
    const homeTeamData = competitors.find((c: any) => c.homeAway === 'home');
    const awayTeamData = competitors.find((c: any) => c.homeAway === 'away');

    const homeTeam = homeTeamData?.team?.abbreviation || 'HOME';
    const awayTeam = awayTeamData?.team?.abbreviation || 'AWAY';
    const homeScore = parseInt(homeTeamData?.score) || 0;
    const awayScore = parseInt(awayTeamData?.score) || 0;

    const gameProgress = getGameProgress(period, clock, gameStatus);
    const remainingGameMinutes = 48 * (1 - gameProgress / 100);

    // Parse all players from boxscore
    const players: UnifiedPlayer[] = [];

    if (boxscore?.players) {
      for (const teamPlayers of boxscore.players) {
        const teamAbbr = teamPlayers.team?.abbreviation || '';

        for (const statCategory of (teamPlayers.statistics || [])) {
          const labels = statCategory.labels || [];

          for (const athlete of (statCategory.athletes || [])) {
            const stats: Record<string, any> = {};

            (athlete.stats || []).forEach((value: string, idx: number) => {
              const label = labels[idx];
              if (label) {
                stats[label.toLowerCase()] = value;
              }
            });

            const minutesPlayed = parseMinutes(stats.min || '0');
            const fouls = parseInt(stats.pf) || 0;
            const points = parseInt(stats.pts) || 0;
            const rebounds = parseInt(stats.reb) || 0;
            const assists = parseInt(stats.ast) || 0;
            const steals = parseInt(stats.stl) || 0;
            const blocks = parseInt(stats.blk) || 0;
            const threes = parseInt(stats['3pm'] || stats['3pt']?.split('-')?.[0]) || 0;

            const role = determineRole(minutesPlayed, gameProgress);
            const riskFlags = detectRiskFlags(
              { homeScore, awayScore, period },
              { team: teamAbbr, fouls },
              homeTeam
            );

            // Estimate remaining minutes based on role
            let estimatedRemaining = 0;
            if (gameProgress < 100) {
              const roleMinutes: Record<string, number> = { star: 36, starter: 30, rotation: 18, bench: 8 };
              const targetTotal = roleMinutes[role] || 15;
              estimatedRemaining = Math.max(0, (targetTotal - minutesPlayed) * (remainingGameMinutes / 48));
            }

            // Calculate projections for all stat types
            const projections: Record<string, PlayerProjection> = {};
            const currentStats = { points, rebounds, assists, steals, blocks, threes };

            for (const statType of PROP_STATS) {
              projections[statType] = calculateProjection(
                currentStats[statType as keyof typeof currentStats] || 0,
                minutesPlayed,
                estimatedRemaining,
                role,
                statType,
                riskFlags
              );
            }

            // Add combined stats
            const pra = points + rebounds + assists;
            projections['pra'] = {
              current: pra,
              projected: projections.points.projected + projections.rebounds.projected + projections.assists.projected,
              remaining: estimatedRemaining,
              confidence: Math.round((projections.points.confidence + projections.rebounds.confidence + projections.assists.confidence) / 3),
              trend: 'stable',
              ratePerMinute: projections.points.ratePerMinute + projections.rebounds.ratePerMinute + projections.assists.ratePerMinute,
            };

            players.push({
              playerId: athlete.athlete?.id || '',
              playerName: athlete.athlete?.displayName || '',
              team: teamAbbr,
              position: athlete.athlete?.position?.abbreviation || '',
              currentStats,
              projections,
              riskFlags,
              minutesPlayed,
              estimatedRemaining,
              role,
              isOnCourt: minutesPlayed > 0 || gameProgress < 10, // Assume on court if game just started
            });
          }
        }
      }
    }

    // Calculate pace
    let pace = 100;
    if (boxscore?.teams) {
      const homeStats = boxscore.teams.find((t: any) => t.team?.abbreviation === homeTeam)?.statistics;
      if (homeStats) {
        const fga = parseInt(homeStats.find((s: any) => s.name === 'fieldGoalsAttempted')?.displayValue) || 0;
        const to = parseInt(homeStats.find((s: any) => s.name === 'turnovers')?.displayValue) || 0;
        const fta = parseInt(homeStats.find((s: any) => s.name === 'freeThrowsAttempted')?.displayValue) || 0;
        const estimatedPossessions = fga + to + 0.44 * fta;
        const gameMinutesPlayed = period * 12;
        if (gameMinutesPlayed > 0) {
          pace = Math.round((estimatedPossessions / gameMinutesPlayed) * 48);
        }
      }
    }

    return {
      eventId,
      period,
      clock,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      status: gameStatus,
      gameProgress,
      players,
      pace,
    };
  } catch (error) {
    console.error(`[UnifiedFeed] Error processing game ${eventId}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { eventIds: requestedEventIds } = body;

    console.log('[UnifiedFeed] Request for events:', requestedEventIds || 'all live');

    // Get event IDs to fetch
    let eventIds: string[] = requestedEventIds || [];
    
    // If no specific events requested, fetch all live games
    if (eventIds.length === 0) {
      eventIds = await fetchLiveGames();
    }

    console.log(`[UnifiedFeed] Fetching ${eventIds.length} games`);

    // Fetch all games in parallel
    const gamePromises = eventIds.map(async (eventId) => {
      const data = await fetchGameData(eventId);
      if (!data) return null;
      return processGameData(data, eventId);
    });

    const games = (await Promise.all(gamePromises)).filter((g): g is UnifiedGame => g !== null);

    const result = {
      games,
      totalPlayers: games.reduce((sum, g) => sum + g.players.length, 0),
      liveGames: games.filter(g => g.status === 'in_progress').length,
      lastUpdated: new Date().toISOString(),
    };

    console.log(`[UnifiedFeed] Returning ${result.totalPlayers} players from ${games.length} games`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[UnifiedFeed] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

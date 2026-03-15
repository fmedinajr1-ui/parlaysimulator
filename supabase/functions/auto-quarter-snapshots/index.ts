import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerStats {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  minutes: string;
}

function parseMinutesToNumber(min: string): number {
  if (!min) return 0;
  const parts = min.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  }
  return parseFloat(min) || 0;
}

async function fetchPlayerBoxScore(eventId: string): Promise<PlayerStats[]> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    const boxscore = data?.boxscore;
    if (!boxscore?.players) return [];

    const players: PlayerStats[] = [];

    for (const teamPlayers of boxscore.players) {
      const teamName = teamPlayers.team?.abbreviation || 'Unknown';

      for (const statCategory of (teamPlayers.statistics || [])) {
        const labels = statCategory.labels || [];

        for (const athlete of (statCategory.athletes || [])) {
          const rawStats: Record<string, string> = {};
          (athlete.stats || []).forEach((value: string, idx: number) => {
            const label = labels[idx];
            if (label) rawStats[label.toLowerCase()] = value;
          });

          // Only include players with minutes
          const minutes = rawStats.min || '0';
          if (minutes === '0' || minutes === '0:00') continue;

          players.push({
            playerId: athlete.athlete?.id || '',
            playerName: athlete.athlete?.displayName || 'Unknown',
            team: teamName,
            position: athlete.athlete?.position?.abbreviation || '',
            points: parseInt(rawStats.pts) || 0,
            rebounds: parseInt(rawStats.reb) || 0,
            assists: parseInt(rawStats.ast) || 0,
            threes: parseInt(rawStats['3pm'] || rawStats.threes || '0') || 0,
            steals: parseInt(rawStats.stl) || 0,
            blocks: parseInt(rawStats.blk) || 0,
            turnovers: parseInt(rawStats.to) || 0,
            fouls: parseInt(rawStats.pf) || 0,
            minutes,
          });
        }
      }
    }

    return players;
  } catch (error) {
    console.error(`Error fetching box score for event ${eventId}:`, error);
    return [];
  }
}

function parseQuarterNumber(period: string | null): number {
  if (!period) return 0;
  const p = period.toUpperCase();
  if (p === 'Q1' || p === '1') return 1;
  if (p === 'Q2' || p === '2') return 2;
  if (p === 'Q3' || p === '3') return 3;
  if (p === 'Q4' || p === '4') return 4;
  if (p.startsWith('OT')) return 5;
  return parseInt(p) || 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Auto-quarter-snapshots: checking for NBA games in progress...');

    // 1. Get all NBA games currently in progress, at halftime, or just finished
    const { data: liveGames, error: gamesError } = await supabase
      .from('live_game_scores')
      .select('*')
      .eq('sport', 'NBA')
      .in('game_status', ['in_progress', 'halftime', 'final']);

    if (gamesError) {
      throw new Error(`Failed to query live_game_scores: ${gamesError.message}`);
    }

    if (!liveGames || liveGames.length === 0) {
      console.log('No NBA games in progress.');
      return new Response(JSON.stringify({ success: true, message: 'No NBA games in progress', snapshots_created: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${liveGames.length} NBA games to check.`);
    let totalSnapshots = 0;

    for (const game of liveGames) {
      const eventId = game.event_id;
      const currentPeriod = parseQuarterNumber(game.period);

      if (currentPeriod === 0) {
        console.log(`Game ${eventId}: could not parse period "${game.period}", skipping.`);
        continue;
      }

      // 2. Check which quarters are already snapshotted for this event
      const { data: existingSnapshots, error: snapError } = await supabase
        .from('quarter_player_snapshots')
        .select('quarter')
        .eq('event_id', eventId);

      if (snapError) {
        console.error(`Error querying snapshots for ${eventId}:`, snapError);
        continue;
      }

      const capturedQuarters = new Set((existingSnapshots || []).map(s => s.quarter));

      // Determine which quarters need capturing
      // We can snapshot quarters that have completed (< currentPeriod)
      // For halftime: Q1 and Q2 are done
      // For final: all 4 quarters are done
      let maxCompletedQuarter = currentPeriod - 1;
      if (game.game_status === 'halftime') maxCompletedQuarter = 2;
      if (game.game_status === 'final') maxCompletedQuarter = 4;

      const quartersToCapture: number[] = [];
      for (let q = 1; q <= Math.min(maxCompletedQuarter, 4); q++) {
        if (!capturedQuarters.has(q)) {
          quartersToCapture.push(q);
        }
      }

      if (quartersToCapture.length === 0) {
        console.log(`Game ${eventId}: all completed quarters already captured (period=${game.period}).`);
        continue;
      }

      console.log(`Game ${eventId}: capturing quarters ${quartersToCapture.join(',')} (current period=${game.period})`);

      // 3. Fetch current cumulative box score from ESPN
      const cumulativeStats = await fetchPlayerBoxScore(eventId);
      if (cumulativeStats.length === 0) {
        console.log(`Game ${eventId}: no player stats available from ESPN.`);
        continue;
      }

      // 4. Get previously captured cumulative snapshots to calculate deltas
      // We need all existing snapshots for this event to compute deltas
      const { data: allSnapshots } = await supabase
        .from('quarter_player_snapshots')
        .select('*')
        .eq('event_id', eventId)
        .order('quarter', { ascending: true });

      // Build cumulative totals per player from existing snapshots
      const playerCumulatives: Record<string, { points: number; rebounds: number; assists: number; threes: number; turnovers: number; fouls: number; minutes: number }> = {};
      for (const snap of (allSnapshots || [])) {
        const key = snap.player_name;
        if (!playerCumulatives[key]) {
          playerCumulatives[key] = { points: 0, rebounds: 0, assists: 0, threes: 0, turnovers: 0, fouls: 0, minutes: 0 };
        }
        playerCumulatives[key].points += snap.points || 0;
        playerCumulatives[key].rebounds += snap.rebounds || 0;
        playerCumulatives[key].assists += snap.assists || 0;
        playerCumulatives[key].threes += snap.threes || 0;
        playerCumulatives[key].turnovers += snap.turnovers || 0;
        playerCumulatives[key].fouls += snap.fouls || 0;
        playerCumulatives[key].minutes += parseMinutesToNumber(String(snap.minutes_played || '0'));
      }

      // 5. For each quarter to capture, calculate per-quarter deltas
      // Since ESPN gives cumulative stats, we distribute evenly if capturing multiple quarters at once
      // But ideally we capture one quarter at a time as periods advance
      const now = new Date().toISOString();
      const rows: any[] = [];

      for (const player of cumulativeStats) {
        const prev = playerCumulatives[player.playerName] || { points: 0, rebounds: 0, assists: 0, threes: 0, turnovers: 0, fouls: 0, minutes: 0 };

        // Total delta from cumulative ESPN stats minus what we've already captured
        const totalDelta = {
          points: Math.max(0, player.points - prev.points),
          rebounds: Math.max(0, player.rebounds - prev.rebounds),
          assists: Math.max(0, player.assists - prev.assists),
          threes: Math.max(0, player.threes - prev.threes),
          turnovers: Math.max(0, player.turnovers - prev.turnovers),
          fouls: Math.max(0, player.fouls - prev.fouls),
          minutes: Math.max(0, parseMinutesToNumber(player.minutes) - prev.minutes),
        };

        // If capturing multiple quarters at once, distribute evenly
        const qCount = quartersToCapture.length;
        for (const q of quartersToCapture) {
          rows.push({
            event_id: eventId,
            espn_event_id: eventId,
            player_name: player.playerName,
            team: player.team,
            quarter: q,
            points: Math.round(totalDelta.points / qCount),
            rebounds: Math.round(totalDelta.rebounds / qCount),
            assists: Math.round(totalDelta.assists / qCount),
            threes: Math.round(totalDelta.threes / qCount),
            turnovers: Math.round(totalDelta.turnovers / qCount),
            fouls: Math.round(totalDelta.fouls / qCount),
            minutes_played: Math.round((totalDelta.minutes / qCount) * 10) / 10,
            captured_at: now,
          });
        }
      }

      if (rows.length > 0) {
        // Batch upsert - use event_id + player_name + quarter as conflict key
        const { error: upsertError } = await supabase
          .from('quarter_player_snapshots')
          .upsert(rows, { onConflict: 'event_id,player_name,quarter' });

        if (upsertError) {
          console.error(`Error upserting snapshots for ${eventId}:`, upsertError);
        } else {
          totalSnapshots += rows.length;
          console.log(`Game ${eventId}: inserted ${rows.length} snapshot rows for quarters ${quartersToCapture.join(',')}`);
        }
      }
    }

    console.log(`Auto-quarter-snapshots complete: ${totalSnapshots} total snapshots created.`);

    return new Response(JSON.stringify({
      success: true,
      games_checked: liveGames.length,
      snapshots_created: totalSnapshots,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Auto-quarter-snapshots error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

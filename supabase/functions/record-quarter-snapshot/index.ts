import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerLiveState {
  playerName: string;
  jersey: string;
  team: string;
  fatigueScore: number;
  effortScore: number;
  speedIndex: number;
  reboundPositionScore: number;
  foulCount: number;
  visualFlags: string[];
  handsOnKneesCount?: number;
  slowRecoveryCount?: number;
  sprintCount?: number;
  role?: string;
  rotation?: {
    rotationRole?: string;
    onCourtStability?: number;
    foulRiskLevel?: string;
  };
  boxScore?: {
    points?: number;
    rebounds?: number;
    assists?: number;
    fouls?: number;
    turnovers?: number;
    threes?: number;
  };
}

interface PBPPlayer {
  playerName: string;
  team: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  fouls: number;
  threePm?: number;
}

interface SnapshotRequest {
  eventId: string;
  espnEventId?: string;
  quarter: number;
  gameTime: string;
  playerStates: Record<string, PlayerLiveState>;
  pbpPlayers: PBPPlayer[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json() as SnapshotRequest;
    const { eventId, espnEventId, quarter, gameTime, playerStates, pbpPlayers } = body;

    if (!eventId || !quarter || quarter < 1 || quarter > 4) {
      return new Response(
        JSON.stringify({ error: 'Invalid eventId or quarter (must be 1-4)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Quarter Snapshot] Recording Q${quarter} snapshot for event ${eventId}`);
    console.log(`[Quarter Snapshot] Player states: ${Object.keys(playerStates).length}, PBP players: ${pbpPlayers.length}`);

    // Build snapshot records from merged data
    const snapshots: any[] = [];
    const capturedAt = new Date().toISOString();

    // Create a map of PBP data for quick lookup
    const pbpMap = new Map<string, PBPPlayer>();
    for (const p of pbpPlayers) {
      pbpMap.set(p.playerName.toLowerCase(), p);
    }

    // Process each player state
    for (const [playerName, state] of Object.entries(playerStates)) {
      // Find matching PBP data (case-insensitive match)
      const pbpData = pbpMap.get(playerName.toLowerCase()) || 
                      pbpPlayers.find(p => 
                        p.playerName.toLowerCase().includes(playerName.toLowerCase().split(' ').pop() || '')
                      );

      const snapshot = {
        event_id: eventId,
        espn_event_id: espnEventId || null,
        quarter,
        player_name: playerName,
        team: state.team || pbpData?.team || null,
        minutes_played: pbpData?.minutes || 0,
        points: pbpData?.points || state.boxScore?.points || 0,
        rebounds: pbpData?.rebounds || state.boxScore?.rebounds || 0,
        assists: pbpData?.assists || state.boxScore?.assists || 0,
        fouls: pbpData?.fouls || state.boxScore?.fouls || state.foulCount || 0,
        turnovers: state.boxScore?.turnovers || 0,
        threes: pbpData?.threePm || state.boxScore?.threes || 0,
        fatigue_score: state.fatigueScore || null,
        effort_score: state.effortScore || null,
        speed_index: state.speedIndex || null,
        rebound_position_score: state.reboundPositionScore || null,
        rotation_role: state.rotation?.rotationRole || null,
        on_court_stability: state.rotation?.onCourtStability || null,
        foul_risk_level: state.rotation?.foulRiskLevel || null,
        player_role: state.role || null,
        visual_flags: state.visualFlags || [],
        hands_on_knees_count: state.handsOnKneesCount || 0,
        slow_recovery_count: state.slowRecoveryCount || 0,
        sprint_count: state.sprintCount || 0,
        risk_flags: [],
        captured_at: capturedAt,
      };

      snapshots.push(snapshot);
    }

    // Upsert all snapshots (update if exists for same event/quarter/player)
    const { data, error } = await supabase
      .from('quarter_player_snapshots')
      .upsert(snapshots, {
        onConflict: 'event_id,quarter,player_name',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`[Quarter Snapshot] Insert error:`, error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Quarter Snapshot] Successfully recorded ${snapshots.length} player snapshots for Q${quarter}`);

    return new Response(
      JSON.stringify({
        success: true,
        quarter,
        playersRecorded: snapshots.length,
        gameTime,
        capturedAt,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Quarter Snapshot] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

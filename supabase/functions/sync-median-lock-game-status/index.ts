import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

interface GameResult {
  eventId: string;
  status: 'scheduled' | 'in_progress' | 'final' | 'postponed';
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  startTime: string;
  period?: string;
  clock?: string;
  sport?: string;
}

interface MedianLockCandidate {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  book_line: number;
  game_status: string;
  slate_date: string;
  outcome: string;
}

// Normalize team name for matching
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Match candidate to game
function matchCandidateToGame(candidate: MedianLockCandidate, games: GameResult[]): GameResult | null {
  const teamNorm = normalizeTeamName(candidate.team_name);
  
  for (const game of games) {
    const homeNorm = normalizeTeamName(game.homeTeam);
    const awayNorm = normalizeTeamName(game.awayTeam);
    
    // Check if team name contains or is contained in either team
    if (teamNorm.includes(homeNorm) || homeNorm.includes(teamNorm) ||
        teamNorm.includes(awayNorm) || awayNorm.includes(teamNorm)) {
      return game;
    }
    
    // Check last word match (e.g., "Lakers" from "Los Angeles Lakers")
    const teamLastWord = teamNorm.split(' ').pop() || '';
    const homeLastWord = homeNorm.split(' ').pop() || '';
    const awayLastWord = awayNorm.split(' ').pop() || '';
    
    if (teamLastWord.length > 3) {
      if (teamLastWord === homeLastWord || teamLastWord === awayLastWord) {
        return game;
      }
    }
  }
  
  return null;
}

// Map game status to our format
function mapGameStatus(status: string): 'scheduled' | 'live' | 'final' | 'postponed' {
  switch (status) {
    case 'in_progress': return 'live';
    case 'final': return 'final';
    case 'postponed': return 'postponed';
    default: return 'scheduled';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { trigger } = await req.json().catch(() => ({}));
    console.log(`[sync-median-lock-game-status] Starting sync, trigger: ${trigger || 'manual'}`);

    // Get today's date
    const today = getEasternDate();

    // Fetch all candidates that need status updates (not final)
    const { data: candidates, error: candidatesError } = await supabase
      .from('median_lock_candidates')
      .select('*')
      .eq('slate_date', today)
      .neq('game_status', 'final')
      .neq('outcome', 'hit')
      .neq('outcome', 'miss');

    if (candidatesError) {
      throw new Error(`Error fetching candidates: ${candidatesError.message}`);
    }

    if (!candidates || candidates.length === 0) {
      console.log('[sync-median-lock-game-status] No candidates need status updates');
      return new Response(
        JSON.stringify({ success: true, message: 'No candidates to update', updated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[sync-median-lock-game-status] Found ${candidates.length} candidates to check`);

    // Fetch game scores from our fetch-game-scores function
    const { data: scoresData, error: scoresError } = await supabase.functions.invoke('fetch-game-scores', {
      body: { sport: 'nba', date: today }
    });

    if (scoresError) {
      throw new Error(`Error fetching game scores: ${scoresError.message}`);
    }

    const games: GameResult[] = scoresData?.games || [];
    console.log(`[sync-median-lock-game-status] Fetched ${games.length} games`);

    let updatedCount = 0;
    let finalizedCount = 0;
    const updates: { id: string; status: string; homeScore?: number; awayScore?: number }[] = [];

    // Match each candidate to a game and update status
    for (const candidate of candidates) {
      const matchedGame = matchCandidateToGame(candidate as MedianLockCandidate, games);
      
      if (matchedGame) {
        const newStatus = mapGameStatus(matchedGame.status);
        const statusChanged = candidate.game_status !== newStatus;
        const scoresChanged = candidate.home_score !== matchedGame.homeScore || 
                             candidate.away_score !== matchedGame.awayScore;

        if (statusChanged || scoresChanged) {
          const updateData: Record<string, unknown> = {
            game_status: newStatus,
            home_team: matchedGame.homeTeam,
            away_team: matchedGame.awayTeam,
            home_score: matchedGame.homeScore,
            away_score: matchedGame.awayScore,
            game_clock: matchedGame.clock || null,
            game_period: matchedGame.period || null,
            game_start_time: matchedGame.startTime,
          };

          // If game just became final, set final time
          if (newStatus === 'final' && candidate.game_status !== 'final') {
            updateData.game_final_time = new Date().toISOString();
            finalizedCount++;
            console.log(`[sync-median-lock-game-status] Game finalized for ${candidate.player_name}`);
          }

          const { error: updateError } = await supabase
            .from('median_lock_candidates')
            .update(updateData)
            .eq('id', candidate.id);

          if (updateError) {
            console.error(`Error updating candidate ${candidate.id}:`, updateError);
          } else {
            updatedCount++;
            updates.push({
              id: candidate.id,
              status: newStatus,
              homeScore: matchedGame.homeScore ?? undefined,
              awayScore: matchedGame.awayScore ?? undefined,
            });
          }
        }
      }
    }

    // If any games finalized, trigger outcome verification
    if (finalizedCount > 0) {
      console.log(`[sync-median-lock-game-status] Triggering outcome verification for ${finalizedCount} finalized games`);
      
      const { error: verifyError } = await supabase.functions.invoke('verify-median-lock-outcomes', {
        body: { trigger: 'game-status-sync' }
      });

      if (verifyError) {
        console.error('Error triggering outcome verification:', verifyError);
      }
    }

    console.log(`[sync-median-lock-game-status] Sync complete. Updated: ${updatedCount}, Finalized: ${finalizedCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        updated: updatedCount,
        finalized: finalizedCount,
        gamesChecked: games.length,
        candidatesChecked: candidates.length,
        updates,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[sync-median-lock-game-status] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

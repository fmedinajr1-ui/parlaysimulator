import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerificationResult {
  parlayId: string;
  originalOutcome: string;
  verifiedOutcome: string | null;
  isCorrect: boolean;
  reason: string;
  legDetails: Array<{
    description: string;
    originalResult: string;
    verifiedResult: string | null;
    statsDate: string | null;
    gameDate: string | null;
    hasValidStats: boolean;
  }>;
}

// Normalize player names for matching
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse player prop from description
function parsePlayerProp(description: string): { playerName: string; propType: string; line: number; side: string } | null {
  // Pattern: "Player Name Over/Under X.5 Prop Type"
  const patterns = [
    /^(.+?)\s+(over|under)\s+([\d.]+)\s+(.+)$/i,
    /^(.+?)\s+-\s+(over|under)\s+([\d.]+)\s+(.+)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      return {
        playerName: match[1].trim(),
        side: match[2].toLowerCase(),
        line: parseFloat(match[3]),
        propType: match[4].trim().toLowerCase()
      };
    }
  }
  return null;
}

// Map prop type to database column
function mapPropTypeToColumn(propType: string): string | null {
  const propMapping: Record<string, string> = {
    'points': 'points',
    'pts': 'points',
    'rebounds': 'rebounds',
    'reb': 'rebounds',
    'rebs': 'rebounds',
    'assists': 'assists',
    'ast': 'assists',
    'threes': 'threes_made',
    '3-pointers': 'threes_made',
    '3pm': 'threes_made',
    'three pointers': 'threes_made',
    'blocks': 'blocks',
    'blk': 'blocks',
    'steals': 'steals',
    'stl': 'steals',
  };
  
  const normalizedProp = propType.toLowerCase().trim();
  for (const [key, value] of Object.entries(propMapping)) {
    if (normalizedProp.includes(key)) {
      return value;
    }
  }
  return null;
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

    // Parse request body for options
    const { include_pending = false, limit = 500 } = await req.json().catch(() => ({}));
    
    console.log(`🔍 Starting parlay verification (include_pending: ${include_pending})...`);

    // Get parlays based on mode
    const outcomes = include_pending ? ['won', 'lost', 'pending'] : ['won', 'lost'];
    const { data: parlaysToVerify, error: parlaysError } = await supabase
      .from('ai_generated_parlays')
      .select('*')
      .in('outcome', outcomes)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (parlaysError) {
      throw new Error(`Failed to fetch parlays: ${parlaysError.message}`);
    }

    console.log(`📊 Found ${parlaysToVerify?.length || 0} parlays to verify`);

    // Get all player stats for reference
    const { data: nbaStats } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, game_date, points, rebounds, assists, threes_made, blocks, steals')
      .order('game_date', { ascending: false });

    const { data: nflStats } = await supabase
      .from('nfl_player_game_logs')
      .select('player_name, game_date, passing_yards, rushing_yards, receiving_yards, receptions')
      .order('game_date', { ascending: false });

    const { data: nhlStats } = await supabase
      .from('nhl_player_game_logs')
      .select('player_name, game_date, goals, assists, points, shots_on_goal')
      .order('game_date', { ascending: false });

    // Get latest stats dates
    const latestNbaDate = nbaStats?.[0]?.game_date || 'none';
    const latestNflDate = nflStats?.[0]?.game_date || 'none';
    const latestNhlDate = nhlStats?.[0]?.game_date || 'none';

    console.log(`📅 Latest stats dates - NBA: ${latestNbaDate}, NFL: ${latestNflDate}, NHL: ${latestNhlDate}`);

    const verificationResults: VerificationResult[] = [];
    let correctCount = 0;
    let incorrectCount = 0;
    let unverifiableCount = 0;
    
    // Track pending analysis
    const pendingAnalysis = {
      total: 0,
      missingStats: 0,
      gameNotStarted: 0,
      readyToSettle: 0,
      missingStatsDetails: [] as Array<{ player: string; gameDate: string; sport: string }>
    };

    for (const parlay of parlaysToVerify || []) {
      const isPendingParlay = parlay.outcome === 'pending';
      if (isPendingParlay) pendingAnalysis.total++;
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      const legDetails: VerificationResult['legDetails'] = [];
      let allLegsVerifiable = true;
      let allLegsWon = true;
      let anyLegLost = false;

      for (const leg of legs) {
        const description = leg.description || leg.pick || '';
        const commenceTime = leg.commence_time || leg.commenceTime;
        const gameDate = commenceTime ? new Date(commenceTime).toISOString().split('T')[0] : null;
        
        // Parse the prop
        const parsed = parsePlayerProp(description);
        
        if (!parsed || !gameDate) {
          legDetails.push({
            description,
            originalResult: leg.outcome || 'unknown',
            verifiedResult: null,
            statsDate: null,
            gameDate,
            hasValidStats: false
          });
          allLegsVerifiable = false;
          continue;
        }

        // Find stats for this player on the exact game date
        const normalizedName = normalizePlayerName(parsed.playerName);
        const column = mapPropTypeToColumn(parsed.propType);
        
        let statsForDate: any = null;
        let statsSource = '';

        // Check NBA stats
        const nbaMatch = nbaStats?.find(s => 
          normalizePlayerName(s.player_name) === normalizedName && 
          s.game_date === gameDate
        );
        if (nbaMatch && column && column in nbaMatch) {
          statsForDate = nbaMatch;
          statsSource = 'nba';
        }

        // Check NFL stats
        if (!statsForDate) {
          const nflMatch = nflStats?.find(s => 
            normalizePlayerName(s.player_name) === normalizedName && 
            s.game_date === gameDate
          );
          if (nflMatch && column && column in nflMatch) {
            statsForDate = nflMatch;
            statsSource = 'nfl';
          }
        }

        // Check NHL stats
        if (!statsForDate) {
          const nhlMatch = nhlStats?.find(s => 
            normalizePlayerName(s.player_name) === normalizedName && 
            s.game_date === gameDate
          );
          if (nhlMatch && column && column in nhlMatch) {
            statsForDate = nhlMatch;
            statsSource = 'nhl';
          }
        }

        if (!statsForDate || !column) {
          legDetails.push({
            description,
            originalResult: leg.outcome || 'unknown',
            verifiedResult: 'pending',
            statsDate: null,
            gameDate,
            hasValidStats: false
          });
          allLegsVerifiable = false;
          continue;
        }

        // Verify the outcome
        const actualValue = statsForDate[column] as number;
        const isOver = parsed.side === 'over';
        const legWon = isOver ? actualValue > parsed.line : actualValue < parsed.line;

        legDetails.push({
          description,
          originalResult: leg.outcome || 'unknown',
          verifiedResult: legWon ? 'won' : 'lost',
          statsDate: statsForDate.game_date,
          gameDate,
          hasValidStats: true
        });

        if (!legWon) {
          anyLegLost = true;
          allLegsWon = false;
        }
      }

      // Determine verified outcome
      let verifiedOutcome: string | null = null;
      let isCorrect = false;
      let reason = '';

      if (!allLegsVerifiable) {
        verifiedOutcome = null;
        if (isPendingParlay) {
          reason = 'Pending - missing stats for some legs';
          pendingAnalysis.missingStats++;
        } else {
          reason = 'Some legs have no stats for their game date - cannot verify';
        }
        unverifiableCount++;
      } else if (anyLegLost) {
        verifiedOutcome = 'lost';
        if (isPendingParlay) {
          reason = 'READY TO SETTLE: Should be marked LOST';
          pendingAnalysis.readyToSettle++;
        } else {
          isCorrect = parlay.outcome === 'lost';
          reason = isCorrect ? 'Correctly marked as lost' : `INCORRECT: Was marked as ${parlay.outcome} but should be lost`;
          if (isCorrect) correctCount++; else incorrectCount++;
        }
      } else if (allLegsWon) {
        verifiedOutcome = 'won';
        if (isPendingParlay) {
          reason = 'READY TO SETTLE: Should be marked WON';
          pendingAnalysis.readyToSettle++;
        } else {
          isCorrect = parlay.outcome === 'won';
          reason = isCorrect ? 'Correctly marked as won' : `INCORRECT: Was marked as ${parlay.outcome} but should be won`;
          if (isCorrect) correctCount++; else incorrectCount++;
        }
      }

      verificationResults.push({
        parlayId: parlay.id,
        originalOutcome: parlay.outcome,
        verifiedOutcome,
        isCorrect,
        reason,
        legDetails
      });
    }

    // Summary
    const summary = {
      totalVerified: parlaysToVerify?.length || 0,
      correctlySettled: correctCount,
      incorrectlySettled: incorrectCount,
      unverifiable: unverifiableCount,
      accuracyRate: (correctCount + incorrectCount) > 0
        ? ((correctCount / (correctCount + incorrectCount)) * 100).toFixed(1) + '%'
        : 'N/A',
      latestStatsAvailable: {
        nba: latestNbaDate,
        nfl: latestNflDate,
        nhl: latestNhlDate
      },
      pendingAnalysis: include_pending ? pendingAnalysis : undefined
    };

    console.log('✅ Verification complete:', JSON.stringify(summary, null, 2));

    return new Response(JSON.stringify({
      success: true,
      summary,
      results: verificationResults,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Verification error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

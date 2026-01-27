import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PPSnapshot {
  id: string;
  player_name: string;
  pp_line: number;
  stat_type: string;
  sport: string;
  start_time: string;
  captured_at: string;
  previous_line: number | null;
  team: string | null;
  matchup: string | null;
  market_key: string;
}

interface UnifiedProp {
  id: string;
  player_name: string;
  prop_type: string;
  current_line: number;
  sport: string;
  event_id: string;
  bookmaker: string;
  game_description: string;
  commence_time: string;
}

// Calculate SharpScore components
function calculateDivergence(ppLine: number, bookConsensus: number): number {
  const lineDiff = Math.abs(ppLine - bookConsensus);
  // 0.5 point diff = 4 pts, 1 point diff = 8 pts, up to 5 pts diff = 40 pts
  return Math.min(40, lineDiff * 8);
}

function calculateMoveSpeed(currentLine: number, previousLine: number | null, minutesSinceChange: number): number {
  if (!previousLine || previousLine === currentLine) return 0;
  
  const lineDelta = Math.abs(currentLine - previousLine);
  const speed = lineDelta / Math.max(1, minutesSinceChange / 60); // Points per hour
  
  // Fast moves (>1 pt/hour) = 25 pts, slow moves = proportionally less
  return Math.min(25, speed * 12.5);
}

function calculateConfirmation(ppLine: number, bookLines: number[]): number {
  if (bookLines.length < 2) return 0;
  
  // Check if books are moving toward PP line
  const avgBook = bookLines.reduce((a, b) => a + b, 0) / bookLines.length;
  const spread = Math.max(...bookLines) - Math.min(...bookLines);
  
  // If spread is tight and close to PP, books are confirming
  if (spread < 0.5 && Math.abs(avgBook - ppLine) < 1) {
    return 20;
  } else if (spread < 1 && Math.abs(avgBook - ppLine) < 2) {
    return 10;
  }
  
  return 0;
}

function getConfidenceGrade(sharpScore: number): string {
  if (sharpScore >= 80) return 'A';
  if (sharpScore >= 65) return 'B';
  if (sharpScore >= 55) return 'C';
  return 'D'; // Won't be stored
}

function getRecommendedSide(ppLine: number, bookConsensus: number): string {
  // If PP line is lower than books, take OVER on PP (books think higher)
  // If PP line is higher than books, take UNDER on PP (books think lower)
  if (ppLine < bookConsensus) {
    return 'OVER';
  } else {
    return 'UNDER';
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
    const { sports = ['basketball_nba', 'hockey_nhl', 'basketball_wnba'] } = await req.json().catch(() => ({}));
    
    console.log('[Whale Detector] Starting signal detection for sports:', sports);
    
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    
    // Get fresh PP snapshots (last 5 minutes)
    const { data: ppSnapshots, error: ppError } = await supabase
      .from('pp_snapshot')
      .select('*')
      .in('sport', sports)
      .gte('captured_at', fiveMinutesAgo.toISOString())
      .gt('start_time', now.toISOString()) // Only future games
      .order('captured_at', { ascending: false });

    if (ppError) {
      console.error('[Whale Detector] PP snapshot fetch error:', ppError);
      throw new Error(`Failed to fetch PP snapshots: ${ppError.message}`);
    }

    const snapshots = (ppSnapshots || []) as PPSnapshot[];
    console.log('[Whale Detector] Found', snapshots.length, 'fresh PP snapshots');

    // FALLBACK: If no PP data, generate signals from book-to-book divergence
    if (snapshots.length === 0) {
      console.log('[Whale Detector] No PP data, checking book divergence...');
      
      const { data: bookDivergence } = await supabase
        .from('unified_props')
        .select('*')
        .in('sport', sports)
        .gt('commence_time', now.toISOString())
        .order('commence_time', { ascending: true })
        .limit(200);
      
      if (bookDivergence && bookDivergence.length > 0) {
        console.log('[Whale Detector] Found', bookDivergence.length, 'book props for divergence analysis');
        
        // Group by player + prop_type
        const playerMap = new Map<string, any[]>();
        for (const prop of bookDivergence as any[]) {
          const key = `${prop.player_name}_${prop.prop_type}`;
          if (!playerMap.has(key)) {
            playerMap.set(key, []);
          }
          playerMap.get(key)!.push(prop);
        }
        
        const divergenceSignals: Array<{
          market_key: string;
          player_name: string;
          stat_type: string;
          sport: string;
          pp_line: number;
          book_consensus: number;
          sharp_score: number;
          confidence_grade: string;
          confidence: string;
          divergence_pts: number;
          move_speed_pts: number;
          confirmation_pts: number;
          board_behavior_pts: number;
          recommended_side: string;
          pick_side: string;
          matchup: string;
          start_time: string;
          expires_at: string;
          created_at: string;
          signal_type: string;
          why_short: string[];
        }> = [];
        
        // Find props where bookmakers disagree by >= 1 point
        for (const [key, props] of playerMap) {
          if (props.length < 2) continue;
          
          const lines = props.map(p => p.current_line).filter(l => l != null && !isNaN(l));
          if (lines.length < 2) continue;
          
          const spread = Math.max(...lines) - Math.min(...lines);
          
          if (spread >= 1) {
            const avgLine = lines.reduce((a, b) => a + b, 0) / lines.length;
            const minLine = Math.min(...lines);
            const maxLine = Math.max(...lines);
            
            // Score based on divergence magnitude
            const divergencePts = Math.min(40, spread * 10);
            const sharpScore = 55 + divergencePts; // Base 55 + divergence bonus
            
            const confidenceGrade = sharpScore >= 80 ? 'A' : sharpScore >= 65 ? 'B' : 'C';
            const firstProp = props[0];
            const startTime = new Date(firstProp.commence_time);
            const expiresAt = new Date(startTime.getTime() - 5 * 60 * 1000);
            
            divergenceSignals.push({
              market_key: `divergence_${firstProp.sport}_${firstProp.player_name}_${firstProp.prop_type}`,
              player_name: firstProp.player_name,
              stat_type: firstProp.prop_type,
              sport: firstProp.sport,
              pp_line: avgLine, // Use avg as "PP line" proxy
              book_consensus: avgLine,
              sharp_score: Math.round(sharpScore),
              confidence_grade: confidenceGrade,
              confidence: confidenceGrade,
              divergence_pts: Math.round(divergencePts),
              move_speed_pts: 0,
              confirmation_pts: 0,
              board_behavior_pts: 0,
              recommended_side: minLine < avgLine ? 'OVER' : 'UNDER',
              pick_side: minLine < avgLine ? 'OVER' : 'UNDER',
              matchup: firstProp.game_description || 'TBD',
              start_time: firstProp.commence_time,
              expires_at: expiresAt.toISOString(),
              created_at: now.toISOString(),
              signal_type: 'book_divergence',
              why_short: [`${spread.toFixed(1)} pt book divergence`, `${props.length} books disagree`],
            });
          }
        }
        
        console.log('[Whale Detector] Generated', divergenceSignals.length, 'book divergence signals');
        
        if (divergenceSignals.length > 0) {
          // First, delete old divergence signals to prevent duplicates
          await supabase
            .from('whale_picks')
            .delete()
            .eq('signal_type', 'book_divergence');
          
          const { error: insertError } = await supabase
            .from('whale_picks')
            .insert(divergenceSignals);

          if (insertError) {
            console.error('[Whale Detector] Divergence insert error:', insertError);
          } else {
            console.log('[Whale Detector] Inserted', divergenceSignals.length, 'divergence signals');
          }
          
          return new Response(
            JSON.stringify({
              success: true,
              signalsGenerated: divergenceSignals.length,
              source: 'book_divergence',
              sampleSignals: divergenceSignals.slice(0, 3).map(s => ({
                player: s.player_name,
                stat: s.stat_type,
                divergence: s.divergence_pts,
                grade: s.confidence_grade,
              })),
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      
      return new Response(
        JSON.stringify({ success: true, signalsGenerated: 0, message: 'No fresh PP data or book divergence found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get book consensus from unified_props
    const playerNames = [...new Set(snapshots.map((p) => p.player_name))];
    
    const { data: bookProps, error: bookError } = await supabase
      .from('unified_props')
      .select('*')
      .in('player_name', playerNames)
      .in('sport', sports)
      .gt('commence_time', now.toISOString());

    if (bookError) {
      console.error('[Whale Detector] Book props fetch error:', bookError);
    }

    const books = (bookProps || []) as UnifiedProp[];
    console.log('[Whale Detector] Found', books.length, 'book props');

    // Build consensus map: player_name + stat_type -> { avgLine, lines[] }
    const consensusMap = new Map<string, { avgLine: number; lines: number[]; matchup: string; startTime: string }>();
    
    for (const prop of books) {
      // Normalize prop_type to stat type
      const statType = prop.prop_type.replace('player_', '');
      const key = `${prop.player_name.toLowerCase()}_${statType}`;
      
      if (!consensusMap.has(key)) {
        consensusMap.set(key, {
          avgLine: prop.current_line,
          lines: [prop.current_line],
          matchup: prop.game_description || 'TBD',
          startTime: prop.commence_time,
        });
      } else {
        const existing = consensusMap.get(key)!;
        existing.lines.push(prop.current_line);
        existing.avgLine = existing.lines.reduce((a, b) => a + b, 0) / existing.lines.length;
      }
    }

    // Get existing whale picks for deduplication
    const { data: existingPicks } = await supabase
      .from('whale_picks')
      .select('market_key, sharp_score, created_at')
      .gte('created_at', fifteenMinutesAgo.toISOString());

    const existingPickMap = new Map<string, { score: number; createdAt: string }>();
    if (existingPicks && Array.isArray(existingPicks)) {
      for (const pick of existingPicks as { market_key: string; sharp_score: number; created_at: string }[]) {
        existingPickMap.set(pick.market_key, {
          score: pick.sharp_score,
          createdAt: pick.created_at,
        });
      }
    }

    // Generate signals
    const newPicks: Array<{
      market_key: string;
      player_name: string;
      stat_type: string;
      sport: string;
      pp_line: number;
      book_consensus: number;
      sharp_score: number;
      confidence_grade: string;
      confidence: string;
      divergence_pts: number;
      move_speed_pts: number;
      confirmation_pts: number;
      board_behavior_pts: number;
      recommended_side: string;
      pick_side: string;
      matchup: string;
      start_time: string;
      expires_at: string;
      created_at: string;
      signal_type: string;
      why_short: string[];
    }> = [];
    
    const processedKeys = new Set<string>();

    for (const ppProp of snapshots) {
      try {
        const statType = ppProp.stat_type.replace('player_', '');
        const lookupKey = `${ppProp.player_name.toLowerCase()}_${statType}`;
        const marketKey = ppProp.market_key || `${ppProp.sport}_${ppProp.player_name}_${ppProp.stat_type}`;

        // Skip if already processed this market in this run
        if (processedKeys.has(marketKey)) continue;
        processedKeys.add(marketKey);

        // Find book consensus
        let consensus = consensusMap.get(lookupKey);
        
        if (!consensus) {
          // Try partial match by last name
          const lastName = ppProp.player_name.toLowerCase().split(' ').pop() || '';
          for (const [key, value] of consensusMap.entries()) {
            if (key.includes(lastName) && key.includes(statType)) {
              consensus = value;
              break;
            }
          }
        }

        if (!consensus) continue;

        const bookConsensus = consensus.avgLine;
        if (bookConsensus === 0) continue;

        // Calculate SharpScore components
        const divergencePts = calculateDivergence(ppProp.pp_line, bookConsensus);
        
        // Calculate time since last snapshot for move speed
        const capturedAt = new Date(ppProp.captured_at);
        const minutesSinceChange = (now.getTime() - capturedAt.getTime()) / 60000;
        const moveSpeedPts = calculateMoveSpeed(ppProp.pp_line, ppProp.previous_line, minutesSinceChange);
        
        const confirmationPts = calculateConfirmation(ppProp.pp_line, consensus.lines);
        
        // Board behavior: Check if this prop existed before (relisted = higher score)
        const boardBehaviorPts = ppProp.previous_line ? 5 : 0;

        const sharpScore = divergencePts + moveSpeedPts + confirmationPts + boardBehaviorPts;
        
        // Only generate signals for scores >= 55
        if (sharpScore < 55) continue;

        const confidenceGrade = getConfidenceGrade(sharpScore);
        
        // Deduplication check
        const existing = existingPickMap.get(marketKey);
        if (existing) {
          const scoreDiff = sharpScore - existing.score;
          if (scoreDiff < 15) {
            // Skip - not enough improvement
            continue;
          }
        }

        const startTime = new Date(ppProp.start_time);
        const expiresAt = new Date(startTime.getTime() - 5 * 60 * 1000); // 5 min before game

        const recommendedSide = getRecommendedSide(ppProp.pp_line, bookConsensus);
        
        // Build why_short array with signal reasons
        const whyShort: string[] = [];
        if (divergencePts >= 20) whyShort.push(`${(ppProp.pp_line - bookConsensus).toFixed(1)} pt divergence`);
        if (moveSpeedPts >= 10) whyShort.push('Fast line movement');
        if (confirmationPts >= 10) whyShort.push('Books confirming');
        if (boardBehaviorPts > 0) whyShort.push('Line relisted');

        const pick = {
          market_key: marketKey,
          player_name: ppProp.player_name,
          stat_type: ppProp.stat_type,
          sport: ppProp.sport,
          pp_line: ppProp.pp_line,
          book_consensus: bookConsensus,
          sharp_score: sharpScore,
          confidence_grade: confidenceGrade,
          confidence: confidenceGrade, // For existing schema compatibility
          divergence_pts: divergencePts,
          move_speed_pts: moveSpeedPts,
          confirmation_pts: confirmationPts,
          board_behavior_pts: boardBehaviorPts,
          recommended_side: recommendedSide,
          pick_side: recommendedSide, // For existing schema compatibility
          matchup: consensus.matchup,
          start_time: ppProp.start_time,
          expires_at: expiresAt.toISOString(),
          created_at: now.toISOString(),
          signal_type: 'pp_divergence',
          why_short: whyShort,
        };

        newPicks.push(pick);
        
      } catch (propError) {
        console.error('[Whale Detector] Error processing prop:', propError);
      }
    }

    console.log('[Whale Detector] Generated', newPicks.length, 'new signals');

    if (newPicks.length > 0) {
      // Upsert picks (update if market_key exists)
      const { error: insertError } = await supabase
        .from('whale_picks')
        .upsert(newPicks, { onConflict: 'market_key' });

      if (insertError) {
        console.error('[Whale Detector] Insert error:', insertError);
        throw new Error(`Failed to insert picks: ${insertError.message}`);
      }
    }

    // Cleanup expired picks
    const { error: deleteError } = await supabase
      .from('whale_picks')
      .delete()
      .lt('expires_at', now.toISOString());

    if (deleteError) {
      console.error('[Whale Detector] Cleanup error:', deleteError);
    }

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'whale-signal-detector',
      status: 'completed',
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        signalsGenerated: newPicks.length,
        ppSnapshotsProcessed: snapshots.length,
        bookPropsMatched: books.length,
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        signalsGenerated: newPicks.length,
        ppSnapshotsProcessed: snapshots.length,
        sampleSignals: newPicks.slice(0, 3).map(p => ({
          player: p.player_name,
          stat: p.stat_type,
          ppLine: p.pp_line,
          bookConsensus: p.book_consensus,
          sharpScore: p.sharp_score,
          grade: p.confidence_grade,
          side: p.recommended_side,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Whale Detector] Fatal error:', errorMessage);
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

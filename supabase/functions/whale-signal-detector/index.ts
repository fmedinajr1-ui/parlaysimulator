import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// All supported sports including Tennis and NFL
const ALL_SPORTS = [
  'basketball_nba', 
  'icehockey_nhl', 
  'basketball_wnba', 
  'tennis_atp', 
  'tennis_wta',
  'tennis_pingpong',
  'americanfootball_nfl',
  'basketball_ncaab',
  'americanfootball_ncaaf',
];

// Sport-specific signal thresholds
const SPORT_THRESHOLDS: Record<string, { minDivergence: number; minScore: number }> = {
  'basketball_nba': { minDivergence: 0.5, minScore: 50 },
  'icehockey_nhl': { minDivergence: 0.3, minScore: 45 },
  'tennis_atp': { minDivergence: 0.5, minScore: 50 },
  'tennis_wta': { minDivergence: 0.5, minScore: 50 },
  'americanfootball_nfl': { minDivergence: 1.0, minScore: 50 },
  'basketball_wnba': { minDivergence: 0.5, minScore: 50 },
  'basketball_ncaab': { minDivergence: 0.5, minScore: 25 },
  'americanfootball_ncaaf': { minDivergence: 1.5, minScore: 50 },
  'tennis_pingpong': { minDivergence: 0.5, minScore: 45 },
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
  bookmaker: string;
  commence_time: string;
}

// Calculate SharpScore components
function calculateDivergence(ppLine: number, bookConsensus: number): number {
  const lineDiff = Math.abs(ppLine - bookConsensus);
  return Math.min(60, lineDiff * 16);
}

function calculateMoveSpeed(currentLine: number, previousLine: number | null, minutesSinceChange: number): number {
  if (!previousLine || previousLine === currentLine) return 0;
  const lineDelta = Math.abs(currentLine - previousLine);
  const speed = lineDelta / Math.max(1, minutesSinceChange / 60);
  return Math.min(25, speed * 12.5);
}

/** Snap a fractional line to the nearest 0.5 sportsbook increment. */
function snapLine(raw: number, betType?: string): number {
  if (betType === 'spread') {
    const floor = Math.floor(raw);
    return floor + 0.5;
  }
  return Math.round(raw * 2) / 2;
}

function calculateConfirmation(ppLine: number, bookLines: number[]): number {
  if (bookLines.length < 2) return 0;
  const avgBook = bookLines.reduce((a, b) => a + b, 0) / bookLines.length;
  const spread = Math.max(...bookLines) - Math.min(...bookLines);
  if (spread < 0.5 && Math.abs(avgBook - ppLine) < 1) return 20;
  if (spread < 1 && Math.abs(avgBook - ppLine) < 2) return 10;
  return 0;
}

function getConfidenceGrade(sharpScore: number): string {
  if (sharpScore >= 80) return 'A';
  if (sharpScore >= 65) return 'B';
  if (sharpScore >= 55) return 'C';
  return 'D';
}

function getRecommendedSide(ppLine: number, bookConsensus: number): string {
  return ppLine < bookConsensus ? 'OVER' : 'UNDER';
}

// Calculate sharp money signal for team props (spreads, totals)
function calculateTeamSharpScore(
  lines: number[],
  homeOdds: number[],
  awayOdds: number[],
  betType: string
): { sharpScore: number; recommendedSide: string; whyShort: string[] } {
  const whyShort: string[] = [];
  let sharpScore = 40; // Base score
  
  // Check line divergence
  if (lines.length >= 2) {
    const spread = Math.max(...lines) - Math.min(...lines);
    if (spread >= 0.5) {
      sharpScore += Math.min(25, spread * 15);
      whyShort.push(`${spread.toFixed(1)} pt line divergence`);
    }
  }
  
  // Check odds movement (sharp money indicator)
  // If one side has significantly better odds across books, sharps may be on it
  const validHomeOdds = homeOdds.filter(o => o != null && !isNaN(o));
  const validAwayOdds = awayOdds.filter(o => o != null && !isNaN(o));
  
  let recommendedSide = 'AWAY';
  
  if (validHomeOdds.length >= 2 && validAwayOdds.length >= 2) {
    const avgHome = validHomeOdds.reduce((a, b) => a + b, 0) / validHomeOdds.length;
    const avgAway = validAwayOdds.reduce((a, b) => a + b, 0) / validAwayOdds.length;
    
    // Odds divergence indicates sharp action
    const oddsDiff = Math.abs(avgHome - avgAway);
    if (oddsDiff >= 10) {
      sharpScore += Math.min(20, oddsDiff / 2);
      whyShort.push('Odds divergence detected');
    }
    
    // Recommend the side with worse (more negative or less positive) odds - that's where sharps are
    if (betType === 'spread') {
      recommendedSide = avgHome < avgAway ? 'HOME' : 'AWAY';
    } else if (betType === 'total') {
      recommendedSide = avgHome < avgAway ? 'OVER' : 'UNDER';
    } else {
      recommendedSide = avgHome < avgAway ? 'HOME' : 'AWAY';
    }
  }
  
  // Volume bonus
  if (lines.length >= 3) {
    sharpScore += 10;
    whyShort.push(`${lines.length} books tracked`);
  }
  
  return { sharpScore: Math.round(sharpScore), recommendedSide, whyShort };
}

// ========== PERPLEXITY SHARP INTEL INTEGRATION ==========

interface PerplexityIntel {
  playerName: string;
  propType: string | null;
  direction: string | null; // OVER, UNDER, favorite, underdog
  context: string;
}

async function fetchPerplexitySharpIntel(supabase: any): Promise<Map<string, PerplexityIntel[]>> {
  const today = new Date().toISOString().split('T')[0];
  const intelMap = new Map<string, PerplexityIntel[]>();

  try {
    const { data: findings } = await supabase
      .from('bot_research_findings')
      .select('category, summary, key_insights')
      .in('category', [
        'nba_nhl_sharp_signals',
        'ncaab_sharp_signals', 
        'tennis_sharp_signals',
        'table_tennis_signals',
        'value_line_discrepancies'
      ])
      .eq('research_date', today);

    if (!findings || findings.length === 0) {
      console.log('[Whale Detector] No Perplexity research findings for today');
      return intelMap;
    }

    console.log(`[Whale Detector] Found ${findings.length} Perplexity research entries for today`);

    const propKeywords = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'SOG', 'saves', 'goals', 'aces', 'points', 'rebounds', 'assists', 'steals', 'blocks'];
    const directionKeywords = { over: 'OVER', under: 'UNDER', favorite: 'favorite', underdog: 'underdog', rise: 'OVER', drop: 'UNDER', sharp: null };

    for (const finding of findings) {
      const textsToScan: string[] = [];
      if (finding.summary) textsToScan.push(finding.summary);
      if (finding.key_insights && Array.isArray(finding.key_insights)) {
        for (const insight of finding.key_insights) {
          if (typeof insight === 'string') textsToScan.push(insight);
          else if (insight && typeof insight === 'object' && insight.text) textsToScan.push(insight.text);
        }
      }

      for (const text of textsToScan) {
        // Extract player names: look for capitalized multi-word names
        const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
        let match;
        while ((match = namePattern.exec(text)) !== null) {
          const playerName = match[1];
          // Skip common non-player phrases
          if (['Sharp Money', 'Line Movement', 'Public Action', 'Reverse Steam', 'Value Line'].includes(playerName)) continue;

          // Find prop type nearby
          let propType: string | null = null;
          for (const kw of propKeywords) {
            if (text.toLowerCase().includes(playerName.toLowerCase()) && text.toUpperCase().includes(kw.toUpperCase())) {
              propType = kw.toUpperCase();
              break;
            }
          }

          // Find direction
          let direction: string | null = null;
          const lowerText = text.toLowerCase();
          for (const [kw, dir] of Object.entries(directionKeywords)) {
            if (lowerText.includes(kw)) {
              direction = dir;
              break;
            }
          }

          const normalizedName = playerName.toLowerCase();
          if (!intelMap.has(normalizedName)) {
            intelMap.set(normalizedName, []);
          }
          intelMap.get(normalizedName)!.push({
            playerName,
            propType,
            direction,
            context: text.substring(0, 120),
          });
        }
      }
    }

    console.log(`[Whale Detector] Extracted Perplexity intel for ${intelMap.size} players`);
    return intelMap;
  } catch (err) {
    console.error('[Whale Detector] Perplexity intel fetch error:', err);
    return intelMap;
  }
}

function matchPerplexitySignal(
  playerName: string,
  statType: string,
  recommendedSide: string,
  intelMap: Map<string, PerplexityIntel[]>
): { boost: number; reason: string } | null {
  const normalizedPlayer = playerName.toLowerCase();

  // Try exact match first, then substring
  let matchedIntels: PerplexityIntel[] | undefined;

  // Check if any intel key is a substring of the player name or vice versa
  for (const [key, intels] of intelMap) {
    if (normalizedPlayer.includes(key) || key.includes(normalizedPlayer)) {
      matchedIntels = intels;
      break;
    }
    // Also check last name match
    const playerLastName = normalizedPlayer.split(' ').pop() || '';
    const intelLastName = key.split(' ').pop() || '';
    if (playerLastName.length >= 4 && playerLastName === intelLastName) {
      matchedIntels = intels;
      break;
    }
  }

  if (!matchedIntels || matchedIntels.length === 0) return null;

  for (const intel of matchedIntels) {
    const propMatch = intel.propType && statType.toUpperCase().includes(intel.propType);
    const dirMatch = intel.direction && (
      intel.direction === recommendedSide ||
      (intel.direction === 'OVER' && recommendedSide === 'OVER') ||
      (intel.direction === 'UNDER' && recommendedSide === 'UNDER')
    );

    if (propMatch && dirMatch) {
      return { boost: 12, reason: `Perplexity: sharp money confirmed ${intel.direction} (${intel.context})` };
    }
    if (dirMatch) {
      return { boost: 8, reason: `Perplexity: sharp action ${intel.direction} confirmed (${intel.context})` };
    }
  }

  // Generic mention in sharp context
  return { boost: 5, reason: `Perplexity: player flagged in sharp intel (${matchedIntels[0].context})` };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { 
      sports = ALL_SPORTS,
      include_player_props = true,
      include_team_props = true
    } = await req.json().catch(() => ({}));
    
    console.log('[Whale Detector] Starting multi-sport signal detection for:', sports);
    console.log('[Whale Detector] Player props:', include_player_props, 'Team props:', include_team_props);
    
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    
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

    // ========== PLAYER PROPS DIVERGENCE ==========
    if (include_player_props) {
      // Get fresh PP snapshots (last 5 minutes)
      const { data: ppSnapshots, error: ppError } = await supabase
        .from('pp_snapshot')
        .select('*')
        .in('sport', sports)
        .gte('captured_at', fiveMinutesAgo.toISOString())
        .gt('start_time', now.toISOString())
        .order('captured_at', { ascending: false });

      if (ppError) {
        console.error('[Whale Detector] PP snapshot fetch error:', ppError);
      }

      const snapshots = (ppSnapshots || []) as PPSnapshot[];
      const realSnapshots = snapshots.filter(s => 
        !s.player_name.toLowerCase().startsWith('player ') &&
        s.player_name.split(' ').length >= 2
      );
      console.log('[Whale Detector] Found', snapshots.length, 'PP snapshots,', realSnapshots.length, 'real ones');

      // Book-to-book divergence for player props
      console.log('[Whale Detector] Checking book-to-book divergence...');
      
      const { data: bookDivergenceData } = await supabase
        .from('unified_props')
        .select('*')
        .in('sport', sports)
        .gt('commence_time', now.toISOString())
        .eq('is_active', true)
        .order('commence_time', { ascending: true })
        .limit(1000);
      
      const bookDivergence = bookDivergenceData || [];
      console.log('[Whale Detector] Found', bookDivergence.length, 'book props for divergence analysis');
      
      if (bookDivergence.length > 0) {
        // Group by player + prop_type
        const playerMap = new Map<string, any[]>();
        for (const prop of bookDivergence as any[]) {
          const key = `${prop.player_name}_${prop.prop_type}`;
          if (!playerMap.has(key)) {
            playerMap.set(key, []);
          }
          playerMap.get(key)!.push(prop);
        }

        // Find props where bookmakers disagree
        for (const [key, props] of playerMap) {
          if (props.length < 2) continue;
          
          const lines = props.map((p: any) => p.current_line).filter((l: number) => l != null && !isNaN(l));
          if (lines.length < 2) continue;
          
          const sport = props[0].sport;
          const threshold = SPORT_THRESHOLDS[sport] || SPORT_THRESHOLDS['basketball_nba'];
          const spread = Math.max(...lines) - Math.min(...lines);
          
          if (spread >= threshold.minDivergence) {
            const avgLine = snapLine(lines.reduce((a: number, b: number) => a + b, 0) / lines.length);
            const minLine = Math.min(...lines);
            
            // Enhanced scoring with volume bonus
            const divergencePts = Math.min(40, spread * 12);
            const volumeBonus = Math.min(15, (props.length - 2) * 5);
            const sharpScore = 50 + divergencePts + volumeBonus;
            
            if (sharpScore < threshold.minScore) continue;
            
            const confidenceGrade = sharpScore >= 80 ? 'A' : sharpScore >= 65 ? 'B' : 'C';
            const firstProp = props[0];
            const startTime = new Date(firstProp.commence_time);
            const expiresAt = new Date(startTime.getTime() - 5 * 60 * 1000);
            
            const whyShort = [`${spread.toFixed(1)} pt book divergence`, `${props.length} books disagree`];
            if (volumeBonus > 0) whyShort.push('High volume');
            
            divergenceSignals.push({
              market_key: `divergence_${firstProp.sport}_${firstProp.player_name}_${firstProp.prop_type}`,
              player_name: firstProp.player_name,
              stat_type: firstProp.prop_type,
              sport: firstProp.sport,
              pp_line: avgLine,
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
              why_short: whyShort,
            });
          }
        }
        
        console.log('[Whale Detector] Generated', divergenceSignals.length, 'player prop divergence signals');
      }
    }

    // ========== TEAM PROPS (Spreads, Totals, Moneylines) ==========
    const teamSignals: Array<{
      market_key: string;
      player_name: string; // Will be team matchup
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
      _game_id: string; // stored for accurate game_bets update
    }> = [];
    
    if (include_team_props) {
      console.log('[Whale Detector] Checking team props for sharp signals...');
      
      const { data: teamBets } = await supabase
        .from('game_bets')
        .select('*')
        .in('sport', sports)
        .gt('commence_time', now.toISOString())
        .eq('is_active', true)
        .order('commence_time', { ascending: true })
        .limit(500);
      
      const bets = (teamBets || []) as GameBet[];
      console.log('[Whale Detector] Found', bets.length, 'team bets to analyze');
      
      if (bets.length > 0) {
        // Group by game + bet_type
        const gameMap = new Map<string, GameBet[]>();
        for (const bet of bets) {
          const key = `${bet.game_id}_${bet.bet_type}`;
          if (!gameMap.has(key)) {
            gameMap.set(key, []);
          }
          gameMap.get(key)!.push(bet);
        }
        
        for (const [key, gameBets] of gameMap) {
          if (gameBets.length < 2) continue;
          
          const sport = gameBets[0].sport;
          const betType = gameBets[0].bet_type;
          const threshold = SPORT_THRESHOLDS[sport] || SPORT_THRESHOLDS['basketball_nba'];
          
          const lines = gameBets.map(b => b.line).filter((l): l is number => l != null && !isNaN(l));
          const homeOdds = gameBets.map(b => b.home_odds || b.over_odds).filter((o): o is number => o != null);
          const awayOdds = gameBets.map(b => b.away_odds || b.under_odds).filter((o): o is number => o != null);
          
          const { sharpScore, recommendedSide, whyShort } = calculateTeamSharpScore(
            lines, homeOdds, awayOdds, betType
          );
          
          if (sharpScore < threshold.minScore) continue;
          
          const firstBet = gameBets[0];
          const avgLine = lines.length > 0 ? snapLine(lines.reduce((a, b) => a + b, 0) / lines.length, betType) : 0;
          const startTime = new Date(firstBet.commence_time);
          const expiresAt = new Date(startTime.getTime() - 5 * 60 * 1000);
          const confidenceGrade = sharpScore >= 80 ? 'A' : sharpScore >= 65 ? 'B' : 'C';
          const matchup = `${firstBet.away_team} @ ${firstBet.home_team}`;
          
          const signalType = betType === 'spread' ? 'sharp_spread' : 
                            betType === 'total' ? 'sharp_total' : 'sharp_moneyline';
          
          teamSignals.push({
            market_key: `team_${firstBet.sport}_${firstBet.game_id}_${betType}`,
            player_name: matchup, // Use matchup as "player" for team bets
            stat_type: betType,
            sport: firstBet.sport,
            pp_line: avgLine,
            book_consensus: avgLine,
            sharp_score: sharpScore,
            confidence_grade: confidenceGrade,
            confidence: confidenceGrade,
            divergence_pts: Math.round(sharpScore - 40),
            move_speed_pts: 0,
            confirmation_pts: 0,
            board_behavior_pts: 0,
            recommended_side: recommendedSide,
            pick_side: recommendedSide,
            matchup,
            start_time: firstBet.commence_time,
            expires_at: expiresAt.toISOString(),
            created_at: now.toISOString(),
            signal_type: signalType,
            why_short: whyShort,
            _game_id: firstBet.game_id, // stored for accurate game_bets update
          });
        }
        
        console.log('[Whale Detector] Generated', teamSignals.length, 'team prop sharp signals');
      }
    }
    
    const allSignals = [...divergenceSignals, ...teamSignals];
    
    // ========== PERPLEXITY CROSS-REFERENCE ==========
    let perplexityMatches = 0;
    if (allSignals.length > 0) {
      const intelMap = await fetchPerplexitySharpIntel(supabase);
      
      if (intelMap.size > 0) {
        for (const signal of allSignals) {
          const match = matchPerplexitySignal(
            signal.player_name,
            signal.stat_type,
            signal.recommended_side,
            intelMap
          );
          
          if (match) {
            signal.sharp_score = Math.min(100, signal.sharp_score + match.boost);
            signal.why_short.push(match.reason);
            
            // Upgrade confidence grade if threshold crossed
            const newGrade = getConfidenceGrade(signal.sharp_score);
            if (newGrade < signal.confidence_grade) { // A < B in char comparison
              signal.confidence_grade = newGrade;
              signal.confidence = newGrade;
            }
            
            perplexityMatches++;
          }
        }
        
        console.log(`[Whale Detector] Perplexity cross-ref: ${perplexityMatches}/${allSignals.length} signals boosted`);
      }
    }
    
    // Insert all signals
    if (allSignals.length > 0) {
      // Delete old signals first
      await supabase
        .from('whale_picks')
        .delete()
        .in('signal_type', ['book_divergence', 'sharp_spread', 'sharp_total', 'sharp_moneyline']);
      
      // Strip internal fields not in whale_picks schema
      const cleanSignals = allSignals.map(({ _game_id, ...rest }: any) => rest);
      const { error: insertError } = await supabase
        .from('whale_picks')
        .insert(cleanSignals);

      if (insertError) {
        console.error('[Whale Detector] Insert error:', insertError);
      } else {
        console.log('[Whale Detector] Inserted', allSignals.length, 'total signals');
      }
    }

    // Cleanup expired picks
    await supabase
      .from('whale_picks')
      .delete()
      .lt('expires_at', now.toISOString());

    // Update game_bets with sharp scores
    if (teamSignals.length > 0) {
      for (const signal of teamSignals) {
        const betType = signal.stat_type;
        
        const { error: updateError } = await supabase
          .from('game_bets')
          .update({ 
            sharp_score: signal.sharp_score,
            recommended_side: signal.recommended_side,
            signal_sources: signal.why_short
          })
          .eq('game_id', signal._game_id)
          .eq('bet_type', betType);
        
        if (updateError) {
          console.error(`[Whale Detector] Failed to update game_bets for ${signal._game_id}/${betType}:`, updateError);
        } else {
          console.log(`[Whale Detector] Updated game_bets: ${signal._game_id}/${betType} → ${signal.recommended_side} (score: ${signal.sharp_score})`);
        }
      }
    }

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'whale-signal-detector',
      status: 'completed',
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        playerPropSignals: divergenceSignals.length,
        teamPropSignals: teamSignals.length,
        totalSignals: allSignals.length,
        perplexityMatches,
        sports: sports,
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        playerPropSignals: divergenceSignals.length,
        teamPropSignals: teamSignals.length,
        totalSignals: allSignals.length,
        perplexityMatches,
        sports: sports,
        sampleSignals: allSignals.slice(0, 5).map(s => ({
          player: s.player_name,
          stat: s.stat_type,
          sport: s.sport,
          sharpScore: s.sharp_score,
          grade: s.confidence_grade,
          side: s.recommended_side,
          type: s.signal_type,
          whyShort: s.why_short,
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

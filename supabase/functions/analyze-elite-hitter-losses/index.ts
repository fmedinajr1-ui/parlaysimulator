import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface LossPattern {
  patternType: string;
  patternKey: string;
  description: string;
  isLoss: boolean;
  margin?: number;
  example?: string;
}

interface MatchupPattern {
  sport: string;
  propType: string;
  side: string;
  defenseTier: string;
  isHit: boolean;
  line: number;
  actualValue: number;
  opponent: string;
  date: string;
}

// Get defense tier from rank
function getDefenseTier(rank: number): string {
  if (rank <= 5) return 'elite';
  if (rank <= 12) return 'good';
  if (rank <= 20) return 'average';
  return 'weak';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { parlayId } = await req.json().catch(() => ({}));
    
    console.log('=== Analyzing Elite Hitter Losses ===');
    
    // Get the parlay to analyze (either specific or all recent losses)
    let parlaysToAnalyze: any[] = [];
    
    if (parlayId) {
      const { data: parlay } = await supabase
        .from('daily_elite_parlays')
        .select('*')
        .eq('id', parlayId)
        .single();
      
      if (parlay) parlaysToAnalyze = [parlay];
    } else {
      // Analyze all recent losses that haven't been analyzed
      const { data: losses } = await supabase
        .from('daily_elite_parlays')
        .select('*')
        .eq('outcome', 'lost')
        .order('parlay_date', { ascending: false })
        .limit(30);
      
      parlaysToAnalyze = losses || [];
    }
    
    console.log(`Found ${parlaysToAnalyze.length} parlays to analyze`);
    
    const patternsFound: LossPattern[] = [];
    const patternStats: Record<string, { losses: number; hits: number; examples: string[] }> = {};
    
    for (const parlay of parlaysToAnalyze) {
      const legs = parlay.legs as any[];
      if (!legs || legs.length === 0) continue;
      
      const isLoss = parlay.outcome === 'lost';
      const actualResult = parlay.actual_result as any;
      const legResults = actualResult?.legs || [];
      
      // Get leg outcomes for detailed analysis
      const { data: legOutcomes } = await supabase
        .from('daily_elite_leg_outcomes')
        .select('*')
        .eq('parlay_id', parlay.id);
      
      // Pattern 1: Engine Concentration Analysis
      const allEngines = legs.flatMap(l => l.engines || []);
      const uniqueEngines = new Set(allEngines);
      
      if (uniqueEngines.size === 1) {
        const singleEngine = [...uniqueEngines][0].toLowerCase();
        const patternKey = `all_${singleEngine}_parlay`;
        
        patternsFound.push({
          patternType: 'engine_concentration',
          patternKey,
          description: `All 3 legs from ${singleEngine} engine only`,
          isLoss,
          example: `${parlay.parlay_date}: ${legs.map(l => l.playerName).join(', ')}`
        });
        
        if (!patternStats[patternKey]) {
          patternStats[patternKey] = { losses: 0, hits: 0, examples: [] };
        }
        if (isLoss) {
          patternStats[patternKey].losses++;
          patternStats[patternKey].examples.push(`${parlay.parlay_date} - Loss`);
        } else {
          patternStats[patternKey].hits++;
        }
      }
      
      // Pattern 2: Prop Type + Side Analysis
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const legOutcome = legOutcomes?.find(lo => lo.leg_index === i);
        
        if (!legOutcome) continue;
        
        const propType = leg.propType?.toLowerCase()?.replace(/[^a-z]/g, '_') || 'unknown';
        const side = leg.side?.toLowerCase() || 'over';
        const patternKey = `${propType}_${side}`;
        
        const isLegLoss = legOutcome.outcome === 'miss';
        
        if (!patternStats[patternKey]) {
          patternStats[patternKey] = { losses: 0, hits: 0, examples: [] };
        }
        
        if (isLegLoss) {
          patternStats[patternKey].losses++;
          patternStats[patternKey].examples.push(
            `${parlay.parlay_date} - ${leg.playerName} ${legOutcome.actual_value} vs ${leg.line}`
          );
          
          // Calculate margin of miss
          const margin = Math.abs((legOutcome.actual_value || 0) - leg.line);
          
          patternsFound.push({
            patternType: 'prop_type_side',
            patternKey,
            description: `${propType} ${side} prop missed`,
            isLoss: true,
            margin,
            example: `${leg.playerName}: ${legOutcome.actual_value} vs ${leg.line} line`
          });
          
          // Pattern 3: Close Miss Analysis (margin < 1)
          if (margin < 1) {
            const closePatternKey = 'close_miss_under_1';
            if (!patternStats[closePatternKey]) {
              patternStats[closePatternKey] = { losses: 0, hits: 0, examples: [] };
            }
            patternStats[closePatternKey].losses++;
            patternStats[closePatternKey].examples.push(
              `${leg.playerName} ${propType}: ${legOutcome.actual_value} vs ${leg.line} (margin: ${margin.toFixed(1)})`
            );
          }
          
          // Pattern 4: Big Miss Analysis (margin > 3)
          if (margin > 3) {
            const bigMissKey = 'big_miss_over_3';
            if (!patternStats[bigMissKey]) {
              patternStats[bigMissKey] = { losses: 0, hits: 0, examples: [] };
            }
            patternStats[bigMissKey].losses++;
            patternStats[bigMissKey].examples.push(
              `${leg.playerName} ${propType}: ${legOutcome.actual_value} vs ${leg.line} (missed by ${margin.toFixed(1)})`
            );
          }
        } else if (legOutcome.outcome === 'hit' || legOutcome.outcome === 'push') {
          patternStats[patternKey].hits++;
        }
        
        // Pattern 5: Matchup Analysis (opponent defense correlation)
        if (legOutcome.opponent_defense_rank && legOutcome.opponent_defense_rank > 0) {
          const defenseTier = getDefenseTier(legOutcome.opponent_defense_rank);
          const matchupKey = `${propType}_${side}_vs_${defenseTier}`;
          
          if (!patternStats[matchupKey]) {
            patternStats[matchupKey] = { losses: 0, hits: 0, examples: [] };
          }
          
          if (isLegLoss) {
            patternStats[matchupKey].losses++;
            patternStats[matchupKey].examples.push(
              `${parlay.parlay_date}: ${leg.playerName} ${propType} ${side} vs ${legOutcome.opponent_name || 'unknown'} (rank ${legOutcome.opponent_defense_rank}) - ${legOutcome.actual_value} vs ${leg.line}`
            );
            
            // Also update matchup patterns table for specialized tracking
            const matchupData: MatchupPattern = {
              sport: legOutcome.sport || 'NBA',
              propType,
              side,
              defenseTier,
              isHit: false,
              line: leg.line,
              actualValue: legOutcome.actual_value || 0,
              opponent: legOutcome.opponent_name || 'unknown',
              date: parlay.parlay_date
            };
            
            await upsertMatchupPattern(supabase, matchupData);
          } else if (legOutcome.outcome === 'hit' || legOutcome.outcome === 'push') {
            patternStats[matchupKey].hits++;
            
            // Track hits too for accuracy calculation
            const matchupData: MatchupPattern = {
              sport: legOutcome.sport || 'NBA',
              propType,
              side,
              defenseTier,
              isHit: true,
              line: leg.line,
              actualValue: legOutcome.actual_value || 0,
              opponent: legOutcome.opponent_name || 'unknown',
              date: parlay.parlay_date
            };
            
            await upsertMatchupPattern(supabase, matchupData);
          }
        }
      }
    }
    
    // Update pattern table with findings
    const updatedPatterns: string[] = [];
    
    for (const [patternKey, stats] of Object.entries(patternStats)) {
      const total = stats.losses + stats.hits;
      if (total < 1) continue;
      
      const accuracyRate = total > 0 ? (stats.hits / total) : 0;
      
      // Determine pattern type from key
      let patternType = 'prop_type_side';
      if (patternKey.startsWith('all_') && patternKey.endsWith('_parlay')) {
        patternType = 'engine_concentration';
      } else if (patternKey.includes('miss')) {
        patternType = 'margin_analysis';
      }
      
      // Calculate penalty based on accuracy
      let penalty = 0;
      let severity = 'penalize';
      
      if (accuracyRate < 0.40 && total >= 3) {
        // Very poor accuracy - block
        severity = 'block';
        penalty = 1.0;
      } else if (accuracyRate < 0.45 && total >= 2) {
        // Poor accuracy - heavy penalty
        penalty = 0.5;
      } else if (accuracyRate < 0.50) {
        // Below average - moderate penalty
        penalty = 0.3;
      } else if (accuracyRate < 0.55) {
        // Slight underperformance - light penalty
        penalty = 0.15;
      }
      
      // Only create/update patterns with meaningful data
      if (stats.losses > 0 || stats.hits > 0) {
        const { error: upsertError } = await supabase
          .from('elite_hitter_loss_patterns')
          .upsert({
            pattern_type: patternType,
            pattern_key: patternKey,
            description: `Pattern: ${patternKey}`,
            loss_count: stats.losses,
            hit_count: stats.hits,
            total_count: total,
            accuracy_rate: accuracyRate,
            severity,
            penalty_amount: penalty,
            example_losses: stats.examples.slice(0, 5),
            is_active: true,
          }, { onConflict: 'pattern_type,pattern_key' });
        
        if (upsertError) {
          console.error(`Error upserting pattern ${patternKey}:`, upsertError);
        } else {
          updatedPatterns.push(`${patternKey}: ${(accuracyRate * 100).toFixed(1)}% (${stats.hits}/${total})`);
        }
      }
    }
    
    console.log('=== Loss Analysis Complete ===');
    console.log(`Patterns updated: ${updatedPatterns.length}`);
    console.log(updatedPatterns.join('\n'));
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        parlaysAnalyzed: parlaysToAnalyze.length,
        patternsFound: patternsFound.length,
        patternsUpdated: updatedPatterns
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in analyze-elite-hitter-losses:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Upsert matchup pattern into specialized tracking table
async function upsertMatchupPattern(supabase: any, pattern: MatchupPattern) {
  try {
    // First get existing record
    const { data: existing } = await supabase
      .from('elite_hitter_matchup_patterns')
      .select('*')
      .eq('sport', pattern.sport)
      .eq('prop_type', pattern.propType)
      .eq('side', pattern.side)
      .eq('defense_tier', pattern.defenseTier)
      .maybeSingle();
    
    const hitCount = (existing?.hit_count || 0) + (pattern.isHit ? 1 : 0);
    const missCount = (existing?.miss_count || 0) + (pattern.isHit ? 0 : 1);
    const totalCount = hitCount + missCount;
    const accuracyRate = totalCount > 0 ? hitCount / totalCount : 0;
    
    // Calculate new averages
    const prevTotal = existing?.total_count || 0;
    const newAvgLine = prevTotal > 0 
      ? ((existing?.avg_line || 0) * prevTotal + pattern.line) / (prevTotal + 1)
      : pattern.line;
    const newAvgActual = prevTotal > 0
      ? ((existing?.avg_actual_value || 0) * prevTotal + pattern.actualValue) / (prevTotal + 1)
      : pattern.actualValue;
    const missMargin = pattern.isHit ? 0 : Math.abs(pattern.actualValue - pattern.line);
    const newAvgMissMargin = !pattern.isHit && missCount > 0
      ? ((existing?.avg_miss_margin || 0) * (missCount - 1) + missMargin) / missCount
      : existing?.avg_miss_margin || 0;
    
    // Calculate penalty based on accuracy
    let penalty = 0;
    let isBoost = false;
    
    if (accuracyRate < 0.40 && totalCount >= 3) {
      penalty = 0.5;
    } else if (accuracyRate < 0.45 && totalCount >= 2) {
      penalty = 0.35;
    } else if (accuracyRate < 0.50) {
      penalty = 0.2;
    } else if (accuracyRate >= 0.65 && totalCount >= 3) {
      isBoost = true;
      penalty = -0.15; // Negative = bonus
    }
    
    // Add new example (keep last 5)
    const newExample = {
      player: pattern.opponent,
      date: pattern.date,
      line: pattern.line,
      actual: pattern.actualValue,
      hit: pattern.isHit
    };
    const examples = [...(existing?.example_matchups || []), newExample].slice(-5);
    
    const { error } = await supabase
      .from('elite_hitter_matchup_patterns')
      .upsert({
        sport: pattern.sport,
        prop_type: pattern.propType,
        side: pattern.side,
        defense_tier: pattern.defenseTier,
        hit_count: hitCount,
        miss_count: missCount,
        total_count: totalCount,
        accuracy_rate: accuracyRate,
        avg_line: newAvgLine,
        avg_actual_value: newAvgActual,
        avg_miss_margin: newAvgMissMargin,
        example_matchups: examples,
        penalty_amount: Math.abs(penalty),
        is_boost: isBoost,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'sport,prop_type,side,defense_tier' });
    
    if (error) {
      console.error('Error upserting matchup pattern:', error);
    } else {
      console.log(`Matchup pattern updated: ${pattern.propType}_${pattern.side} vs ${pattern.defenseTier} - ${(accuracyRate * 100).toFixed(1)}%`);
    }
  } catch (e) {
    console.error('Failed to upsert matchup pattern:', e);
  }
}

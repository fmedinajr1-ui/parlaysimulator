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

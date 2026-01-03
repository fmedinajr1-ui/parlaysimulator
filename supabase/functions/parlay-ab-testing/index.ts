import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chi-square CDF approximation for p-value calculation
function chiSquareCDF(x: number, df: number): number {
  if (x < 0) return 0;
  
  // Simple approximation for df=1
  const z = Math.sqrt(x);
  const p = 0.5 * (1 + erf(z / Math.sqrt(2)));
  return 2 * p - 1;
}

// Error function approximation
function erf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return sign * y;
}

// Calculate statistical significance using chi-square test
function calculateSignificance(
  controlWins: number, 
  controlTotal: number,
  variantWins: number, 
  variantTotal: number
): { pValue: number; significant: boolean; chiSquare: number } {
  if (controlTotal === 0 || variantTotal === 0) {
    return { pValue: 1, significant: false, chiSquare: 0 };
  }
  
  const controlLosses = controlTotal - controlWins;
  const variantLosses = variantTotal - variantWins;
  
  const totalWins = controlWins + variantWins;
  const totalLosses = controlLosses + variantLosses;
  const grandTotal = controlTotal + variantTotal;
  
  if (grandTotal === 0) return { pValue: 1, significant: false, chiSquare: 0 };
  
  // Expected values under null hypothesis
  const expectedControlWins = (controlTotal * totalWins) / grandTotal;
  const expectedControlLosses = (controlTotal * totalLosses) / grandTotal;
  const expectedVariantWins = (variantTotal * totalWins) / grandTotal;
  const expectedVariantLosses = (variantTotal * totalLosses) / grandTotal;
  
  // Avoid division by zero
  if (expectedControlWins === 0 || expectedControlLosses === 0 || 
      expectedVariantWins === 0 || expectedVariantLosses === 0) {
    return { pValue: 1, significant: false, chiSquare: 0 };
  }
  
  // Chi-square calculation
  const chiSquare = 
    Math.pow(controlWins - expectedControlWins, 2) / expectedControlWins +
    Math.pow(controlLosses - expectedControlLosses, 2) / expectedControlLosses +
    Math.pow(variantWins - expectedVariantWins, 2) / expectedVariantWins +
    Math.pow(variantLosses - expectedVariantLosses, 2) / expectedVariantLosses;
  
  // p-value from chi-square distribution (df=1)
  const pValue = 1 - chiSquareCDF(chiSquare, 1);
  
  return { 
    pValue: Number(pValue.toFixed(4)), 
    significant: pValue < 0.05,
    chiSquare: Number(chiSquare.toFixed(4))
  };
}

// Calculate confidence interval for the difference in proportions
function calculateConfidenceInterval(
  controlRate: number, 
  variantRate: number,
  controlN: number, 
  variantN: number
): { lower: number; upper: number } {
  if (controlN === 0 || variantN === 0) {
    return { lower: -100, upper: 100 };
  }
  
  const diff = variantRate - controlRate;
  const se = Math.sqrt(
    (controlRate * (1 - controlRate)) / controlN +
    (variantRate * (1 - variantRate)) / variantN
  );
  
  // 95% CI (z = 1.96)
  return {
    lower: Number(((diff - 1.96 * se) * 100).toFixed(2)),
    upper: Number(((diff + 1.96 * se) * 100).toFixed(2))
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? 'get_experiments';

    // ========== CREATE EXPERIMENT ==========
    if (action === 'create_experiment') {
      console.log('[AB-TESTING] Creating new experiment...');
      
      const { 
        name, 
        description, 
        hypothesis, 
        control_config, 
        variant_config, 
        test_variables,
        min_sample_size = 30,
        end_date
      } = body;
      
      if (!name || !control_config || !variant_config) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing required fields: name, control_config, variant_config'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
      }
      
      const today = new Date().toISOString().split('T')[0];
      
      const { data: experiment, error } = await supabase
        .from('parlay_ab_experiments')
        .insert({
          experiment_name: name,
          description,
          hypothesis,
          control_config,
          variant_config,
          test_variables,
          min_sample_size,
          start_date: today,
          end_date,
          status: 'active'
        })
        .select()
        .single();
      
      if (error) throw error;
      
      console.log(`[AB-TESTING] Created experiment: ${experiment.id}`);
      
      return new Response(JSON.stringify({
        success: true,
        experiment
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== GET ACTIVE EXPERIMENTS ==========
    if (action === 'get_experiments' || action === 'list_experiments') {
      const status = body?.status || 'active';
      
      const { data: experiments, error } = await supabase
        .from('parlay_ab_experiments')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return new Response(JSON.stringify({
        success: true,
        experiments: experiments || []
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== GET EXPERIMENT DASHBOARD ==========
    if (action === 'get_dashboard') {
      const { experiment_id } = body;
      
      if (!experiment_id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing experiment_id'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
      }
      
      // Fetch experiment
      const { data: experiment, error: expError } = await supabase
        .from('parlay_ab_experiments')
        .select('*')
        .eq('id', experiment_id)
        .single();
      
      if (expError) throw expError;
      
      // Fetch all assignments for this experiment
      const { data: assignments, error: assignError } = await supabase
        .from('parlay_experiment_assignments')
        .select('*')
        .eq('experiment_id', experiment_id);
      
      if (assignError) throw assignError;
      
      // Fetch daily metrics
      const { data: dailyMetrics, error: metricsError } = await supabase
        .from('parlay_experiment_daily_metrics')
        .select('*')
        .eq('experiment_id', experiment_id)
        .order('metric_date', { ascending: true });
      
      if (metricsError) throw metricsError;
      
      // Calculate control stats
      const controlAssignments = (assignments || []).filter(a => a.variant === 'control');
      const variantAssignments = (assignments || []).filter(a => a.variant === 'variant');
      
      const controlSettled = controlAssignments.filter(a => a.outcome !== 'pending');
      const variantSettled = variantAssignments.filter(a => a.outcome !== 'pending');
      
      const controlWins = controlSettled.filter(a => a.outcome === 'won').length;
      const variantWins = variantSettled.filter(a => a.outcome === 'won').length;
      
      const controlWinRate = controlSettled.length > 0 
        ? controlWins / controlSettled.length 
        : 0;
      const variantWinRate = variantSettled.length > 0 
        ? variantWins / variantSettled.length 
        : 0;
      
      const avgControlLegs = controlSettled.length > 0
        ? controlSettled.reduce((sum, a) => sum + (a.legs_hit || 0), 0) / controlSettled.length
        : 0;
      const avgVariantLegs = variantSettled.length > 0
        ? variantSettled.reduce((sum, a) => sum + (a.legs_hit || 0), 0) / variantSettled.length
        : 0;
      
      // Statistical analysis
      const significance = calculateSignificance(
        controlWins, 
        controlSettled.length,
        variantWins, 
        variantSettled.length
      );
      
      const confidenceInterval = calculateConfidenceInterval(
        controlWinRate,
        variantWinRate,
        controlSettled.length,
        variantSettled.length
      );
      
      // Determine winner
      let winner: string | null = null;
      let recommendation = '';
      
      const totalSettled = controlSettled.length + variantSettled.length;
      const minSampleReached = controlSettled.length >= experiment.min_sample_size && 
                               variantSettled.length >= experiment.min_sample_size;
      
      if (minSampleReached && significance.significant) {
        if (variantWinRate > controlWinRate) {
          winner = 'variant';
          recommendation = 'Roll out variant configuration to production';
        } else if (controlWinRate > variantWinRate) {
          winner = 'control';
          recommendation = 'Keep current configuration (control)';
        } else {
          winner = 'inconclusive';
          recommendation = 'No significant difference detected';
        }
      } else if (minSampleReached) {
        recommendation = 'Minimum sample size reached but no statistical significance yet';
      } else {
        const remaining = Math.max(
          experiment.min_sample_size - controlSettled.length,
          experiment.min_sample_size - variantSettled.length
        );
        recommendation = `Need ${remaining} more settled parlays per variant for significance test`;
      }
      
      const lift = controlWinRate > 0 
        ? ((variantWinRate - controlWinRate) / controlWinRate) * 100 
        : (variantWinRate > 0 ? 100 : 0);
      
      // Days since start
      const startDate = new Date(experiment.start_date);
      const today = new Date();
      const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      
      return new Response(JSON.stringify({
        success: true,
        experiment,
        control: {
          total: controlAssignments.length,
          settled: controlSettled.length,
          won: controlWins,
          lost: controlSettled.filter(a => a.outcome === 'lost').length,
          win_rate: Number((controlWinRate * 100).toFixed(2)),
          avg_legs_hit: Number(avgControlLegs.toFixed(2)),
          avg_confidence: controlAssignments.length > 0
            ? Number((controlAssignments.reduce((sum, a) => sum + (a.confidence_at_creation || 0), 0) / controlAssignments.length).toFixed(2))
            : 0
        },
        variant: {
          total: variantAssignments.length,
          settled: variantSettled.length,
          won: variantWins,
          lost: variantSettled.filter(a => a.outcome === 'lost').length,
          win_rate: Number((variantWinRate * 100).toFixed(2)),
          avg_legs_hit: Number(avgVariantLegs.toFixed(2)),
          avg_confidence: variantAssignments.length > 0
            ? Number((variantAssignments.reduce((sum, a) => sum + (a.confidence_at_creation || 0), 0) / variantAssignments.length).toFixed(2))
            : 0
        },
        analysis: {
          lift_percentage: Number(lift.toFixed(2)),
          p_value: significance.pValue,
          chi_square: significance.chiSquare,
          significant: significance.significant,
          confidence_interval: confidenceInterval,
          winner,
          recommendation,
          min_sample_reached: minSampleReached,
          days_running: daysSinceStart
        },
        daily_metrics: dailyMetrics || []
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== UPDATE EXPERIMENT RESULTS ==========
    if (action === 'update_results') {
      console.log('[AB-TESTING] Updating experiment results...');
      
      const { experiment_id } = body;
      
      // Fetch all active experiments if no specific ID
      let experiments: any[] = [];
      if (experiment_id) {
        const { data, error } = await supabase
          .from('parlay_ab_experiments')
          .select('*')
          .eq('id', experiment_id)
          .single();
        if (error) throw error;
        experiments = [data];
      } else {
        const { data, error } = await supabase
          .from('parlay_ab_experiments')
          .select('*')
          .eq('status', 'active');
        if (error) throw error;
        experiments = data || [];
      }
      
      const results: any[] = [];
      
      for (const experiment of experiments) {
        // Fetch assignments for this experiment
        const { data: assignments, error: assignError } = await supabase
          .from('parlay_experiment_assignments')
          .select('*')
          .eq('experiment_id', experiment.id);
        
        if (assignError) {
          console.error(`[AB-TESTING] Error fetching assignments for ${experiment.id}:`, assignError);
          continue;
        }
        
        // Calculate stats
        const controlAssigns = (assignments || []).filter(a => a.variant === 'control');
        const variantAssigns = (assignments || []).filter(a => a.variant === 'variant');
        
        const controlSettled = controlAssigns.filter(a => a.outcome !== 'pending');
        const variantSettled = variantAssigns.filter(a => a.outcome !== 'pending');
        
        const controlWins = controlSettled.filter(a => a.outcome === 'won').length;
        const variantWins = variantSettled.filter(a => a.outcome === 'won').length;
        
        const controlLegsAvg = controlSettled.length > 0
          ? controlSettled.reduce((sum, a) => sum + (a.legs_hit || 0), 0) / controlSettled.length
          : null;
        const variantLegsAvg = variantSettled.length > 0
          ? variantSettled.reduce((sum, a) => sum + (a.legs_hit || 0), 0) / variantSettled.length
          : null;
        
        // Statistical significance
        const significance = calculateSignificance(
          controlWins, controlSettled.length,
          variantWins, variantSettled.length
        );
        
        const controlWinRate = controlSettled.length > 0 ? controlWins / controlSettled.length : 0;
        const variantWinRate = variantSettled.length > 0 ? variantWins / variantSettled.length : 0;
        
        const confidenceInterval = calculateConfidenceInterval(
          controlWinRate, variantWinRate,
          controlSettled.length, variantSettled.length
        );
        
        const lift = controlWinRate > 0 
          ? ((variantWinRate - controlWinRate) / controlWinRate) * 100 
          : 0;
        
        // Determine winner
        let winner: string | null = null;
        let conclusion: string | null = null;
        let newStatus = experiment.status;
        
        const minSampleReached = controlSettled.length >= experiment.min_sample_size && 
                                 variantSettled.length >= experiment.min_sample_size;
        
        if (minSampleReached && significance.significant) {
          if (variantWinRate > controlWinRate) {
            winner = 'variant';
            conclusion = `Variant outperformed control by ${lift.toFixed(1)}% (${variantWinRate * 100}% vs ${controlWinRate * 100}%)`;
            newStatus = 'completed';
          } else if (controlWinRate > variantWinRate) {
            winner = 'control';
            conclusion = `Control performed better than variant by ${Math.abs(lift).toFixed(1)}%`;
            newStatus = 'completed';
          }
        }
        
        // Update experiment
        const updateData: any = {
          control_parlays_total: controlAssigns.length,
          control_parlays_won: controlWins,
          control_legs_hit_avg: controlLegsAvg,
          variant_parlays_total: variantAssigns.length,
          variant_parlays_won: variantWins,
          variant_legs_hit_avg: variantLegsAvg,
          statistical_significance: significance.pValue,
          confidence_interval: confidenceInterval,
          lift_percentage: lift
        };
        
        if (winner) {
          updateData.winner = winner;
          updateData.conclusion = conclusion;
          updateData.status = newStatus;
          updateData.completed_at = new Date().toISOString();
        }
        
        const { error: updateError } = await supabase
          .from('parlay_ab_experiments')
          .update(updateData)
          .eq('id', experiment.id);
        
        if (updateError) {
          console.error(`[AB-TESTING] Error updating experiment ${experiment.id}:`, updateError);
        }
        
        // Update daily metrics
        const today = new Date().toISOString().split('T')[0];
        
        for (const variant of ['control', 'variant'] as const) {
          const assigns = variant === 'control' ? controlAssigns : variantAssigns;
          const settled = variant === 'control' ? controlSettled : variantSettled;
          const wins = variant === 'control' ? controlWins : variantWins;
          const winRate = settled.length > 0 ? wins / settled.length : null;
          
          const todayAssigns = assigns.filter(a => 
            a.created_at?.split('T')[0] === today
          );
          const todayWins = todayAssigns.filter(a => a.outcome === 'won').length;
          const todayLosses = todayAssigns.filter(a => a.outcome === 'lost').length;
          
          await supabase
            .from('parlay_experiment_daily_metrics')
            .upsert({
              experiment_id: experiment.id,
              metric_date: today,
              variant,
              parlays_generated: todayAssigns.length,
              parlays_won: todayWins,
              parlays_lost: todayLosses,
              avg_confidence: todayAssigns.length > 0
                ? todayAssigns.reduce((sum, a) => sum + (a.confidence_at_creation || 0), 0) / todayAssigns.length
                : null,
              avg_edge: todayAssigns.length > 0
                ? todayAssigns.reduce((sum, a) => sum + (a.total_edge_at_creation || 0), 0) / todayAssigns.length
                : null,
              avg_legs_hit: settled.length > 0
                ? settled.reduce((sum, a) => sum + (a.legs_hit || 0), 0) / settled.length
                : null,
              cumulative_win_rate: winRate !== null ? winRate * 100 : null
            }, { onConflict: 'experiment_id,metric_date,variant' });
        }
        
        results.push({
          experiment_id: experiment.id,
          experiment_name: experiment.experiment_name,
          control_win_rate: controlWinRate * 100,
          variant_win_rate: variantWinRate * 100,
          significance: significance.significant,
          winner,
          status: newStatus
        });
        
        console.log(`[AB-TESTING] Updated experiment ${experiment.experiment_name}: ` +
          `control=${controlWinRate * 100}%, variant=${variantWinRate * 100}%, ` +
          `p=${significance.pValue}, winner=${winner || 'none'}`);
      }
      
      return new Response(JSON.stringify({
        success: true,
        updated: results.length,
        results
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== PAUSE/RESUME/ARCHIVE EXPERIMENT ==========
    if (action === 'update_status') {
      const { experiment_id, status } = body;
      
      if (!experiment_id || !status) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing experiment_id or status'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
      }
      
      if (!['active', 'paused', 'completed', 'archived'].includes(status)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid status. Must be: active, paused, completed, or archived'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
      }
      
      const updateData: any = { status };
      if (status === 'completed' || status === 'archived') {
        updateData.completed_at = new Date().toISOString();
      }
      
      const { error } = await supabase
        .from('parlay_ab_experiments')
        .update(updateData)
        .eq('id', experiment_id);
      
      if (error) throw error;
      
      return new Response(JSON.stringify({
        success: true,
        message: `Experiment status updated to ${status}`
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== ASSIGN PARLAY TO EXPERIMENT ==========
    if (action === 'assign_parlay') {
      const { experiment_id, parlay_id, variant, parlay_type, confidence, total_edge, duo_stacks_count, config_snapshot } = body;
      
      if (!experiment_id || !parlay_id || !variant) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing required fields'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
      }
      
      const { data, error } = await supabase
        .from('parlay_experiment_assignments')
        .insert({
          experiment_id,
          parlay_id,
          variant,
          parlay_type,
          confidence_at_creation: confidence,
          total_edge_at_creation: total_edge,
          duo_stacks_count,
          config_snapshot
        })
        .select()
        .single();
      
      if (error) throw error;
      
      return new Response(JSON.stringify({
        success: true,
        assignment: data
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== UPDATE ASSIGNMENT OUTCOME ==========
    if (action === 'update_assignment') {
      const { parlay_id, outcome, legs_hit } = body;
      
      if (!parlay_id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing parlay_id'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
      }
      
      const { data, error } = await supabase
        .from('parlay_experiment_assignments')
        .update({
          outcome,
          legs_hit,
          verified_at: new Date().toISOString()
        })
        .eq('parlay_id', parlay_id)
        .select();
      
      if (error) throw error;
      
      return new Response(JSON.stringify({
        success: true,
        updated: data?.length || 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========== EXPERIMENT TEMPLATES ==========
    if (action === 'get_templates') {
      const templates = [
        {
          name: 'Duo Boost Value Test',
          description: 'Test whether increasing duo stack boost improves parlay win rates',
          hypothesis: 'Higher duo boost (25 vs 15) will improve parlay accuracy',
          control_config: { minHitRate: 0.75, maxVol: 0.30, duoBoost: 15, defenseWeight: 5 },
          variant_config: { minHitRate: 0.75, maxVol: 0.30, duoBoost: 25, defenseWeight: 5 },
          test_variables: ['duoBoost']
        },
        {
          name: 'Stricter Hit Rate Gate',
          description: 'Test whether requiring higher historical hit rates improves accuracy',
          hypothesis: 'Stricter hit rate requirement (75% vs 65%) will improve win rate',
          control_config: { minHitRate: 0.65, maxVol: 0.35, duoBoost: 15, defenseWeight: 5 },
          variant_config: { minHitRate: 0.75, maxVol: 0.35, duoBoost: 15, defenseWeight: 5 },
          test_variables: ['minHitRate']
        },
        {
          name: 'Volatility Cap Test',
          description: 'Test whether tighter volatility limits improve consistency',
          hypothesis: 'Lower max volatility (0.25 vs 0.35) leads to more consistent outcomes',
          control_config: { minHitRate: 0.70, maxVol: 0.35, duoBoost: 15, defenseWeight: 5 },
          variant_config: { minHitRate: 0.70, maxVol: 0.25, duoBoost: 15, defenseWeight: 5 },
          test_variables: ['maxVol']
        },
        {
          name: 'Defense Weight Test',
          description: 'Test whether stronger defense filtering improves pick quality',
          hypothesis: 'Higher defense weight (10 vs 5) better filters unfavorable matchups',
          control_config: { minHitRate: 0.70, maxVol: 0.30, duoBoost: 15, defenseWeight: 5 },
          variant_config: { minHitRate: 0.70, maxVol: 0.30, duoBoost: 15, defenseWeight: 10 },
          test_variables: ['defenseWeight']
        },
        {
          name: 'Edge Minimum Test',
          description: 'Test whether requiring larger edges improves ROI',
          hypothesis: 'Higher minimum edge (2.5 vs 1.5) selects higher value picks',
          control_config: { minHitRate: 0.70, maxVol: 0.30, duoBoost: 15, minEdge: 1.5 },
          variant_config: { minHitRate: 0.70, maxVol: 0.30, duoBoost: 15, minEdge: 2.5 },
          test_variables: ['minEdge']
        }
      ];
      
      return new Response(JSON.stringify({
        success: true,
        templates
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Default: return info
    return new Response(JSON.stringify({
      success: true,
      engine: 'PARLAY_AB_TESTING_V1',
      actions: [
        'create_experiment',
        'get_experiments',
        'get_dashboard',
        'update_results',
        'update_status',
        'assign_parlay',
        'update_assignment',
        'get_templates'
      ]
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[AB-TESTING] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

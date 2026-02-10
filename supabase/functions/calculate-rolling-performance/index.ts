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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = getEasternDate();
    const windows = [7, 14, 30];
    const engines = ['hitrate_parlays', 'juiced_props', 'sharp_money'];
    
    console.log(`Calculating rolling performance for ${today}`);

    const snapshots = [];

    for (const windowDays of windows) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - windowDays);
      const cutoffISO = cutoffDate.toISOString();

      // Hitrate parlays stats
      const { data: hitrateData } = await supabase
        .from('hitrate_parlays')
        .select('sport, outcome, total_odds')
        .gte('settled_at', cutoffISO)
        .in('outcome', ['won', 'lost']);

      const hitrateByPort = groupBySport(hitrateData || [], 'hitrate_parlays');
      
      // Juiced props stats
      const { data: juicedData } = await supabase
        .from('juiced_props')
        .select('sport, outcome, juice_amount')
        .gte('verified_at', cutoffISO)
        .in('outcome', ['won', 'lost']);

      const juicedBySport = groupBySport(juicedData || [], 'juiced_props');

      // Sharp money stats
      const { data: sharpData } = await supabase
        .from('line_movements')
        .select('sport, outcome_correct')
        .gte('verified_at', cutoffISO)
        .eq('outcome_verified', true)
        .eq('is_primary_record', true);

      const sharpBySport = groupSharpBySport(sharpData || []);

      // Combine all stats
      const allStats = [...hitrateByPort, ...juicedBySport, ...sharpBySport];

      for (const stat of allStats) {
        const hitRate = stat.total > 0 ? (stat.wins / stat.total) * 100 : 0;
        const roiPercentage = stat.total > 0 
          ? ((stat.wins * 0.91 - (stat.total - stat.wins)) / stat.total) * 100 
          : 0;

        // Calculate Brier score approximation
        const brierScore = stat.total > 0
          ? stat.predictions.reduce((sum: number, p: any) => {
              const predicted = p.avgOdds > 0 ? 100 / (p.avgOdds + 100) : 0.5;
              const actual = p.won ? 1 : 0;
              return sum + Math.pow(predicted - actual, 2);
            }, 0) / stat.predictions.length
          : 0;

        snapshots.push({
          engine_name: stat.engine,
          sport: stat.sport || 'all',
          snapshot_date: today,
          window_days: windowDays,
          total_predictions: stat.total,
          correct_predictions: stat.wins,
          hit_rate: Math.round(hitRate * 100) / 100,
          brier_score: Math.round(brierScore * 10000) / 10000,
          roi_percentage: Math.round(roiPercentage * 100) / 100,
          sample_size: stat.total,
          confidence_level: stat.total >= 50 ? 'high' : stat.total >= 20 ? 'medium' : 'low',
        });
      }
    }

    // Upsert all snapshots
    if (snapshots.length > 0) {
      const { error } = await supabase
        .from('performance_snapshots')
        .upsert(snapshots, { 
          onConflict: 'engine_name,sport,snapshot_date,window_days',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('Error upserting snapshots:', error);
        throw error;
      }
    }

    console.log(`Successfully stored ${snapshots.length} performance snapshots`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        snapshotsCreated: snapshots.length,
        date: today 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in calculate-rolling-performance:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function groupBySport(data: any[], engine: string) {
  const grouped: Record<string, { total: number; wins: number; predictions: any[] }> = {};
  
  for (const item of data) {
    const sport = item.sport || 'all';
    if (!grouped[sport]) {
      grouped[sport] = { total: 0, wins: 0, predictions: [] };
    }
    grouped[sport].total++;
    if (item.outcome === 'won') grouped[sport].wins++;
    grouped[sport].predictions.push({
      won: item.outcome === 'won',
      avgOdds: item.total_odds || item.juice_amount || 100
    });
  }

  return Object.entries(grouped).map(([sport, stats]) => ({
    engine,
    sport,
    ...stats
  }));
}

function groupSharpBySport(data: any[]) {
  const grouped: Record<string, { total: number; wins: number; predictions: any[] }> = {};
  
  for (const item of data) {
    const sport = item.sport || 'all';
    if (!grouped[sport]) {
      grouped[sport] = { total: 0, wins: 0, predictions: [] };
    }
    grouped[sport].total++;
    if (item.outcome_correct) grouped[sport].wins++;
    grouped[sport].predictions.push({
      won: item.outcome_correct,
      avgOdds: 100
    });
  }

  return Object.entries(grouped).map(([sport, stats]) => ({
    engine: 'sharp_money',
    sport,
    ...stats
  }));
}

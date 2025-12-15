import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BacktestResult {
  slatesAnalyzed: number;
  lockOnlyHitRate: number;
  lockStrongHitRate: number;
  lockCount: number;
  strongCount: number;
  blockCount: number;
  slip2HitRate: number;
  slip3HitRate: number;
  slip2Count: number;
  slip3Count: number;
  topFailReasons: { reason: string; count: number }[];
  avgEdge: number;
  avgMinutes: number;
  avgConfidenceScore: number;
  juiceLagWinRate: number;
  shockFlagRate: number;
  shockPassRate: number;
  defenseAdjStats: { bucket: string; hitRate: number; count: number }[];
  minutesBucketStats: { bucket: string; hitRate: number; count: number }[];
  homeAwayStats: { location: string; hitRate: number; count: number }[];
  tunedEdgeMin: number;
  tunedHitRateMin: number;
  tunedMinutesFloor: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { days = 30, autoTune = false } = await req.json().catch(() => ({}));

    console.log(`Running MedianLock backtest for last ${days} days, autoTune: ${autoTune}`);

    // Get start date
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Fetch all verified candidates
    const { data: candidates, error: candidatesError } = await supabase
      .from('median_lock_candidates')
      .select('*')
      .gte('slate_date', startDateStr)
      .not('outcome', 'is', null)
      .neq('outcome', 'pending');

    if (candidatesError) {
      console.error('Error fetching candidates:', candidatesError);
      throw candidatesError;
    }

    console.log(`Found ${candidates?.length || 0} verified candidates`);

    // Fetch verified slips
    const { data: slips, error: slipsError } = await supabase
      .from('median_lock_slips')
      .select('*')
      .gte('slate_date', startDateStr)
      .not('outcome', 'is', null)
      .neq('outcome', 'pending');

    if (slipsError) {
      console.error('Error fetching slips:', slipsError);
      throw slipsError;
    }

    console.log(`Found ${slips?.length || 0} verified slips`);

    if (!candidates || candidates.length === 0) {
      const emptyResult: BacktestResult = {
        slatesAnalyzed: 0,
        lockOnlyHitRate: 0,
        lockStrongHitRate: 0,
        lockCount: 0,
        strongCount: 0,
        blockCount: 0,
        slip2HitRate: 0,
        slip3HitRate: 0,
        slip2Count: 0,
        slip3Count: 0,
        topFailReasons: [],
        avgEdge: 0,
        avgMinutes: 0,
        avgConfidenceScore: 0,
        juiceLagWinRate: 0,
        shockFlagRate: 0,
        shockPassRate: 0,
        defenseAdjStats: [],
        minutesBucketStats: [],
        homeAwayStats: [],
        tunedEdgeMin: 1.5,
        tunedHitRateMin: 0.8,
        tunedMinutesFloor: 28,
      };

      return new Response(JSON.stringify({ 
        success: true, 
        result: emptyResult,
        message: 'No verified candidates found for backtesting'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate metrics
    const slates = new Set(candidates.map(c => c.slate_date));
    const locks = candidates.filter(c => c.classification === 'LOCK');
    const strongs = candidates.filter(c => c.classification === 'STRONG');
    const blocks = candidates.filter(c => c.classification === 'BLOCK');

    const lockHits = locks.filter(c => c.outcome === 'hit').length;
    const strongHits = strongs.filter(c => c.outcome === 'hit').length;
    const allHits = lockHits + strongHits;

    // Slip metrics
    const slip2s = (slips || []).filter(s => s.slip_type === '2-leg');
    const slip3s = (slips || []).filter(s => s.slip_type === '3-leg');
    const slip2Hits = slip2s.filter(s => s.outcome === 'won').length;
    const slip3Hits = slip3s.filter(s => s.outcome === 'won').length;

    // Analyze block reasons
    const reasonCounts: Record<string, number> = {};
    blocks.forEach(c => {
      const reason = c.block_reason || 'Unknown';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });

    const topFailReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    // Edge and minutes stats
    const validCandidates = [...locks, ...strongs];
    const avgEdge = validCandidates.length > 0
      ? validCandidates.reduce((sum, c) => sum + (c.adjusted_edge || 0), 0) / validCandidates.length
      : 0;
    const avgMinutes = validCandidates.length > 0
      ? validCandidates.reduce((sum, c) => sum + (c.median_minutes || 0), 0) / validCandidates.length
      : 0;
    const avgConfidenceScore = validCandidates.length > 0
      ? validCandidates.reduce((sum, c) => sum + (c.confidence_score || 0), 0) / validCandidates.length
      : 0;

    // Juice lag win rate
    const juiceLagCandidates = validCandidates.filter(c => (c.juice_lag_bonus || 0) > 0);
    const juiceLagWins = juiceLagCandidates.filter(c => c.outcome === 'hit').length;
    const juiceLagWinRate = juiceLagCandidates.length > 0
      ? juiceLagWins / juiceLagCandidates.length
      : 0;

    // Shock flag stats
    const shockFlagged = validCandidates.filter(c => c.is_shock_flagged);
    const shockPassed = shockFlagged.filter(c => c.shock_passed_validation);
    const shockFlagRate = validCandidates.length > 0
      ? shockFlagged.length / validCandidates.length
      : 0;
    const shockPassRate = shockFlagged.length > 0
      ? shockPassed.length / shockFlagged.length
      : 0;

    // Defense bucket stats
    const defenseStats: Record<string, { hits: number; total: number }> = {
      'elite (1-10)': { hits: 0, total: 0 },
      'average (11-20)': { hits: 0, total: 0 },
      'weak (21-30)': { hits: 0, total: 0 },
    };
    validCandidates.forEach(c => {
      const rank = c.opponent_defense_rank || 15;
      let bucket: string;
      if (rank <= 10) bucket = 'elite (1-10)';
      else if (rank <= 20) bucket = 'average (11-20)';
      else bucket = 'weak (21-30)';
      
      defenseStats[bucket].total++;
      if (c.outcome === 'hit') defenseStats[bucket].hits++;
    });

    const defenseAdjStats = Object.entries(defenseStats)
      .filter(([_, s]) => s.total > 0)
      .map(([bucket, s]) => ({
        bucket,
        hitRate: s.hits / s.total,
        count: s.total,
      }));

    // Minutes bucket stats
    const minutesStats: Record<string, { hits: number; total: number }> = {
      '28-30': { hits: 0, total: 0 },
      '30-33': { hits: 0, total: 0 },
      '33+': { hits: 0, total: 0 },
    };
    validCandidates.forEach(c => {
      const mins = c.median_minutes || 0;
      let bucket: string;
      if (mins >= 33) bucket = '33+';
      else if (mins >= 30) bucket = '30-33';
      else bucket = '28-30';
      
      minutesStats[bucket].total++;
      if (c.outcome === 'hit') minutesStats[bucket].hits++;
    });

    const minutesBucketStats = Object.entries(minutesStats)
      .filter(([_, s]) => s.total > 0)
      .map(([bucket, s]) => ({
        bucket,
        hitRate: s.hits / s.total,
        count: s.total,
      }));

    // Home/Away stats
    const locationStats: Record<string, { hits: number; total: number }> = {
      'HOME': { hits: 0, total: 0 },
      'AWAY': { hits: 0, total: 0 },
    };
    validCandidates.forEach(c => {
      const loc = c.location || 'HOME';
      locationStats[loc].total++;
      if (c.outcome === 'hit') locationStats[loc].hits++;
    });

    const homeAwayStats = Object.entries(locationStats)
      .filter(([_, s]) => s.total > 0)
      .map(([location, s]) => ({
        location,
        hitRate: s.hits / s.total,
        count: s.total,
      }));

    // Auto-tuning (if enabled)
    let tunedEdgeMin = 1.5;
    let tunedHitRateMin = 0.8;
    let tunedMinutesFloor = 28;

    if (autoTune && validCandidates.length >= 20) {
      // Simple threshold sweep
      let bestSlip2Rate = 0;
      let bestParams = { edge: 1.5, hitRate: 0.8, minutes: 28 };

      for (let edge = 1.0; edge <= 2.5; edge += 0.5) {
        for (let hr = 0.70; hr <= 0.85; hr += 0.05) {
          for (let mins = 26; mins <= 30; mins += 2) {
            // Count how many candidates would pass with these thresholds
            const filtered = validCandidates.filter(c => 
              (c.adjusted_edge || 0) >= edge &&
              (c.hit_rate || 0) >= hr &&
              (c.median_minutes || 0) >= mins
            );
            
            if (filtered.length >= 10) {
              const hits = filtered.filter(c => c.outcome === 'hit').length;
              const rate = hits / filtered.length;
              if (rate > bestSlip2Rate) {
                bestSlip2Rate = rate;
                bestParams = { edge, hitRate: hr, minutes: mins };
              }
            }
          }
        }
      }

      tunedEdgeMin = bestParams.edge;
      tunedHitRateMin = bestParams.hitRate;
      tunedMinutesFloor = bestParams.minutes;
      
      console.log(`Auto-tuned thresholds: edge=${tunedEdgeMin}, hitRate=${tunedHitRateMin}, minutes=${tunedMinutesFloor}`);
    }

    const result: BacktestResult = {
      slatesAnalyzed: slates.size,
      lockOnlyHitRate: locks.length > 0 ? lockHits / locks.length : 0,
      lockStrongHitRate: validCandidates.length > 0 ? allHits / validCandidates.length : 0,
      lockCount: locks.length,
      strongCount: strongs.length,
      blockCount: blocks.length,
      slip2HitRate: slip2s.length > 0 ? slip2Hits / slip2s.length : 0,
      slip3HitRate: slip3s.length > 0 ? slip3Hits / slip3s.length : 0,
      slip2Count: slip2s.length,
      slip3Count: slip3s.length,
      topFailReasons,
      avgEdge,
      avgMinutes,
      avgConfidenceScore,
      juiceLagWinRate,
      shockFlagRate,
      shockPassRate,
      defenseAdjStats,
      minutesBucketStats,
      homeAwayStats,
      tunedEdgeMin,
      tunedHitRateMin,
      tunedMinutesFloor,
    };

    // Store backtest result
    const { error: insertError } = await supabase
      .from('median_lock_backtest_results')
      .insert({
        slates_analyzed: result.slatesAnalyzed,
        lock_only_hit_rate: result.lockOnlyHitRate,
        lock_strong_hit_rate: result.lockStrongHitRate,
        lock_count: result.lockCount,
        strong_count: result.strongCount,
        block_count: result.blockCount,
        slip_2_hit_rate: result.slip2HitRate,
        slip_3_hit_rate: result.slip3HitRate,
        slip_2_count: result.slip2Count,
        slip_3_count: result.slip3Count,
        top_fail_reasons: result.topFailReasons,
        avg_edge: result.avgEdge,
        avg_minutes: result.avgMinutes,
        avg_confidence_score: result.avgConfidenceScore,
        juice_lag_win_rate: result.juiceLagWinRate,
        shock_flag_rate: result.shockFlagRate,
        shock_pass_rate: result.shockPassRate,
        defense_bucket_stats: result.defenseAdjStats,
        minutes_bucket_stats: result.minutesBucketStats,
        home_away_stats: result.homeAwayStats,
        tuned_edge_min: result.tunedEdgeMin,
        tuned_hit_rate_min: result.tunedHitRateMin,
        tuned_minutes_floor: result.tunedMinutesFloor,
        parameters: { days, autoTune },
      });

    if (insertError) {
      console.error('Error storing backtest result:', insertError);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      result,
      message: `Analyzed ${result.slatesAnalyzed} slates with ${result.lockCount} LOCKs and ${result.strongCount} STRONGs`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Backtest error:', error);
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

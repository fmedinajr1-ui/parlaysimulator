import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ============= CONSTANTS =============
const HALF_LIFE_DAYS = 14;
const PRIOR_STRENGTH = 20;
const CATEGORY_PRIORS: Record<string, number> = {
  player_props: 0.52,
  team_totals: 0.50,
  team_spreads: 0.50,
  moneyline: 0.48,
  default: 0.50,
};
const GATE_FLOORS = { minEdge: 0.001, minHitRate: 40, minSharpe: 0.005, minComposite: 50 };
const GATE_CEILINGS = { minEdge: 0.05, minHitRate: 70, minSharpe: 0.15, minComposite: 95 };
const GATE_STEP = 0.05; // 5% adjustment per cycle

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = getEasternDate();
  const modulesRun: Record<string, { success: boolean; duration: number; details: string }> = {};

  try {
    console.log(`[Adaptive] 🧠 Starting Ultimate Adaptive Intelligence Engine for ${today}`);

    // ============= MODULE 1: RECENCY-WEIGHTED LEARNING =============
    const m1Start = Date.now();
    try {
      // Get all leg outcomes from last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const { data: legOutcomes } = await supabase
        .from('daily_elite_leg_outcomes')
        .select('prop_type, side, sport, outcome, verified_at')
        .not('outcome', 'is', null)
        .gte('verified_at', ninetyDaysAgo.toISOString());

      const { data: categoryWeights } = await supabase
        .from('bot_category_weights')
        .select('*');

      if (legOutcomes && legOutcomes.length > 0 && categoryWeights) {
        // Build recency-weighted hit rates per category+side
        const recencyStats: Record<string, { weightedHits: number; weightedTotal: number }> = {};
        const now = Date.now();

        for (const leg of legOutcomes) {
          const verifiedAt = new Date(leg.verified_at).getTime();
          const daysSince = (now - verifiedAt) / (1000 * 60 * 60 * 24);
          const recencyWeight = Math.pow(0.5, daysSince / HALF_LIFE_DAYS);
          
          const key = `${leg.prop_type}__${leg.side}`;
          if (!recencyStats[key]) recencyStats[key] = { weightedHits: 0, weightedTotal: 0 };
          recencyStats[key].weightedTotal += recencyWeight;
          if (leg.outcome === 'hit') recencyStats[key].weightedHits += recencyWeight;
        }

        // Update category weights with recency hit rates
        let updated = 0;
        for (const cw of categoryWeights) {
          const key = `${cw.category}__${cw.side}`;
          const stats = recencyStats[key];
          if (stats && stats.weightedTotal >= 3) {
            const recencyHitRate = (stats.weightedHits / stats.weightedTotal) * 100;
            await supabase.from('bot_category_weights')
              .update({ recency_hit_rate: Math.round(recencyHitRate * 100) / 100 })
              .eq('id', cw.id);
            updated++;
          }
        }
        modulesRun['recency_analyzer'] = { success: true, duration: Date.now() - m1Start, details: `Updated ${updated} categories with recency-weighted rates from ${legOutcomes.length} outcomes` };
      } else {
        modulesRun['recency_analyzer'] = { success: true, duration: Date.now() - m1Start, details: 'No recent outcomes to analyze' };
      }
    } catch (err) {
      modulesRun['recency_analyzer'] = { success: false, duration: Date.now() - m1Start, details: err.message };
    }

    // ============= MODULE 2: REGIME DETECTION =============
    const m2Start = Date.now();
    let currentRegime = 'full_slate';
    let regimeConfidence = 50;
    try {
      const { startUtc, endUtc } = getEasternDateRangeForToday();
      
      // Count games by sport
      const { data: todaysGames } = await supabase
        .from('game_bets')
        .select('sport, commence_time')
        .gte('commence_time', startUtc)
        .lte('commence_time', endUtc);

      const gameCount = todaysGames?.length || 0;
      const sportSet = new Set((todaysGames || []).map(g => g.sport));
      const activeSports = sportSet.size;

      // Check injury count
      const { count: injuryCount } = await supabase
        .from('lineup_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'OUT')
        .gte('created_at', startUtc);

      // Check trailing 3-day favorite/underdog performance
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const { data: recentSettled } = await supabase
        .from('bot_daily_parlays')
        .select('outcome, legs')
        .in('outcome', ['won', 'lost'])
        .gte('settled_at', threeDaysAgo.toISOString())
        .limit(100);

      // Detect playoff games (April-June for NBA/NHL)
      const month = new Date().getMonth() + 1;
      const isPlayoffSeason = month >= 4 && month <= 6;

      // Classify regime
      if (isPlayoffSeason && activeSports >= 2) {
        currentRegime = 'playoff_mode';
        regimeConfidence = 85;
      } else if ((injuryCount || 0) >= 5) {
        currentRegime = 'injury_storm';
        regimeConfidence = 70;
      } else if (gameCount < 6 || activeSports <= 1) {
        currentRegime = 'light_slate';
        regimeConfidence = 80;
      } else if (gameCount >= 8 && activeSports >= 3) {
        currentRegime = 'full_slate';
        regimeConfidence = 90;
      } else {
        currentRegime = 'full_slate';
        regimeConfidence = 60;
      }

      // Trailing win/loss pattern detection
      const wonCount = (recentSettled || []).filter(p => p.outcome === 'won').length;
      const totalSettled = (recentSettled || []).length;
      if (totalSettled >= 10) {
        const winRate = wonCount / totalSettled;
        if (winRate >= 0.65) {
          currentRegime = 'chalk_day';
          regimeConfidence = Math.round(winRate * 100);
        } else if (winRate <= 0.35) {
          currentRegime = 'upset_wave';
          regimeConfidence = Math.round((1 - winRate) * 100);
        }
      }

      // Build regime-specific weight multipliers
      const regimeWeights: Record<string, number> = {};
      switch (currentRegime) {
        case 'playoff_mode':
          regimeWeights['UNDER_TOTAL'] = 1.15;
          regimeWeights['SPREAD'] = 1.10;
          regimeWeights['MONEYLINE'] = 0.90;
          break;
        case 'injury_storm':
          regimeWeights['UNDER_TOTAL'] = 1.20;
          regimeWeights['BIG_REBOUNDER'] = 1.10;
          regimeWeights['BACKUP_BOOST'] = 1.15;
          break;
        case 'light_slate':
          regimeWeights['SPREAD'] = 1.10;
          regimeWeights['TOTAL'] = 1.05;
          break;
        case 'chalk_day':
          regimeWeights['SPREAD'] = 1.15;
          regimeWeights['MONEYLINE'] = 1.10;
          regimeWeights['OVER_TOTAL'] = 0.90;
          break;
        case 'upset_wave':
          regimeWeights['MONEYLINE'] = 0.85;
          regimeWeights['UNDER_TOTAL'] = 1.15;
          regimeWeights['SPREAD'] = 0.95;
          break;
        default:
          break;
      }

      modulesRun['regime_detector'] = { 
        success: true, duration: Date.now() - m2Start, 
        details: `Regime: ${currentRegime} (${regimeConfidence}% confidence). ${gameCount} games, ${activeSports} sports, ${injuryCount || 0} injuries OUT` 
      };

      // Apply regime multipliers to category weights
      const { data: allWeights } = await supabase.from('bot_category_weights').select('id, category, side');
      if (allWeights) {
        for (const w of allWeights) {
          const multiplier = regimeWeights[`${w.side?.toUpperCase()}_${w.category}`] || regimeWeights[w.category] || 1.0;
          if (multiplier !== 1.0) {
            await supabase.from('bot_category_weights')
              .update({ regime_multiplier: multiplier })
              .eq('id', w.id);
          }
        }
      }
    } catch (err) {
      modulesRun['regime_detector'] = { success: false, duration: Date.now() - m2Start, details: err.message };
    }

    // ============= MODULE 3: BAYESIAN CONFIDENCE CALIBRATOR =============
    const m3Start = Date.now();
    try {
      const { data: categoryWeights } = await supabase
        .from('bot_category_weights')
        .select('*');

      if (categoryWeights) {
        let updated = 0;
        for (const cw of categoryWeights) {
          const totalPicks = cw.total_picks || 0;
          const totalHits = cw.total_hits || 0;
          if (totalPicks < 1) continue;

          // Determine prior based on category type
          const isPlayerProp = !['SPREAD', 'TOTAL', 'MONEYLINE', 'OVER_TOTAL', 'UNDER_TOTAL'].includes(cw.category);
          const prior = isPlayerProp ? CATEGORY_PRIORS.player_props : (CATEGORY_PRIORS[cw.category?.toLowerCase()] || CATEGORY_PRIORS.default);

          const bayesianRate = ((prior * PRIOR_STRENGTH) + totalHits) / (PRIOR_STRENGTH + totalPicks);
          const bayesianPct = Math.round(bayesianRate * 10000) / 100; // Convert to percentage

          await supabase.from('bot_category_weights')
            .update({ bayesian_hit_rate: bayesianPct })
            .eq('id', cw.id);
          updated++;
        }
        modulesRun['bayesian_calibrator'] = { success: true, duration: Date.now() - m3Start, details: `Calibrated ${updated} categories with Bayesian-adjusted rates (prior strength: ${PRIOR_STRENGTH})` };
      }
    } catch (err) {
      modulesRun['bayesian_calibrator'] = { success: false, duration: Date.now() - m3Start, details: err.message };
    }

    // ============= MODULE 4: CROSS-CATEGORY CORRELATION MAPPER =============
    const m4Start = Date.now();
    let correlationMatrix: any[] = [];
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Get settled parlay legs grouped by parlay
      const { data: settledParlays } = await supabase
        .from('bot_daily_parlays')
        .select('id, legs, outcome')
        .in('outcome', ['won', 'lost'])
        .gte('settled_at', thirtyDaysAgo.toISOString())
        .limit(500);

      if (settledParlays && settledParlays.length >= 20) {
        // Build co-occurrence matrix
        const pairStats: Record<string, { coWin: number; coLoss: number; aWinBLoss: number; aLossBWin: number; total: number }> = {};

        for (const parlay of settledParlays) {
          const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
          for (let i = 0; i < legs.length; i++) {
            for (let j = i + 1; j < legs.length; j++) {
              const a = legs[i];
              const b = legs[j];
              const catA = `${a.prop_type || a.bet_type || 'unknown'}__${a.side || 'over'}`;
              const catB = `${b.prop_type || b.bet_type || 'unknown'}__${b.side || 'over'}`;
              const pairKey = [catA, catB].sort().join('|');

              if (!pairStats[pairKey]) pairStats[pairKey] = { coWin: 0, coLoss: 0, aWinBLoss: 0, aLossBWin: 0, total: 0 };
              pairStats[pairKey].total++;

              const aHit = a.hit === true;
              const bHit = b.hit === true;
              if (aHit && bHit) pairStats[pairKey].coWin++;
              else if (!aHit && !bHit) pairStats[pairKey].coLoss++;
              else if (aHit && !bHit) pairStats[pairKey].aWinBLoss++;
              else pairStats[pairKey].aLossBWin++;
            }
          }
        }

        // Find strongest correlations (positive and negative)
        const correlations = Object.entries(pairStats)
          .filter(([_, s]) => s.total >= 5)
          .map(([pair, s]) => {
            const [catA, catB] = pair.split('|');
            const coRate = (s.coWin + s.coLoss) / s.total; // How often they move together
            const antiRate = (s.aWinBLoss + s.aLossBWin) / s.total;
            return {
              pair: [catA, catB],
              co_win_rate: Math.round((s.coWin / s.total) * 100),
              anti_rate: Math.round(antiRate * 100),
              correlation: Math.round((coRate - 0.5) * 200), // -100 to +100 scale
              sample_size: s.total,
            };
          })
          .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
          .slice(0, 20);

        correlationMatrix = correlations;
        modulesRun['correlation_mapper'] = { 
          success: true, duration: Date.now() - m4Start, 
          details: `Found ${correlations.length} significant correlations from ${settledParlays.length} parlays. Strongest: ${correlations[0]?.pair?.join(' ↔ ') || 'none'} (${correlations[0]?.correlation || 0})` 
        };
      } else {
        modulesRun['correlation_mapper'] = { success: true, duration: Date.now() - m4Start, details: `Insufficient data (${settledParlays?.length || 0} parlays, need 20+)` };
      }
    } catch (err) {
      modulesRun['correlation_mapper'] = { success: false, duration: Date.now() - m4Start, details: err.message };
    }

    // ============= MODULE 5: DYNAMIC TIER OPTIMIZER =============
    const m5Start = Date.now();
    let tierRecommendations: Record<string, any> = {};
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: settledParlays } = await supabase
        .from('bot_daily_parlays')
        .select('tier, leg_count, outcome, strategy_name, settled_at')
        .in('outcome', ['won', 'lost'])
        .gte('settled_at', thirtyDaysAgo.toISOString());

      if (settledParlays && settledParlays.length >= 10) {
        // Analyze by leg count
        const legCountStats: Record<number, { wins: number; total: number }> = {};
        const tierStats: Record<string, { wins: number; total: number; lastWin: string | null }> = {};

        for (const p of settledParlays) {
          const lc = p.leg_count || 2;
          if (!legCountStats[lc]) legCountStats[lc] = { wins: 0, total: 0 };
          legCountStats[lc].total++;
          if (p.outcome === 'won') legCountStats[lc].wins++;

          const tier = p.tier || 'exploration';
          if (!tierStats[tier]) tierStats[tier] = { wins: 0, total: 0, lastWin: null };
          tierStats[tier].total++;
          if (p.outcome === 'won') {
            tierStats[tier].wins++;
            if (!tierStats[tier].lastWin || p.settled_at > tierStats[tier].lastWin) {
              tierStats[tier].lastWin = p.settled_at;
            }
          }
        }

        // Find optimal leg count
        let bestLegCount = 3;
        let bestWinRate = 0;
        for (const [lc, stats] of Object.entries(legCountStats)) {
          if (stats.total >= 5) {
            const wr = stats.wins / stats.total;
            if (wr > bestWinRate) {
              bestWinRate = wr;
              bestLegCount = parseInt(lc);
            }
          }
        }

        tierRecommendations = {
          optimal_leg_count: bestLegCount,
          optimal_leg_win_rate: Math.round(bestWinRate * 100),
          leg_count_breakdown: Object.fromEntries(
            Object.entries(legCountStats).map(([lc, s]) => [lc, { win_rate: Math.round((s.wins / s.total) * 100), sample: s.total }])
          ),
          tier_breakdown: Object.fromEntries(
            Object.entries(tierStats).map(([t, s]) => [t, { win_rate: Math.round((s.wins / s.total) * 100), sample: s.total, last_win: s.lastWin }])
          ),
        };

        modulesRun['tier_optimizer'] = { 
          success: true, duration: Date.now() - m5Start, 
          details: `Optimal leg count: ${bestLegCount} (${Math.round(bestWinRate * 100)}% win rate). Analyzed ${settledParlays.length} parlays across ${Object.keys(tierStats).length} tiers` 
        };
      } else {
        modulesRun['tier_optimizer'] = { success: true, duration: Date.now() - m5Start, details: 'Insufficient settled data for tier optimization' };
      }
    } catch (err) {
      modulesRun['tier_optimizer'] = { success: false, duration: Date.now() - m5Start, details: err.message };
    }

    // ============= MODULE 6: QUALITY GATE AUTO-TUNER =============
    const m6Start = Date.now();
    let gateOverrides: Record<string, number> = {};
    try {
      // Get current execution tier performance
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      const { data: execParlays } = await supabase
        .from('bot_daily_parlays')
        .select('outcome')
        .eq('tier', 'execution')
        .in('outcome', ['won', 'lost'])
        .gte('settled_at', fourteenDaysAgo.toISOString());

      if (execParlays && execParlays.length >= 5) {
        const execWins = execParlays.filter(p => p.outcome === 'won').length;
        const execWinRate = execWins / execParlays.length;

        // Load previous gate overrides
        const { data: prevState } = await supabase
          .from('bot_adaptation_state')
          .select('gate_overrides')
          .order('adaptation_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const prevGates = (prevState?.gate_overrides as Record<string, number>) || {
          minEdge: 0.008,
          minHitRate: 45,
          minSharpe: 0.01,
          minComposite: 60,
        };

        gateOverrides = { ...prevGates };

        if (execWinRate > 0.60) {
          // Winning — slightly lower gates to increase volume
          gateOverrides.minEdge = Math.max(GATE_FLOORS.minEdge, prevGates.minEdge * (1 - GATE_STEP));
          gateOverrides.minHitRate = Math.max(GATE_FLOORS.minHitRate, prevGates.minHitRate * (1 - GATE_STEP));
          gateOverrides.minComposite = Math.max(GATE_FLOORS.minComposite, prevGates.minComposite * (1 - GATE_STEP));
        } else if (execWinRate < 0.40) {
          // Losing — raise gates to tighten quality
          gateOverrides.minEdge = Math.min(GATE_CEILINGS.minEdge, prevGates.minEdge * (1 + GATE_STEP));
          gateOverrides.minHitRate = Math.min(GATE_CEILINGS.minHitRate, prevGates.minHitRate * (1 + GATE_STEP));
          gateOverrides.minComposite = Math.min(GATE_CEILINGS.minComposite, prevGates.minComposite * (1 + GATE_STEP));
        }
        // If between 40-60%, keep gates as-is (stable zone)

        // Round for readability
        gateOverrides.minEdge = Math.round(gateOverrides.minEdge * 10000) / 10000;
        gateOverrides.minHitRate = Math.round(gateOverrides.minHitRate * 10) / 10;
        gateOverrides.minComposite = Math.round(gateOverrides.minComposite * 10) / 10;

        modulesRun['gate_tuner'] = { 
          success: true, duration: Date.now() - m6Start, 
          details: `Exec win rate: ${Math.round(execWinRate * 100)}% (${execWins}/${execParlays.length}). Gates: edge=${gateOverrides.minEdge}, hitRate=${gateOverrides.minHitRate}, composite=${gateOverrides.minComposite}` 
        };
      } else {
        gateOverrides = { minEdge: 0.008, minHitRate: 45, minSharpe: 0.01, minComposite: 60 };
        modulesRun['gate_tuner'] = { success: true, duration: Date.now() - m6Start, details: `Insufficient exec data (${execParlays?.length || 0} parlays). Using defaults.` };
      }
    } catch (err) {
      modulesRun['gate_tuner'] = { success: false, duration: Date.now() - m6Start, details: err.message };
    }

    // ============= MODULE 7: ADAPTATION WRITER =============
    const m7Start = Date.now();
    try {
      const successCount = Object.values(modulesRun).filter(m => m.success).length;
      const totalModules = Object.keys(modulesRun).length;
      const adaptationScore = Math.round((successCount / Math.max(totalModules, 1)) * 100);

      // Upsert adaptation state
      await supabase.from('bot_adaptation_state').upsert({
        adaptation_date: today,
        current_regime: currentRegime,
        regime_confidence: regimeConfidence,
        regime_weights: {},
        correlation_matrix: correlationMatrix,
        tier_recommendations: tierRecommendations,
        gate_overrides: gateOverrides,
        adaptation_score: adaptationScore,
        modules_run: modulesRun,
      }, { onConflict: 'adaptation_date' });

      // Log to activity
      await supabase.from('bot_activity_log').insert({
        event_type: 'adaptive_intelligence',
        message: `🧠 Adaptive Intelligence complete: ${successCount}/${totalModules} modules succeeded. Regime: ${currentRegime} (${regimeConfidence}%). Score: ${adaptationScore}/100`,
        severity: 'info',
        metadata: {
          regime: currentRegime,
          regime_confidence: regimeConfidence,
          adaptation_score: adaptationScore,
          gate_overrides: gateOverrides,
          tier_recommendations: tierRecommendations,
          correlation_count: correlationMatrix.length,
          modules: modulesRun,
        },
      });

      // Send Telegram summary
      try {
        const telegramMsg = `🧠 *Adaptive Intelligence Report*\\\\n\\\\n` +
          `📊 Regime: *${currentRegime}* (${regimeConfidence}%)\\\\n` +
          `🎯 Adaptation Score: *${adaptationScore}/100*\\\\n` +
          `📈 Modules: ${successCount}/${totalModules} passed\\\\n` +
          `🔗 Correlations: ${correlationMatrix.length} detected\\\\n` +
          `🚪 Gates: edge=${gateOverrides.minEdge}, hitRate=${gateOverrides.minHitRate}\\\\n` +
          `🏆 Best leg count: ${tierRecommendations.optimal_leg_count || 'N/A'} (${tierRecommendations.optimal_leg_win_rate || 0}% WR)\\\\n\\\\n` +
          Object.entries(modulesRun).map(([name, m]) => `${m.success ? '✅' : '❌'} ${name}: ${m.details.slice(0, 80)}`).join('\\\\n');

        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
          body: JSON.stringify({ type: 'custom', data: { message: telegramMsg } }),
        });
      } catch (_) { /* telegram is best-effort */ }

      modulesRun['adaptation_writer'] = { success: true, duration: Date.now() - m7Start, details: `Written to bot_adaptation_state. Score: ${adaptationScore}/100` };
    } catch (err) {
      modulesRun['adaptation_writer'] = { success: false, duration: Date.now() - m7Start, details: err.message };
    }

    const totalDuration = Object.values(modulesRun).reduce((s, m) => s + m.duration, 0);
    const response = {
      success: true,
      date: today,
      regime: currentRegime,
      regime_confidence: regimeConfidence,
      adaptation_score: Object.values(modulesRun).filter(m => m.success).length / Object.keys(modulesRun).length * 100,
      total_duration_ms: totalDuration,
      modules: modulesRun,
    };

    console.log(`[Adaptive] ✅ Complete in ${totalDuration}ms:`, JSON.stringify(response).slice(0, 500));
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Adaptive] Fatal error:', errorMessage);
    return new Response(JSON.stringify({ success: false, error: errorMessage, modules: modulesRun }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helper: get Eastern date range as UTC timestamps
function getEasternDateRangeForToday(): { startUtc: string; endUtc: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayET = formatter.format(now);
  
  // Determine if we're in EDT or EST
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = now.getTimezoneOffset() < stdOffset;
  const etOffsetHours = isDST ? 4 : 5;

  const startUtc = `${todayET}T${String(etOffsetHours).padStart(2, '0')}:00:00.000Z`;
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + 1);
  const tomorrowET = formatter.format(nextDay);
  const endUtc = `${tomorrowET}T${String(etOffsetHours).padStart(2, '0')}:00:00.000Z`;

  return { startUtc, endUtc };
}

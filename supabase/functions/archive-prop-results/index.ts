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

interface ArchiveResult {
  risk_engine_archived: number;
  sharp_parlays_archived: number;
  heat_parlays_archived: number;
  prop_v2_archived: number;
  unified_props_archived: number;
  monthly_snapshots_updated: number;
  errors: string[];
}

function getMonthStart(date: string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  console.log('[Archive] Starting prop results archival...');

  const results: ArchiveResult = {
    risk_engine_archived: 0,
    sharp_parlays_archived: 0,
    heat_parlays_archived: 0,
    prop_v2_archived: 0,
    unified_props_archived: 0,
    monthly_snapshots_updated: 0,
    errors: [],
  };

  const today = getEasternDate();

  try {
    // 1. Archive nba_risk_engine_picks (settled picks from past games)
    console.log('[Archive] Step 1: Archiving nba_risk_engine_picks...');
    const { data: riskPicks, error: riskError } = await supabase
      .from('nba_risk_engine_picks')
      .select('*')
      .lt('game_date', today);

    if (riskError) {
      console.error('[Archive] Error fetching risk picks:', riskError);
      results.errors.push(`risk_engine fetch: ${riskError.message}`);
    } else if (riskPicks && riskPicks.length > 0) {
      // Check which ones are already archived
      const sourceIds = riskPicks.map(p => p.id);
      const { data: existing } = await supabase
        .from('prop_results_archive')
        .select('source_id')
        .eq('engine', 'risk')
        .in('source_id', sourceIds);
      
      const existingIds = new Set((existing || []).map(e => e.source_id));
      const newPicks = riskPicks.filter(p => !existingIds.has(p.id));

      if (newPicks.length > 0) {
        const archiveRecords = newPicks.map(pick => ({
          engine: 'risk',
          source_id: pick.id,
          game_date: pick.game_date,
          game_month: getMonthStart(pick.game_date),
          created_at: pick.created_at,
          settled_at: pick.settled_at,
          player_name: pick.player_name,
          prop_type: pick.prop_type,
          line: pick.line,
          side: pick.side,
          team_name: pick.team_name,
          opponent: pick.opponent,
          sport: 'NBA',
          outcome: pick.outcome,
          actual_value: pick.actual_value,
          confidence_score: pick.confidence_score,
          edge: pick.edge,
          signal_label: pick.signal_label,
          reason: pick.reason,
          is_parlay: false,
        }));

        const { error: insertError } = await supabase
          .from('prop_results_archive')
          .insert(archiveRecords);

        if (insertError) {
          console.error('[Archive] Error archiving risk picks:', insertError);
          results.errors.push(`risk_engine insert: ${insertError.message}`);
        } else {
          results.risk_engine_archived = newPicks.length;
          console.log(`[Archive] Archived ${newPicks.length} risk engine picks`);
        }
      }
    }

    // 2. Archive sharp_ai_parlays (settled parlays)
    console.log('[Archive] Step 2: Archiving sharp_ai_parlays...');
    const { data: sharpParlays, error: sharpError } = await supabase
      .from('sharp_ai_parlays')
      .select('*')
      .lt('parlay_date', today);

    if (sharpError) {
      console.error('[Archive] Error fetching sharp parlays:', sharpError);
      results.errors.push(`sharp_parlays fetch: ${sharpError.message}`);
    } else if (sharpParlays && sharpParlays.length > 0) {
      const sourceIds = sharpParlays.map(p => p.id);
      const { data: existing } = await supabase
        .from('prop_results_archive')
        .select('source_id')
        .eq('engine', 'sharp')
        .in('source_id', sourceIds);
      
      const existingIds = new Set((existing || []).map(e => e.source_id));
      const newParlays = sharpParlays.filter(p => !existingIds.has(p.id));

      if (newParlays.length > 0) {
        const archiveRecords: any[] = [];
        
        for (const parlay of newParlays) {
          // Archive each leg as individual record
          const legs = parlay.legs || [];
          if (Array.isArray(legs) && legs.length > 0) {
            for (const leg of legs) {
              archiveRecords.push({
                engine: 'sharp',
                source_id: parlay.id,
                game_date: parlay.parlay_date,
                game_month: getMonthStart(parlay.parlay_date),
                created_at: parlay.created_at,
                settled_at: parlay.settled_at,
                player_name: leg.player_name || leg.player || 'Unknown',
                prop_type: leg.prop_type || leg.market || 'unknown',
                line: leg.line || 0,
                side: leg.side || 'over',
                team_name: leg.team_name || null,
                opponent: leg.opponent || null,
                sport: 'NBA',
                outcome: leg.outcome || parlay.outcome,
                actual_value: leg.actual_value || null,
                confidence_score: parlay.confidence_score,
                edge: parlay.edge,
                signal_label: leg.signal_label || parlay.parlay_type,
                reason: leg.reason || parlay.summary,
                is_parlay: true,
                parlay_type: parlay.parlay_type,
                parlay_legs: legs,
              });
            }
          } else {
            // Parlay without structured legs - archive as single record
            archiveRecords.push({
              engine: 'sharp',
              source_id: parlay.id,
              game_date: parlay.parlay_date,
              game_month: getMonthStart(parlay.parlay_date),
              created_at: parlay.created_at,
              settled_at: parlay.settled_at,
              player_name: 'Parlay',
              prop_type: 'parlay',
              line: 0,
              side: 'parlay',
              sport: 'NBA',
              outcome: parlay.outcome,
              confidence_score: parlay.confidence_score,
              edge: parlay.edge,
              signal_label: parlay.parlay_type,
              reason: parlay.summary,
              is_parlay: true,
              parlay_type: parlay.parlay_type,
              parlay_legs: legs,
            });
          }
        }

        if (archiveRecords.length > 0) {
          const { error: insertError } = await supabase
            .from('prop_results_archive')
            .insert(archiveRecords);

          if (insertError) {
            console.error('[Archive] Error archiving sharp parlays:', insertError);
            results.errors.push(`sharp_parlays insert: ${insertError.message}`);
          } else {
            results.sharp_parlays_archived = newParlays.length;
            console.log(`[Archive] Archived ${newParlays.length} sharp parlays (${archiveRecords.length} legs)`);
          }
        }
      }
    }

    // 3. Archive heat_parlays (settled parlays)
    console.log('[Archive] Step 3: Archiving heat_parlays...');
    const { data: heatParlays, error: heatError } = await supabase
      .from('heat_parlays')
      .select('*')
      .lt('parlay_date', today);

    if (heatError) {
      console.error('[Archive] Error fetching heat parlays:', heatError);
      results.errors.push(`heat_parlays fetch: ${heatError.message}`);
    } else if (heatParlays && heatParlays.length > 0) {
      const sourceIds = heatParlays.map(p => p.id);
      const { data: existing } = await supabase
        .from('prop_results_archive')
        .select('source_id')
        .eq('engine', 'heat')
        .in('source_id', sourceIds);
      
      const existingIds = new Set((existing || []).map(e => e.source_id));
      const newParlays = heatParlays.filter(p => !existingIds.has(p.id));

      if (newParlays.length > 0) {
        const archiveRecords: any[] = [];
        
        for (const parlay of newParlays) {
          // Heat parlays have leg_1 and leg_2 structure
          const legs = [parlay.leg_1, parlay.leg_2].filter(Boolean);
          
          for (const leg of legs) {
            if (leg) {
              archiveRecords.push({
                engine: 'heat',
                source_id: parlay.id,
                game_date: parlay.parlay_date,
                game_month: getMonthStart(parlay.parlay_date),
                created_at: parlay.created_at,
                settled_at: parlay.settled_at,
                player_name: leg.player_name || leg.player || 'Unknown',
                prop_type: leg.prop_type || leg.market || 'unknown',
                line: leg.line || 0,
                side: leg.side || 'over',
                team_name: leg.team_name || null,
                opponent: leg.opponent || null,
                sport: 'NBA',
                outcome: leg.outcome || parlay.outcome,
                actual_value: leg.actual_value || null,
                confidence_score: leg.final_score || null,
                edge: null,
                signal_label: leg.signal || parlay.parlay_type,
                reason: leg.reason || parlay.summary,
                is_parlay: true,
                parlay_type: parlay.parlay_type,
                parlay_legs: legs,
              });
            }
          }
        }

        if (archiveRecords.length > 0) {
          const { error: insertError } = await supabase
            .from('prop_results_archive')
            .insert(archiveRecords);

          if (insertError) {
            console.error('[Archive] Error archiving heat parlays:', insertError);
            results.errors.push(`heat_parlays insert: ${insertError.message}`);
          } else {
            results.heat_parlays_archived = newParlays.length;
            console.log(`[Archive] Archived ${newParlays.length} heat parlays (${archiveRecords.length} legs)`);
          }
        }
      }
    }

    // 4. Archive prop_engine_v2_picks
    console.log('[Archive] Step 4: Archiving prop_engine_v2_picks...');
    const { data: v2Picks, error: v2Error } = await supabase
      .from('prop_engine_v2_picks')
      .select('*')
      .lt('game_date', today);

    if (v2Error) {
      console.error('[Archive] Error fetching v2 picks:', v2Error);
      results.errors.push(`prop_v2 fetch: ${v2Error.message}`);
    } else if (v2Picks && v2Picks.length > 0) {
      const sourceIds = v2Picks.map(p => p.id);
      const { data: existing } = await supabase
        .from('prop_results_archive')
        .select('source_id')
        .eq('engine', 'prop_v2')
        .in('source_id', sourceIds);
      
      const existingIds = new Set((existing || []).map(e => e.source_id));
      const newPicks = v2Picks.filter(p => !existingIds.has(p.id));

      if (newPicks.length > 0) {
        const archiveRecords = newPicks.map(pick => ({
          engine: 'prop_v2',
          source_id: pick.id,
          game_date: pick.game_date,
          game_month: getMonthStart(pick.game_date),
          created_at: pick.created_at,
          settled_at: pick.settled_at,
          player_name: pick.player_name,
          prop_type: pick.prop_type,
          line: pick.line,
          side: pick.side,
          team_name: pick.team_name,
          opponent: pick.opponent,
          sport: 'NBA',
          outcome: pick.outcome,
          actual_value: pick.actual_value,
          confidence_score: pick.ses_score,
          edge: pick.edge,
          signal_label: pick.decision,
          reason: pick.key_reason,
          is_parlay: false,
        }));

        const { error: insertError } = await supabase
          .from('prop_results_archive')
          .insert(archiveRecords);

        if (insertError) {
          console.error('[Archive] Error archiving v2 picks:', insertError);
          results.errors.push(`prop_v2 insert: ${insertError.message}`);
        } else {
          results.prop_v2_archived = newPicks.length;
          console.log(`[Archive] Archived ${newPicks.length} prop v2 picks`);
        }
      }
    }

    // 5. Archive unified_props (individual props from all sources)
    console.log('[Archive] Step 5: Archiving unified_props...');
    const now = new Date().toISOString();
    const { data: unifiedProps, error: unifiedError } = await supabase
      .from('unified_props')
      .select('*')
      .lt('commence_time', now)
      .not('outcome', 'is', null);

    if (unifiedError) {
      console.error('[Archive] Error fetching unified props:', unifiedError);
      results.errors.push(`unified_props fetch: ${unifiedError.message}`);
    } else if (unifiedProps && unifiedProps.length > 0) {
      const sourceIds = unifiedProps.map(p => p.id);
      const { data: existing } = await supabase
        .from('prop_results_archive')
        .select('source_id')
        .eq('engine', 'unified')
        .in('source_id', sourceIds);
      
      const existingIds = new Set((existing || []).map(e => e.source_id));
      const newProps = unifiedProps.filter(p => !existingIds.has(p.id));

      if (newProps.length > 0) {
        const archiveRecords = newProps.map(prop => {
          const gameDate = prop.commence_time ? prop.commence_time.split('T')[0] : today;
          return {
            engine: 'unified',
            source_id: prop.id,
            game_date: gameDate,
            game_month: getMonthStart(gameDate),
            created_at: prop.created_at,
            settled_at: prop.updated_at,
            player_name: prop.player_name || 'Unknown',
            prop_type: prop.prop_type || 'unknown',
            line: prop.current_line || 0,
            side: prop.recommended_side || 'over',
            team_name: prop.team_name || null,
            opponent: prop.opponent || null,
            sport: prop.sport || 'NBA',
            outcome: prop.outcome,
            actual_value: prop.actual_stat || null,
            confidence_score: prop.pvs_final_score || null,
            edge: prop.edge_pct || null,
            signal_label: prop.pvs_tier || prop.recommendation || null,
            reason: prop.category || null,
            is_parlay: false,
          };
        });

        const { error: insertError } = await supabase
          .from('prop_results_archive')
          .insert(archiveRecords);

        if (insertError) {
          console.error('[Archive] Error archiving unified props:', insertError);
          results.errors.push(`unified_props insert: ${insertError.message}`);
        } else {
          results.unified_props_archived = newProps.length;
          console.log(`[Archive] Archived ${newProps.length} unified props`);
        }
      }
    }

    // 6. Update monthly accuracy snapshots
    console.log('[Archive] Step 6: Updating monthly accuracy snapshots...');
    const { data: archiveData, error: archiveError } = await supabase
      .from('prop_results_archive')
      .select('game_month, engine, sport, outcome, prop_type, signal_label')
      .not('outcome', 'is', null);

    if (archiveError) {
      console.error('[Archive] Error fetching archive for snapshots:', archiveError);
      results.errors.push(`snapshot fetch: ${archiveError.message}`);
    } else if (archiveData && archiveData.length > 0) {
      // Group by month/engine/sport
      const groups: Record<string, {
        hits: number;
        misses: number;
        pushes: number;
        propTypes: Record<string, { hits: number; misses: number; pushes: number }>;
        signals: Record<string, { hits: number; misses: number; pushes: number }>;
      }> = {};

      for (const record of archiveData) {
        const key = `${record.game_month}_${record.engine}_${record.sport || 'NBA'}`;
        if (!groups[key]) {
          groups[key] = { hits: 0, misses: 0, pushes: 0, propTypes: {}, signals: {} };
        }

        const outcome = record.outcome?.toLowerCase();
        if (outcome === 'hit' || outcome === 'win') groups[key].hits++;
        else if (outcome === 'miss' || outcome === 'loss') groups[key].misses++;
        else if (outcome === 'push') groups[key].pushes++;

        // Track by prop type
        const propType = record.prop_type || 'unknown';
        if (!groups[key].propTypes[propType]) {
          groups[key].propTypes[propType] = { hits: 0, misses: 0, pushes: 0 };
        }
        if (outcome === 'hit' || outcome === 'win') groups[key].propTypes[propType].hits++;
        else if (outcome === 'miss' || outcome === 'loss') groups[key].propTypes[propType].misses++;
        else if (outcome === 'push') groups[key].propTypes[propType].pushes++;

        // Track by signal
        const signal = record.signal_label || 'unknown';
        if (!groups[key].signals[signal]) {
          groups[key].signals[signal] = { hits: 0, misses: 0, pushes: 0 };
        }
        if (outcome === 'hit' || outcome === 'win') groups[key].signals[signal].hits++;
        else if (outcome === 'miss' || outcome === 'loss') groups[key].signals[signal].misses++;
        else if (outcome === 'push') groups[key].signals[signal].pushes++;
      }

      // Upsert snapshots
      let snapshotsUpdated = 0;
      for (const [key, stats] of Object.entries(groups)) {
        const [monthYear, engine, sport] = key.split('_');
        const total = stats.hits + stats.misses + stats.pushes;
        const hitRate = total > 0 ? (stats.hits / total) * 100 : 0;

        const { error: upsertError } = await supabase
          .from('monthly_accuracy_snapshot')
          .upsert({
            month_year: monthYear,
            engine,
            sport,
            total_picks: total,
            total_hits: stats.hits,
            total_misses: stats.misses,
            total_pushes: stats.pushes,
            hit_rate: hitRate,
            prop_type_breakdown: stats.propTypes,
            signal_breakdown: stats.signals,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'month_year,engine,sport' });

        if (upsertError) {
          console.error('[Archive] Error upserting snapshot:', upsertError);
          results.errors.push(`snapshot upsert: ${upsertError.message}`);
        } else {
          snapshotsUpdated++;
        }
      }
      results.monthly_snapshots_updated = snapshotsUpdated;
      console.log(`[Archive] Updated ${snapshotsUpdated} monthly snapshots`);
    }

    // 7. Recalculate player reliability scores (PRRS)
    console.log('[Archive] Step 7: Recalculating player reliability scores...');
    const { data: reliabilityResult, error: reliabilityError } = await supabase
      .rpc('calculate_player_reliability');
    
    if (reliabilityError) {
      console.error('[Archive] Error calculating player reliability:', reliabilityError);
      results.errors.push(`reliability calculation: ${reliabilityError.message}`);
    } else {
      console.log('[Archive] Player reliability scores updated:', reliabilityResult);
    }

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Archive] Unexpected error:', err);
    results.errors.push(`unexpected: ${errorMessage}`);
  }

  const durationMs = Date.now() - startTime;
  const status = results.errors.length === 0 ? 'completed' : 'completed_with_errors';

  // Log to cron_job_history
  const { error: logError } = await supabase
    .from('cron_job_history')
    .insert({
      job_name: 'archive-prop-results',
      status,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      result: results,
      error_message: results.errors.length > 0 ? results.errors.join('; ') : null,
    });

  if (logError) {
    console.error('[Archive] Error logging to cron_job_history:', logError);
  }

  console.log('[Archive] Completed in', durationMs, 'ms');
  console.log('[Archive] Results:', JSON.stringify(results, null, 2));

  return new Response(
    JSON.stringify({
      success: results.errors.length === 0,
      message: `Archive completed in ${durationMs}ms`,
      results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

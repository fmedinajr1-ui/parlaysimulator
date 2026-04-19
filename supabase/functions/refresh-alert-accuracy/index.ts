// supabase/functions/refresh-alert-accuracy/index.ts
//
// Aggregates settled signals from `signal_accuracy` and `engine_live_tracker`
// into the fast-lookup `alert_type_accuracy_cache` table.
// Runs every 30 min via pg_cron.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AggregatedRow {
  alert_type: string;
  l7_hit_rate: number;
  l30_hit_rate: number;
  sample_size_l7: number;
  sample_size_l30: number;
  trend: 'hot' | 'neutral' | 'cold' | 'ice_cold';
  stake_multiplier: number;
  recommendation: 'size_up' | 'standard' | 'light' | 'skip';
}

function classifyTrend(l7: number, l30: number, sample7: number): AggregatedRow['trend'] {
  if (sample7 < 3) return 'neutral';
  const delta = l7 - l30;
  if (l7 < 0.40) return 'ice_cold';
  if (l7 < 0.50) return 'cold';
  if (l7 >= 0.65 && delta >= 0.05) return 'hot';
  return 'neutral';
}

function classifyRecommendation(l7: number, sample7: number): AggregatedRow['recommendation'] {
  if (sample7 < 3) return 'standard';
  if (l7 < 0.42) return 'skip';
  if (l7 < 0.52) return 'light';
  if (l7 >= 0.65) return 'size_up';
  return 'standard';
}

function computeMultiplier(rec: AggregatedRow['recommendation'], trend: AggregatedRow['trend']): number {
  let m = 1.0;
  if (rec === 'size_up') m *= 1.5;
  else if (rec === 'light') m *= 0.5;
  else if (rec === 'skip') m = 0;
  if (trend === 'hot') m *= 1.1;
  else if (trend === 'cold') m *= 0.8;
  else if (trend === 'ice_cold') m *= 0.5;
  return Math.round(m * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date();
    const cutoff7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();

    // ── Source 1: signal_accuracy table ──
    const { data: sigAcc } = await sb
      .from('signal_accuracy')
      .select('signal_type, sport, hit_rate, sample_size, last_updated')
      .gte('last_updated', cutoff30);

    // ── Source 2: engine_live_tracker (settled outcomes for granular grouping) ──
    const { data: tracker } = await sb
      .from('engine_live_tracker')
      .select('signal_type, outcome, settled_at, sport')
      .gte('settled_at', cutoff30)
      .in('outcome', ['hit', 'miss', 'won', 'lost']);

    // Aggregate by signal_type
    const buckets = new Map<string, { hits7: number; total7: number; hits30: number; total30: number }>();

    for (const row of tracker || []) {
      const key = String(row.signal_type || 'unknown').toLowerCase();
      const isHit = row.outcome === 'hit' || row.outcome === 'won';
      const settledAt = new Date(row.settled_at).getTime();
      const within7 = settledAt >= new Date(cutoff7).getTime();

      const b = buckets.get(key) || { hits7: 0, total7: 0, hits30: 0, total30: 0 };
      b.total30 += 1;
      if (isHit) b.hits30 += 1;
      if (within7) {
        b.total7 += 1;
        if (isHit) b.hits7 += 1;
      }
      buckets.set(key, b);
    }

    // Merge in signal_accuracy table data (use as fallback when tracker is sparse)
    for (const row of sigAcc || []) {
      const key = String(row.signal_type || 'unknown').toLowerCase();
      const existing = buckets.get(key);
      if (!existing || existing.total30 < (row.sample_size || 0)) {
        const ss = row.sample_size || 0;
        const hits = Math.round((row.hit_rate || 0) * ss);
        buckets.set(key, {
          hits7: existing?.hits7 ?? Math.round(hits * 0.4),
          total7: existing?.total7 ?? Math.round(ss * 0.4),
          hits30: hits,
          total30: ss,
        });
      }
    }

    // Build upsert rows
    const rows: AggregatedRow[] = [];
    for (const [alertType, b] of buckets.entries()) {
      const l7 = b.total7 > 0 ? b.hits7 / b.total7 : (b.total30 > 0 ? b.hits30 / b.total30 : 0.5);
      const l30 = b.total30 > 0 ? b.hits30 / b.total30 : 0.5;
      const trend = classifyTrend(l7, l30, b.total7);
      const rec = classifyRecommendation(l7, b.total7);
      const mult = computeMultiplier(rec, trend);

      rows.push({
        alert_type: alertType,
        l7_hit_rate: Math.round(l7 * 1000) / 1000,
        l30_hit_rate: Math.round(l30 * 1000) / 1000,
        sample_size_l7: b.total7,
        sample_size_l30: b.total30,
        trend,
        stake_multiplier: mult,
        recommendation: rec,
      });
    }

    // Upsert in batches
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50).map(r => ({ ...r, last_updated: now.toISOString() }));
      const { error } = await sb
        .from('alert_type_accuracy_cache')
        .upsert(batch, { onConflict: 'alert_type' });
      if (error) {
        console.error('[refresh-alert-accuracy] upsert error:', error);
      } else {
        upserted += batch.length;
      }
    }

    console.log(`[refresh-alert-accuracy] refreshed ${upserted} alert types`);

    return new Response(JSON.stringify({
      success: true,
      alert_types_refreshed: upserted,
      sample: rows.slice(0, 5),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[refresh-alert-accuracy] error:', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

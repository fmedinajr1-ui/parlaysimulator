// Phase 4 — Learning Loop: Metrics Processor
// Recomputes hook performance from posted videos and promotes/demotes hooks.
// Triggered manually from Hook Lab UI or via cron.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PROMOTE_THRESHOLD = 0.55;
const DEMOTE_THRESHOLD = 0.30;
const MIN_USES_FOR_DEMOTE = 5;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // 1. Pull all posts with a hook_id and at least one metric snapshot
    const { data: posts, error: postsErr } = await sb
      .from('tiktok_posts')
      .select('id, hook_id, posted_manually_at, posted_at, latest_views, latest_completion_rate, viral_score')
      .not('hook_id', 'is', null);
    if (postsErr) throw postsErr;

    // 2. Recompute viral_score = views per hour since posting
    const updatedPosts: Array<{ id: string; viral_score: number }> = [];
    for (const p of posts || []) {
      const postedAt = p.posted_manually_at || p.posted_at;
      if (!postedAt || !p.latest_views) continue;
      const hoursSince = Math.max(1, (Date.now() - new Date(postedAt).getTime()) / 3_600_000);
      const viral = Math.round((Number(p.latest_views) / hoursSince) * 100) / 100;
      if (Math.abs(viral - Number(p.viral_score || 0)) > 0.01) {
        await sb.from('tiktok_posts').update({ viral_score: viral }).eq('id', p.id);
        updatedPosts.push({ id: p.id, viral_score: viral });
      }
    }

    // 3. Aggregate per hook_id
    const hookAgg = new Map<string, { uses: number; sumCompl: number; complCount: number; sumViews: number }>();
    for (const p of posts || []) {
      if (!p.hook_id) continue;
      const a = hookAgg.get(p.hook_id) || { uses: 0, sumCompl: 0, complCount: 0, sumViews: 0 };
      a.uses += 1;
      if (p.latest_completion_rate != null) {
        a.sumCompl += Number(p.latest_completion_rate);
        a.complCount += 1;
      }
      a.sumViews += Number(p.latest_views || 0);
      hookAgg.set(p.hook_id, a);
    }

    // 4. Update hook_performance + apply promote/demote rules
    let promoted = 0;
    let demoted = 0;
    for (const [hookId, agg] of hookAgg.entries()) {
      const avgCompl = agg.complCount > 0 ? agg.sumCompl / agg.complCount : 0.5;
      const avgViews = agg.uses > 0 ? Math.round(agg.sumViews / agg.uses) : 0;

      const update: Record<string, unknown> = {
        avg_completion_rate: avgCompl,
        avg_views: avgViews,
        uses_count: agg.uses,
        impressions: agg.sumViews,
        total_completion_samples: agg.complCount,
      };

      if (agg.complCount >= 3 && avgCompl >= PROMOTE_THRESHOLD) {
        update.is_winning_hook = true;
        update.last_promoted_at = new Date().toISOString();
        promoted += 1;
      } else if (agg.uses >= MIN_USES_FOR_DEMOTE && avgCompl < DEMOTE_THRESHOLD) {
        update.active = false;
        update.last_demoted_at = new Date().toISOString();
        demoted += 1;
      }

      await sb.from('tiktok_hook_performance').update(update).eq('id', hookId);
    }

    const durationMs = Date.now() - startedAt;
    const message = `Processed ${posts?.length || 0} posts • ${hookAgg.size} hooks • ${promoted} promoted • ${demoted} demoted`;

    await sb.from('tiktok_pipeline_logs').insert({
      run_type: 'metrics_processor',
      status: 'success',
      message,
      duration_ms: durationMs,
      metadata: { posts_scanned: posts?.length || 0, hooks_updated: hookAgg.size, promoted, demoted, viral_updates: updatedPosts.length },
    });

    return new Response(
      JSON.stringify({ ok: true, posts: posts?.length || 0, hooks: hookAgg.size, promoted, demoted, viral_updates: updatedPosts.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sb.from('tiktok_pipeline_logs').insert({
      run_type: 'metrics_processor',
      status: 'failed',
      message,
      duration_ms: Date.now() - startedAt,
    });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
// Phase 7 — Pull post analytics from Blotato every 6h, recompute hook performance.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BLOTATO_API_KEY = Deno.env.get("BLOTATO_API_KEY");
const BLOTATO_BASE = "https://backend.blotato.com";

function sb() { return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY); }

async function fetchAnalytics(blotatoPostId: string): Promise<any | null> {
  if (!BLOTATO_API_KEY) return null;
  try {
    const r = await fetch(`${BLOTATO_BASE}/v2/posts/${blotatoPostId}/analytics`, {
      headers: { "blotato-api-key": BLOTATO_API_KEY, "Content-Type": "application/json" },
    });
    if (!r.ok) {
      console.warn(`[metrics-sync] blotato ${r.status} for ${blotatoPostId}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn("[metrics-sync] fetch failed:", e);
    return null;
  }
}

function viralScore(views: number, likes: number, comments: number, shares: number, completion: number): number {
  // Weighted engagement, normalized
  const eng = likes + comments * 3 + shares * 5;
  const engRate = views > 0 ? eng / views : 0;
  return Math.round((views * 0.001 + engRate * 100 + completion * 50) * 100) / 100;
}

async function recomputeHookPerformance() {
  const db = sb();
  // Pull posts with hook_id and metrics
  const { data: posts } = await db
    .from("tiktok_posts")
    .select("hook_id, latest_views, completion_rate, viral_score")
    .not("hook_id", "is", null)
    .gt("latest_views", 0);
  if (!posts || posts.length === 0) return 0;

  const byHook = new Map<string, { views: number; comp: number[]; viral: number[]; n: number }>();
  for (const p of posts) {
    const k = p.hook_id as string;
    if (!byHook.has(k)) byHook.set(k, { views: 0, comp: [], viral: [], n: 0 });
    const acc = byHook.get(k)!;
    acc.views += Number(p.latest_views) || 0;
    if (p.completion_rate != null) acc.comp.push(Number(p.completion_rate));
    if (p.viral_score != null) acc.viral.push(Number(p.viral_score));
    acc.n++;
  }

  let updated = 0;
  for (const [hookId, acc] of byHook) {
    const avgComp = acc.comp.length ? acc.comp.reduce((a, b) => a + b, 0) / acc.comp.length : null;
    const avgViews = acc.n ? acc.views / acc.n : 0;
    const { error } = await db.from("tiktok_hook_performance").update({
      impressions: acc.n,
      avg_completion_rate: avgComp,
      avg_views: Math.round(avgViews),
    }).eq("id", hookId);
    if (!error) updated++;
  }
  return updated;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const start = Date.now();
  const db = sb();
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: posts } = await db
      .from("tiktok_posts")
      .select("id, tiktok_post_id")
      .not("tiktok_post_id", "is", null)
      .gte("posted_at", fourteenDaysAgo);

    let synced = 0, failed = 0;
    for (const p of (posts || [])) {
      const a = await fetchAnalytics(p.tiktok_post_id as string);
      if (!a) { failed++; continue; }
      const views = Number(a.views ?? a.viewCount ?? 0);
      const likes = Number(a.likes ?? a.likeCount ?? 0);
      const comments = Number(a.comments ?? a.commentCount ?? 0);
      const shares = Number(a.shares ?? a.shareCount ?? 0);
      const completion = Number(a.completion_rate ?? a.completionRate ?? 0);
      const vs = viralScore(views, likes, comments, shares, completion);
      const { error } = await db.from("tiktok_posts").update({
        latest_views: views,
        latest_likes: likes,
        latest_comments: comments,
        latest_shares: shares,
        completion_rate: completion || null,
        viral_score: vs,
        metrics_synced_at: new Date().toISOString(),
        last_metrics_check_at: new Date().toISOString(),
      }).eq("id", p.id);
      if (error) { failed++; continue; }
      synced++;
    }

    const hooksUpdated = await recomputeHookPerformance();

    await db.from("tiktok_pipeline_logs").insert({
      run_type: "metrics_sync",
      status: failed === 0 ? "success" : (synced > 0 ? "partial" : "failed"),
      message: `Synced ${synced} posts, ${failed} failed; ${hooksUpdated} hooks updated`,
      duration_ms: Date.now() - start,
    });

    return new Response(JSON.stringify({ success: true, synced, failed, hooks_updated: hooksUpdated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[metrics-sync] fatal:", e);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

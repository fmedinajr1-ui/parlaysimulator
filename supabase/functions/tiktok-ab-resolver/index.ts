// Phase 7 — Resolve A/B groups ≥ 48h old: pick winner by viral_score,
// update account wins/losses, boost winning hook performance.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
function sb() { return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const start = Date.now();
  const db = sb();
  try {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    // Find ab_groups with all posts older than 48h that haven't been resolved yet.
    // We mark resolution by inserting into tiktok_pipeline_logs with run_type='ab_resolved'
    // and the group_id in metadata.
    const { data: posts } = await db
      .from("tiktok_posts")
      .select("id, ab_group_id, account_id, viral_score, hook_id, posted_at, script_id")
      .not("ab_group_id", "is", null)
      .lte("posted_at", cutoff);

    if (!posts || posts.length === 0) {
      return new Response(JSON.stringify({ success: true, resolved: 0, message: "no eligible groups" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already-resolved groups
    const { data: resolvedLogs } = await db
      .from("tiktok_pipeline_logs")
      .select("metadata")
      .eq("run_type", "ab_resolved");
    const resolved = new Set<string>();
    for (const r of resolvedLogs || []) {
      const id = (r.metadata as any)?.ab_group_id;
      if (id) resolved.add(id);
    }

    // Group by ab_group_id
    const groups = new Map<string, typeof posts>();
    for (const p of posts) {
      const k = p.ab_group_id as string;
      if (resolved.has(k)) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }

    let resolvedCount = 0;
    const results: any[] = [];

    for (const [groupId, members] of groups) {
      if (members.length < 2) continue; // need ≥ 2 entries to compare
      const sorted = [...members].sort((a, b) => Number(b.viral_score || 0) - Number(a.viral_score || 0));
      const winner = sorted[0];
      const losers = sorted.slice(1);

      // Bump account wins/losses
      const { data: winAcc } = await db.from("tiktok_accounts").select("wins").eq("id", winner.account_id).maybeSingle();
      await db.from("tiktok_accounts").update({ wins: (winAcc?.wins || 0) + 1 }).eq("id", winner.account_id);
      for (const l of losers) {
        const { data: la } = await db.from("tiktok_accounts").select("losses").eq("id", l.account_id).maybeSingle();
        await db.from("tiktok_accounts").update({ losses: (la?.losses || 0) + 1 }).eq("id", l.account_id);
      }

      // Boost winning hook (+5% to avg_completion_rate, capped at 0.95)
      if (winner.hook_id) {
        const { data: hook } = await db.from("tiktok_hook_performance")
          .select("avg_completion_rate").eq("id", winner.hook_id).maybeSingle();
        const cur = Number(hook?.avg_completion_rate || 0.5);
        const boosted = Math.min(0.95, cur * 1.05);
        await db.from("tiktok_hook_performance")
          .update({ avg_completion_rate: boosted })
          .eq("id", winner.hook_id);
      }

      // Log resolution
      await db.from("tiktok_pipeline_logs").insert({
        run_type: "ab_resolved",
        status: "success",
        message: `A/B group ${groupId.slice(0, 8)} resolved — winner viral_score=${winner.viral_score}`,
        metadata: {
          ab_group_id: groupId,
          winner_post_id: winner.id,
          winner_account_id: winner.account_id,
          winner_viral_score: winner.viral_score,
          loser_post_ids: losers.map(l => l.id),
          loser_viral_scores: losers.map(l => l.viral_score),
        },
      });
      resolvedCount++;
      results.push({ ab_group_id: groupId, winner_id: winner.id, winner_score: winner.viral_score });
    }

    await db.from("tiktok_pipeline_logs").insert({
      run_type: "ab_resolver_run",
      status: "success",
      message: `Checked ${groups.size} groups, resolved ${resolvedCount}`,
      duration_ms: Date.now() - start,
      metadata: { results },
    });

    return new Response(JSON.stringify({ success: true, resolved: resolvedCount, checked: groups.size, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[ab-resolver] fatal:", e);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

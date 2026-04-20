// TikTok Safety Gate — standalone re-lint endpoint.
// Used by admin UI when editing a draft to re-validate after manual changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { VideoScript } from "../_shared/tiktok-types.ts";
import { lintAndRewrite } from "../_shared/tiktok-safety.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const scriptId = body.script_id;
    if (!scriptId) {
      // Inline mode: accepts a {script} shape for ad-hoc check
      if (body.script) {
        const result = lintAndRewrite(body.script as VideoScript);
        return new Response(JSON.stringify({ success: true, result, script: body.script }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: false, error: "script_id or script required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: row, error } = await sb.from("tiktok_video_scripts").select("*").eq("id", scriptId).maybeSingle();
    if (error || !row) return new Response(JSON.stringify({ success: false, error: "script not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const script: VideoScript = {
      id: row.id, template: row.template, target_persona_key: row.target_persona_key, account_id: row.account_id,
      target_duration_sec: Number(row.target_duration_sec || 28),
      hook: row.hook, beats: row.beats || [], cta: row.cta || { vo_text: "", on_screen_text: "" },
      caption_seed: row.caption_seed || "", hashtag_seed: row.hashtag_seed || [],
      source: row.source || {}, compliance_score: 100, lint_transforms: [],
    };
    const result = lintAndRewrite(script);

    await sb.from("tiktok_video_scripts").update({
      hook: script.hook, beats: script.beats, cta: script.cta, caption_seed: script.caption_seed,
      compliance_score: result.score,
      lint_transforms: result.transforms.map(t => ({ from: t.from, to: t.to, beat_index: t.beat_index })),
      lint_warnings: result.warnings,
    }).eq("id", scriptId);

    return new Response(JSON.stringify({ success: true, result, script }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Renders a lip-synced talking-dog video for the given text via HeyGen.
// Caches by text hash so repeated phrases are instant.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HEYGEN_AVATAR_ID = Deno.env.get("HEYGEN_DOG_AVATAR_ID") || ""; // optional photo-avatar id
const ELEVENLABS_VOICE_ID = "nPczCjzI2devNBz1zQrb";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { text, voice_id } = await req.json();
    if (!text) return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const voiceId = voice_id || ELEVENLABS_VOICE_ID;
    const hash = await sha256Hex(`${voiceId}::${text}`);

    // Cache lookup
    const { data: cached } = await supabase.from("live_ai_avatar_cache").select("*").eq("text_hash", hash).maybeSingle();
    if (cached?.avatar_video_url) {
      await supabase.from("live_ai_avatar_cache").update({ hit_count: (cached.hit_count ?? 1) + 1 }).eq("id", cached.id);
      return new Response(JSON.stringify({ video_url: cached.avatar_video_url, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const HEYGEN_KEY = Deno.env.get("HEYGEN_API_KEY");
    if (!HEYGEN_KEY || !HEYGEN_AVATAR_ID) {
      // Graceful fallback: no avatar video, client will use CSS dog
      return new Response(JSON.stringify({ video_url: null, cached: false, fallback: "css_avatar", reason: !HEYGEN_KEY ? "no_heygen_key" : "no_avatar_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Submit HeyGen video.generate
    const submit = await fetch("https://api.heygen.com/v2/video/generate", {
      method: "POST",
      headers: { "X-Api-Key": HEYGEN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        video_inputs: [{
          character: { type: "talking_photo", talking_photo_id: HEYGEN_AVATAR_ID },
          voice: { type: "text", input_text: text, voice_id: "1bd001e7e50f421d891986aad5158bc8" }, // default; ElevenLabs needs separate config
        }],
        dimension: { width: 720, height: 720 },
      }),
    });
    if (!submit.ok) throw new Error(`HeyGen submit ${submit.status}: ${await submit.text()}`);
    const submitData = await submit.json();
    const videoId = submitData.data?.video_id;
    if (!videoId) throw new Error("No video_id from HeyGen");

    // Poll up to 30s
    let videoUrl: string | null = null;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        headers: { "X-Api-Key": HEYGEN_KEY },
      });
      if (!status.ok) continue;
      const s = await status.json();
      if (s.data?.status === "completed" && s.data?.video_url) {
        videoUrl = s.data.video_url;
        break;
      }
      if (s.data?.status === "failed") throw new Error(`HeyGen failed: ${s.data?.error?.message}`);
    }

    if (!videoUrl) {
      return new Response(JSON.stringify({ video_url: null, cached: false, fallback: "css_avatar", reason: "timeout", heygen_video_id: videoId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("live_ai_avatar_cache").insert({
      text_hash: hash,
      text_preview: text.slice(0, 200),
      voice_id: voiceId,
      avatar_video_url: videoUrl,
      heygen_video_id: videoId,
    });

    return new Response(JSON.stringify({ video_url: videoUrl, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("avatar render error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", fallback: "css_avatar" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
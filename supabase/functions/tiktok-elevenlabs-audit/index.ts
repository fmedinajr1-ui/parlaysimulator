// Read-only audit: verifies ElevenLabs quota and lists recent history.
// Zero TTS characters consumed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Subscription / quota
    const subRes = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": apiKey },
    });
    const sub = await subRes.json();

    // 2. History (last 100 generations on this key)
    const histRes = await fetch("https://api.elevenlabs.io/v1/history?page_size=100", {
      headers: { "xi-api-key": apiKey },
    });
    const hist = await histRes.json();
    const history = (hist?.history ?? []).map((h: any) => ({
      date_unix: h.date_unix,
      date_iso: h.date_unix ? new Date(h.date_unix * 1000).toISOString() : null,
      voice_name: h.voice_name,
      voice_id: h.voice_id,
      characters: h.character_count_change_to ?? h.character_count_change ?? 0,
      source: h.source,
      text_preview: (h.text ?? "").slice(0, 80),
    }));
    const historyTotalChars = history.reduce((s: number, h: any) => s + (h.characters || 0), 0);

    // Group by day
    const byDay: Record<string, { count: number; chars: number }> = {};
    for (const h of history) {
      const day = h.date_iso?.slice(0, 10) ?? "unknown";
      byDay[day] ??= { count: 0, chars: 0 };
      byDay[day].count += 1;
      byDay[day].chars += h.characters || 0;
    }

    // 3. App's own render attempts
    const { data: renders } = await sb
      .from("tiktok_video_renders")
      .select("id, status, created_at, script_id, error_message")
      .order("created_at", { ascending: false })
      .limit(100);

    const renderSummary = {
      total: renders?.length ?? 0,
      by_status: {} as Record<string, number>,
    };
    for (const r of renders ?? []) {
      renderSummary.by_status[r.status] = (renderSummary.by_status[r.status] || 0) + 1;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        quota: {
          tier: sub.tier,
          character_count: sub.character_count,
          character_limit: sub.character_limit,
          remaining: (sub.character_limit ?? 0) - (sub.character_count ?? 0),
          next_reset_iso: sub.next_character_count_reset_unix
            ? new Date(sub.next_character_count_reset_unix * 1000).toISOString()
            : null,
          status: sub.status,
        },
        history_summary: {
          entries_returned: history.length,
          total_chars_in_window: historyTotalChars,
          by_day: byDay,
          first: history[history.length - 1] ?? null,
          latest: history[0] ?? null,
        },
        recent_history: history.slice(0, 20),
        app_renders: renderSummary,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
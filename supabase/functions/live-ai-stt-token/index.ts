// Public endpoint:
//  - GET / POST (no body): issues a single-use ElevenLabs Scribe Realtime token
//  - POST multipart with `audio` file: batch transcribes via scribe_v2 and returns { text }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      // Batch transcription path
      const form = await req.formData();
      const audio = form.get("audio") as File | null;
      if (!audio) {
        return new Response(JSON.stringify({ error: "audio file required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const apiForm = new FormData();
      apiForm.append("file", audio);
      apiForm.append("model_id", "scribe_v2");
      apiForm.append("language_code", "eng");
      const tr = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: apiForm,
      });
      if (!tr.ok) throw new Error(`Transcribe failed: ${tr.status} ${await tr.text()}`);
      const j = await tr.json();
      return new Response(JSON.stringify({ text: j.text ?? "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Realtime token path
    const r = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
    });
    if (!r.ok) throw new Error(`ElevenLabs token failed: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return new Response(JSON.stringify({ token: data.token }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("stt-token error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
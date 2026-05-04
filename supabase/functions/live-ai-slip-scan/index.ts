const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OCR_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_legs",
    description: "Extract betting legs from a parlay slip image",
    parameters: {
      type: "object",
      properties: {
        legs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              player_name: { type: "string" },
              prop_type: { type: "string" },
              line: { type: "number" },
              side: { type: "string", enum: ["over", "under"] },
              american_odds: { type: "number" },
            },
            required: ["player_name", "prop_type", "line", "side"],
          },
        },
        sportsbook: { type: "string" },
      },
      required: ["legs"],
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Public endpoint — anyone visiting /live-ai can scan a slip for Spike.
    const { image_data_url } = await req.json();
    if (!image_data_url) return new Response(JSON.stringify({ error: "image_data_url required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Extract every betting leg from the slip image. Be precise about player names, lines, and over/under. Skip unclear legs." },
          { role: "user", content: [
            { type: "text", text: "Extract the legs from this parlay slip." },
            { type: "image_url", image_url: { url: image_data_url } },
          ]},
        ],
        tools: [OCR_TOOL],
        tool_choice: { type: "function", function: { name: "extract_legs" } },
      }),
    });
    if (r.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) throw new Error(`OCR failed: ${r.status} ${await r.text()}`);
    const j = await r.json();
    const tc = j.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = { legs: [] };
    if (tc?.function?.arguments) {
      try { parsed = JSON.parse(tc.function.arguments); } catch {}
    }
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("slip scan error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
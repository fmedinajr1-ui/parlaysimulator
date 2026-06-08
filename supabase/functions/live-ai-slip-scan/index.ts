const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Expanded schema: handles BOTH player prop legs and team-side legs (spread / moneyline / total)
// from a slate / board screenshot, not just a built parlay slip. Used by Spike's fade-mode
// ingestion so we can feed real lines into the simulator.
const OCR_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_slate",
    description:
      "Extract every betting market visible in the screenshot(s): player prop legs and team lines (spread, moneyline, total). Skip anything you cannot read with high confidence.",
    parameters: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Best guess of the sport (NBA, NFL, MLB, NHL, NCAAF, NCAAB, WNBA, MMA, Tennis, Soccer, Golf).",
        },
        sportsbook: {
          type: "string",
          description: "Sportsbook brand if visible (FanDuel, DraftKings, BetMGM, Caesars, PrizePicks, Underdog, etc.).",
        },
        player_legs: {
          type: "array",
          description: "Player prop markets (points, rebounds, strikeouts, etc.).",
          items: {
            type: "object",
            properties: {
              player_name: { type: "string" },
              team: { type: "string", description: "Team abbreviation if visible." },
              opponent: { type: "string", description: "Opponent abbreviation if visible." },
              prop_type: {
                type: "string",
                description: "Normalized property name, full words: Points, Rebounds, Assists, 3PT Made, Strikeouts, Hits, Total Bases, Passing Yards, etc.",
              },
              line: { type: "number" },
              side: { type: "string", enum: ["over", "under"] },
              american_odds: { type: "number" },
              confidence: {
                type: "number",
                description: "0-1 confidence this leg was read correctly.",
              },
            },
            required: ["player_name", "prop_type", "line", "side"],
          },
        },
        team_legs: {
          type: "array",
          description: "Team-side markets (spread, moneyline, total).",
          items: {
            type: "object",
            properties: {
              market: {
                type: "string",
                enum: ["spread", "moneyline", "total"],
              },
              team: { type: "string", description: "The team this leg is on (or OVER/UNDER for totals)." },
              opponent: { type: "string" },
              line: { type: "number", description: "Spread number, total number, or omit for moneyline." },
              side: {
                type: "string",
                enum: ["over", "under", "team"],
                description: "Use 'over'/'under' for totals, 'team' for spread/moneyline.",
              },
              american_odds: { type: "number" },
              game_time: { type: "string", description: "Kickoff/tipoff time as displayed." },
              confidence: { type: "number" },
            },
            required: ["market", "team"],
          },
        },
        notes: {
          type: "string",
          description: "Anything visible but unparseable, e.g. 'second screenshot was cut off at the bottom'.",
        },
      },
      required: ["player_legs", "team_legs"],
    },
  },
};

const SYSTEM_PROMPT = `You are an expert OCR extractor for sports betting slates and slips.

You will receive one or more screenshots from a sportsbook or DFS app. They may show:
- a built parlay slip,
- a player-prop board for a single player,
- a slate / lobby with multiple games and team lines,
- alt-line ladders.

Your job:
1. Pull EVERY market you can read confidently. Multiple images = merge into one combined extraction; do not duplicate the same leg twice.
2. Normalize prop names to full words ("Points" not "PTS", "3PT Made" not "3s", "Strikeouts" not "Ks").
3. American odds: keep the sign (+150, -110). If odds are missing, omit the field — never guess.
4. Spreads: line is the point spread for that team (e.g. Lakers -4.5 → team:"Lakers", line:-4.5).
5. Totals: side is "over" or "under", line is the total points number.
6. If a leg is blurry, partially cropped, or you are <60% sure, SKIP it and mention it briefly in 'notes'. Do not hallucinate.
7. Always populate 'confidence' (0-1) per leg.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Public endpoint — anyone visiting /live-ai can scan a slip/slate for Spike.
    const body = await req.json();
    // Backward compatible: accept either a single `image_data_url` or an array of `image_data_urls`.
    const images: string[] = Array.isArray(body?.image_data_urls)
      ? body.image_data_urls.filter((s: any) => typeof s === "string" && s.startsWith("data:"))
      : body?.image_data_url
        ? [body.image_data_url]
        : [];
    if (!images.length) {
      return new Response(JSON.stringify({ error: "image_data_url(s) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Hard cap: 6 images per call to keep latency / token usage sane.
    const capped = images.slice(0, 6);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const userContent: any[] = [
      {
        type: "text",
        text: `Extract every market from ${capped.length === 1 ? "this screenshot" : `these ${capped.length} screenshots`}. Merge duplicates. Use the extract_slate tool.`,
      },
      ...capped.map((url) => ({ type: "image_url", image_url: { url } })),
    ];

    // Two-pass strategy: try Pro first for fidelity. If it fails (5xx) or returns
    // zero legs across both arrays, fall back to Flash so we still surface something.
    const callModel = async (model: string) =>
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          tools: [OCR_TOOL],
          tool_choice: { type: "function", function: { name: "extract_slate" } },
        }),
      });

    let r = await callModel("google/gemini-2.5-pro");
    if (r.status === 429)
      return new Response(JSON.stringify({ error: "Rate limited — try again in a few seconds." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    if (r.status === 402)
      return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    let parsed: any = { player_legs: [], team_legs: [] };
    let modelUsed = "google/gemini-2.5-pro";
    const parseResp = async (resp: Response) => {
      const j = await resp.json();
      const tc = j.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) {
        try {
          return JSON.parse(tc.function.arguments);
        } catch {
          return null;
        }
      }
      return null;
    };

    if (r.ok) {
      const p = await parseResp(r);
      if (p) parsed = p;
    }

    const totalLegs =
      (parsed?.player_legs?.length ?? 0) + (parsed?.team_legs?.length ?? 0);

    if (!r.ok || totalLegs === 0) {
      console.warn("[slip-scan] Pro pass weak (status", r.status, "legs", totalLegs, ") — falling back to Flash");
      const r2 = await callModel("google/gemini-2.5-flash");
      if (r2.ok) {
        const p2 = await parseResp(r2);
        if (p2) {
          parsed = p2;
          modelUsed = "google/gemini-2.5-flash";
        }
      } else if (!r.ok) {
        throw new Error(`OCR failed: ${r2.status} ${await r2.text()}`);
      }
    }

    // Backward-compat: keep the old `legs` array (player-only) for any caller still on v1.
    const legacyLegs = (parsed?.player_legs ?? []).map((l: any) => ({
      player_name: l.player_name,
      prop_type: l.prop_type,
      line: l.line,
      side: l.side,
      american_odds: l.american_odds,
    }));

    return new Response(JSON.stringify({ ...parsed, legs: legacyLegs, model: modelUsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("slip scan error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
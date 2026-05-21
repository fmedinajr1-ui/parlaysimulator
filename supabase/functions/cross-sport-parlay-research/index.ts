/**
 * cross-sport-parlay-research
 *
 * Uses Perplexity sonar-pro to gather daily intelligence per active sport.
 * Stores normalized findings in bot_research_findings and emits a research_boost
 * map (player+team -> [-0.10..+0.10]) consumed by cross-sport-sweet-spots.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORT_PROMPTS: Record<string, { query: string; system: string }> = {
  MLB: {
    system: "You are an MLB betting intelligence analyst. Return only verifiable, current-day intel.",
    query: "For TODAY's MLB slate, list: (1) probable starting pitchers and any with ERA<3 or short rest, (2) ballparks with wind >10mph blowing out/in, (3) confirmed injury/lineup scratches, (4) sharp money / steam moves on totals or run lines. Be specific with team names and player names.",
  },
  NHL: {
    system: "You are an NHL betting analyst. Return verifiable current-day intel.",
    query: "For TODAY's NHL slate, list: (1) confirmed starting goalies with save % under .900 last 5, (2) injury scratches / line-rushes changes, (3) sharp money on totals or puck lines, (4) back-to-back fatigue spots.",
  },
  NCAAB: {
    system: "You are an NCAAB betting analyst. Return verifiable current-day intel.",
    query: "For TODAY's NCAA men's basketball slate, list: (1) games with injured/suspended starters, (2) tempo mismatches (one team top-50 pace vs bottom-50), (3) sharp money / reverse line movement on spreads or totals, (4) any letdown/revenge spots.",
  },
  NCAAF: {
    system: "You are an NCAAF betting analyst.",
    query: "For TODAY's NCAA football slate, list: (1) weather affecting totals, (2) starting QB injuries, (3) sharp money on spreads or totals, (4) letdown/revenge spots.",
  },
  NBA: {
    system: "You are an NBA betting analyst.",
    query: "For TONIGHT's NBA slate, list: (1) confirmed scratches and load-management decisions, (2) starting lineup changes, (3) sharp money on player props (PTS/REB/AST/3PM), (4) pace-up matchups.",
  },
};

const BOOST_SCHEMA = {
  name: "boosts",
  schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        team_boosts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              team: { type: "string" },
              market: { type: "string", enum: ["total","spread","moneyline","any"] },
              side: { type: "string", enum: ["over","under","home","away","any"] },
              boost: { type: "number", description: "between -0.10 and 0.10" },
              reason: { type: "string" },
            },
            required: ["team","market","side","boost","reason"],
          },
        },
        player_boosts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              player: { type: "string" },
              prop_hint: { type: "string", description: "e.g. strikeouts, points, shots" },
              side: { type: "string", enum: ["over","under","any"] },
              boost: { type: "number" },
              reason: { type: "string" },
            },
            required: ["player","side","boost","reason"],
          },
        },
      },
      required: ["summary","team_boosts","player_boosts"],
  },
};

async function runPerplexity(systemPrompt: string, query: string, apiKey: string) {
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        { role: "system", content: `${systemPrompt} Respond ONLY with strict JSON matching the schema. Cap each boost at +/- 0.10.` },
        { role: "user", content: query },
      ],
      search_recency_filter: "day",
      response_format: { type: "json_schema", json_schema: BOOST_SCHEMA },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`perplexity ${resp.status}: ${t.slice(0,300)}`);
  }
  const data = await resp.json();
  const choice = data.choices?.[0]?.message;
  const content = choice?.content ?? "";
  try { return JSON.parse(content); } catch { /* fallthrough */ }
  // Best-effort JSON extraction
  const m = content.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return { summary: content.slice(0, 500), team_boosts: [], player_boosts: [] };
}

function todayET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString().slice(0, 10);
}

async function getActiveSports(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const { data } = await supabase
    .from("unified_props")
    .select("sport")
    .eq("is_active", true)
    .limit(5000);
  const set = new Set<string>();
  for (const r of data ?? []) {
    const s = String((r as { sport?: string }).sport ?? "").toLowerCase();
    if (s.includes("mlb")) set.add("MLB");
    else if (s.includes("nhl")) set.add("NHL");
    else if (s.includes("nba")) set.add("NBA");
    else if (s.includes("ncaab") || s.includes("basketball_ncaa")) set.add("NCAAB");
    else if (s.includes("ncaaf") || s.includes("football_ncaa")) set.add("NCAAF");
  }
  return [...set];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY not configured");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const sports = await getActiveSports(supabase);
    const date = todayET();
    const results: Record<string, unknown> = {};

    for (const sport of sports) {
      const cfg = SPORT_PROMPTS[sport];
      if (!cfg) continue;
      try {
        const parsed = await runPerplexity(cfg.system, cfg.query, PERPLEXITY_API_KEY);
        results[sport] = parsed;
        await supabase.from("bot_research_findings").insert({
          research_date: date,
          category: `cross_sport_${sport.toLowerCase()}`,
          title: `${sport} cross-sport research`,
          summary: parsed.summary ?? "",
          key_insights: parsed,
          sources: [],
          relevance_score: 0.7,
          actionable: true,
        });
      } catch (e) {
        console.error(`research ${sport} failed`, e);
        results[sport] = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    return new Response(JSON.stringify({ ok: true, date, sports, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cross-sport-parlay-research error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
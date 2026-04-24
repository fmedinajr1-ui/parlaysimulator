// @ts-nocheck
// FanDuel Boost Scanner
// Scrapes the FanDuel boosts/promos lobby via Firecrawl, parses each boost
// into structured legs with Lovable AI, and stores fresh ones in fanduel_boosts.
// Designed to be invoked on a cron schedule.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";

const TARGET_URLS = [
  "https://sportsbook.fanduel.com/promos",
  "https://sportsbook.fanduel.com/boosts",
];

const BOOST_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "extract_boosts",
    description:
      "Extract every boosted parlay / odds-boost card visible in the FanDuel promos page.",
    parameters: {
      type: "object",
      properties: {
        boosts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Promo title, e.g. 'First Frame Fever'" },
              category: {
                type: ["string", "null"],
                description: "Section header it appeared under, e.g. 'MLB Boosts', 'NBA Boosts', 'The Hundred'",
              },
              sport: {
                type: ["string", "null"],
                description: "Lowercase sport key: nba, mlb, nfl, nhl, ncaaf, ncaab, soccer, tennis, mma, golf, mixed",
              },
              original_odds: {
                type: ["integer", "null"],
                description: "Pre-boost American odds (e.g. +1581). Null if not shown.",
              },
              boosted_odds: {
                type: ["integer", "null"],
                description: "Post-boost American odds (e.g. +1749). Required for a real boost.",
              },
              pays_text: {
                type: ["string", "null"],
                description: "Text like '$10 pays $184.91' if present.",
              },
              legs: {
                type: "array",
                description: "One entry per leg of the boosted parlay.",
                items: {
                  type: "object",
                  properties: {
                    sport: { type: ["string", "null"] },
                    market_type: {
                      type: "string",
                      description:
                        "Short token: 'player_points', 'player_rebounds', 'player_threes', 'team_moneyline', 'team_total', 'first_inning_runs', 'spread', 'game_total', etc.",
                    },
                    player_name: { type: ["string", "null"] },
                    team: { type: ["string", "null"] },
                    opponent: { type: ["string", "null"] },
                    game_description: {
                      type: ["string", "null"],
                      description: "e.g. 'DET @ CIN' or 'Lakers vs Warriors'",
                    },
                    line: { type: ["number", "null"] },
                    side: {
                      type: ["string", "null"],
                      description: "'over', 'under', 'win', 'cover', or null",
                    },
                    raw_text: { type: ["string", "null"] },
                  },
                  required: ["market_type"],
                  additionalProperties: false,
                },
              },
            },
            required: ["title", "boosted_odds", "legs"],
            additionalProperties: false,
          },
        },
      },
      required: ["boosts"],
      additionalProperties: false,
    },
  },
};

async function firecrawlScrape(url: string, apiKey: string): Promise<string | null> {
  const res = await fetch(FIRECRAWL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 4000,
    }),
  });
  if (!res.ok) {
    console.error(`firecrawl ${url} failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const json = await res.json();
  const md =
    json?.data?.markdown ??
    json?.markdown ??
    json?.data?.content ??
    null;
  return typeof md === "string" && md.length > 0 ? md : null;
}

async function aiExtractBoosts(markdown: string): Promise<any[]> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const system =
    "You parse sportsbook boost/promo pages into structured data. Treat every odds-boost card, featured parlay, and 'hundred' style multi-leg promo as a boost. Skip pure deposit-bonus ads with no parlay legs. Sports are lowercase (nba, mlb, nfl, nhl, ncaaf, ncaab, etc.). For each leg, extract enough info to look up the corresponding real market line later. American odds only.";

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Extract every boost from this FanDuel promo page markdown. Return structured tool call only.\n\n---\n${markdown.slice(0, 30000)}`,
        },
      ],
      tools: [BOOST_TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "extract_boosts" } },
    }),
  });

  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) throw new Error(`ai_${res.status}: ${await res.text()}`);

  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return [];
  try {
    const parsed = JSON.parse(call.function.arguments);
    return Array.isArray(parsed.boosts) ? parsed.boosts : [];
  } catch {
    return [];
  }
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalLegKey(leg: any): string {
  return [
    leg.sport ?? "",
    leg.market_type ?? "",
    (leg.player_name ?? leg.team ?? "").toLowerCase().trim(),
    leg.line ?? "",
    (leg.side ?? "").toLowerCase(),
    (leg.game_description ?? "").toLowerCase().trim(),
  ].join("|");
}

async function buildBoostHash(boost: any): Promise<string> {
  const legPart = (boost.legs ?? [])
    .map(canonicalLegKey)
    .sort()
    .join("||");
  return sha256(`${(boost.title ?? "").toLowerCase().trim()}::${legPart}`);
}

function inferSportFromBoost(boost: any): string | null {
  if (boost.sport) return String(boost.sport).toLowerCase();
  const cat = String(boost.category ?? "").toLowerCase();
  for (const s of ["nba", "mlb", "nfl", "nhl", "ncaab", "ncaaf", "wnba", "soccer", "tennis", "mma", "ufc", "golf", "pga"]) {
    if (cat.includes(s)) return s;
  }
  // Fall back from leg sports
  const legSports = (boost.legs ?? []).map((l: any) => String(l.sport ?? "").toLowerCase()).filter(Boolean);
  const unique = Array.from(new Set(legSports));
  if (unique.length === 1) return unique[0] as string;
  if (unique.length > 1) return "mixed";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) throw new Error("FIRECRAWL_API_KEY missing");

    let scraped = 0;
    let parsed = 0;
    let inserted = 0;
    const errors: string[] = [];

    for (const url of TARGET_URLS) {
      try {
        const md = await firecrawlScrape(url, firecrawlKey);
        if (!md) {
          errors.push(`scrape_empty:${url}`);
          continue;
        }
        scraped++;

        const boosts = await aiExtractBoosts(md);
        parsed += boosts.length;

        for (const boost of boosts) {
          if (!boost.boosted_odds || !Array.isArray(boost.legs) || boost.legs.length === 0) continue;

          const hash = await buildBoostHash(boost);
          const sport = inferSportFromBoost(boost);

          const { error: insertError, data: insertData } = await supabase
            .from("fanduel_boosts")
            .insert({
              boost_hash: hash,
              title: String(boost.title).slice(0, 200),
              category: boost.category ?? null,
              sport,
              original_odds: boost.original_odds ?? null,
              boosted_odds: boost.boosted_odds,
              pays_text: boost.pays_text ?? null,
              legs: boost.legs,
              raw_text: null,
              source_url: url,
            })
            .select("id");

          if (insertError) {
            // 23505 = unique violation = already had this boost; not an error.
            if (!String(insertError.message).includes("duplicate") && insertError.code !== "23505") {
              errors.push(`insert:${insertError.message}`);
            }
            continue;
          }
          if (insertData && insertData.length > 0) inserted++;
        }
      } catch (e) {
        errors.push(`${url}:${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, scraped, parsed, inserted, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fanduel-boost-scanner error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
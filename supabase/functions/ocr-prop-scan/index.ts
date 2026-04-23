// @ts-nocheck
// OCR Prop Scanner — vision OCR + deep cross-reference
// Input: { session_id, frames: string[] (base64 data URLs OR raw base64), book, sport, source_channel? }
// Output: { ok, parsed: number, inserted: number, props: [...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VISION_MODEL = "google/gemini-3-flash-preview";

const BOOK_HINTS: Record<string, string> = {
  fanduel:
    "FanDuel layout: prop type as section header; player rows show name + line, then OVER price stacked above UNDER price (e.g. '27.5  Over -115 / Under -105'). American odds.",
  draftkings:
    "DraftKings layout: line in middle, OVER on left and UNDER on right of the same row. American odds.",
  hardrock:
    "Hard Rock Bet layout: dense grid; bolded player name on top of card, line + over/under prices in compact rows. American odds.",
  prizepicks:
    "PrizePicks pick'em: NO over/under odds — just player + projection line + 'More' / 'Less' buttons. Map 'More'->over, 'Less'->under. Set over_price=null, under_price=null.",
  underdog:
    "Underdog Fantasy pick'em: NO odds — player + projection line + Higher/Lower. Map Higher->over, Lower->under. Set over_price=null, under_price=null.",
};

const VISION_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "extract_props",
    description: "Extract every player prop visible in the sportsbook screenshot.",
    parameters: {
      type: "object",
      properties: {
        props: {
          type: "array",
          items: {
            type: "object",
            properties: {
              player_name: { type: "string" },
              prop_type: { type: "string" },
              line: { type: "number" },
              side: { type: "string", enum: ["over", "under"] },
              over_price: { type: ["integer", "null"] },
              under_price: { type: ["integer", "null"] },
              confidence: { type: "number" },
              raw_text: { type: "string" },
            },
            required: ["player_name", "prop_type", "line", "side"],
            additionalProperties: false,
          },
        },
      },
      required: ["props"],
      additionalProperties: false,
    },
  },
};

function normalizePropType(raw: string): string {
  const s = raw.toLowerCase().trim().replace(/[^a-z0-9_+]/g, "_").replace(/_+/g, "_");
  const map: Record<string, string> = {
    pts: "points", points: "points",
    reb: "rebounds", rebounds: "rebounds",
    ast: "assists", assists: "assists",
    three_pointers_made: "threes", threes_made: "threes", "3pm": "threes", threes: "threes",
    pra: "pra", points_rebounds_assists: "pra",
    pr: "pr", points_rebounds: "pr",
    pa: "pa", points_assists: "pa",
    ra: "ra", rebounds_assists: "ra",
    hits: "hits",
    total_bases: "total_bases",
    strikeouts: "strikeouts", ks: "strikeouts",
    passing_yards: "passing_yards",
    rushing_yards: "rushing_yards",
    receiving_yards: "receiving_yards",
    receptions: "receptions",
  };
  return map[s] ?? s;
}

async function visionOcr(frames: string[], book: string, sport: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const system = `You are a precise sportsbook OCR parser. Extract EVERY player prop visible.\nBook: ${book}\nSport: ${sport}\n${BOOK_HINTS[book] ?? ""}\nIf a single card shows BOTH over and under, output TWO rows (one per side).\nOnly include props where the player_name and line are clearly readable.\nReturn structured tool call only.`;

  const content: any[] = [{ type: "text", text: "Extract all visible player props from these screenshots." }];
  for (const f of frames) {
    const url = f.startsWith("data:") ? f : `data:image/jpeg;base64,${f}`;
    content.push({ type: "image_url", image_url: { url } });
  }

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      tools: [VISION_TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "extract_props" } },
    }),
  });

  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) throw new Error(`vision_${res.status}: ${await res.text()}`);

  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return [];
  try {
    const parsed = JSON.parse(call.function.arguments);
    return Array.isArray(parsed.props) ? parsed.props : [];
  } catch {
    return [];
  }
}

function mapStatKey(propType: string, table: string): string | null {
  if (table === "nba_player_game_logs") {
    const m: Record<string, string> = {
      points: "pts", rebounds: "reb", assists: "ast", threes: "fg3m",
      pra: "pra", pr: "pr", pa: "pa", ra: "ra",
    };
    return m[propType] ?? null;
  }
  if (table === "mlb_player_game_logs") {
    const m: Record<string, string> = {
      hits: "hits", total_bases: "total_bases", strikeouts: "strikeouts",
    };
    return m[propType] ?? null;
  }
  return null;
}

function computeDna(args: {
  l10Hit: number | null;
  marketPriceDelta: number | null;
  hasMatch: boolean;
  sweetSpotId: string | null;
}): number {
  let score = 50;
  if (args.hasMatch) score += 10;
  if (args.l10Hit !== null) {
    if (args.l10Hit >= 0.7) score += 25;
    else if (args.l10Hit >= 0.5) score += 12;
    else if (args.l10Hit < 0.3) score -= 20;
  }
  if (args.sweetSpotId) score += 15;
  if (args.marketPriceDelta !== null && args.marketPriceDelta > 0) score += 5;
  return Math.max(0, Math.min(100, score));
}

async function crossReference(supabase: any, prop: any, sport: string) {
  const playerLike = prop.player_name;
  const propType = normalizePropType(prop.prop_type);

  const today = new Date().toISOString().slice(0, 10);
  const { data: matches } = await supabase
    .from("unified_props")
    .select("id,player_name,prop_type,current_line,over_price,under_price,event_id,commence_time")
    .ilike("player_name", `%${playerLike}%`)
    .eq("prop_type", propType)
    .gte("commence_time", today)
    .limit(5);

  let matched: any = null;
  if (matches && matches.length > 0) {
    matched =
      matches.find((m: any) => Math.abs(Number(m.current_line) - Number(prop.line)) < 0.5) ??
      matches[0];
  }

  const marketPrice = prop.side === "over" ? matched?.over_price : matched?.under_price;
  const ocrPrice = prop.side === "over" ? prop.over_price : prop.under_price;
  const marketPriceDelta =
    typeof marketPrice === "number" && typeof ocrPrice === "number"
      ? Number(ocrPrice) - Number(marketPrice)
      : null;

  let l10Hit: number | null = null;
  let l10Avg: number | null = null;
  const logsTable =
    sport.toLowerCase() === "nba"
      ? "nba_player_game_logs"
      : sport.toLowerCase() === "mlb"
        ? "mlb_player_game_logs"
        : null;
  if (logsTable) {
    const { data: logs } = await supabase
      .from(logsTable)
      .select("*")
      .ilike("player_name", `%${playerLike}%`)
      .order("game_date", { ascending: false })
      .limit(10);
    if (logs && logs.length > 0) {
      const statKey = mapStatKey(propType, logsTable);
      if (statKey) {
        const vals = logs
          .map((l: any) => Number(l[statKey]))
          .filter((v: number) => !Number.isNaN(v));
        if (vals.length > 0) {
          l10Avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          const hits = vals.filter((v: number) =>
            prop.side === "over" ? v > Number(prop.line) : v < Number(prop.line),
          ).length;
          l10Hit = hits / vals.length;
        }
      }
    }
  }

  let sweetSpotId: string | null = null;
  const { data: sweet } = await supabase
    .from("category_sweet_spots")
    .select("id")
    .ilike("player_name", `%${playerLike}%`)
    .eq("category", propType)
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .limit(1)
    .maybeSingle();
  sweetSpotId = sweet?.id ?? null;

  const dna = computeDna({ l10Hit, marketPriceDelta, hasMatch: !!matched, sweetSpotId });
  const composite = Math.round(
    (l10Hit ?? 0.5) * 50 + (sweetSpotId ? 20 : 0) + (matched ? 15 : 0) + (dna >= 70 ? 15 : 0),
  );

  let blocked = false;
  let blockReason: string | null = null;
  if (!matched) {
    blocked = true;
    blockReason = "no_match_in_unified_props";
  } else if (l10Hit !== null && l10Hit < 0.3) {
    blocked = true;
    blockReason = `low_l10_hit_rate:${(l10Hit * 100).toFixed(0)}%`;
  } else if (dna < 35) {
    blocked = true;
    blockReason = `low_dna:${dna}`;
  }

  const correlationTags: string[] = [];
  if (matched?.event_id) correlationTags.push(`game:${matched.event_id}`);
  if (sweetSpotId) correlationTags.push("sweet_spot");
  if (l10Hit !== null && l10Hit >= 0.7) correlationTags.push("hot_l10");

  return {
    matched_unified_prop_id: matched?.id ?? null,
    market_price_delta: marketPriceDelta,
    l10_hit_rate: l10Hit,
    l10_avg: l10Avg,
    sweet_spot_id: sweetSpotId,
    dna_score: dna,
    composite_score: composite,
    correlation_tags: correlationTags,
    blocked,
    block_reason: blockReason,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { session_id, frames, book, sport, source_channel = "web" } = await req.json();
    if (!session_id || !Array.isArray(frames) || frames.length === 0 || !book || !sport) {
      return new Response(
        JSON.stringify({ ok: false, error: "session_id, frames[], book, sport required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cappedFrames = frames.slice(0, 6);
    const parsed = await visionOcr(
      cappedFrames,
      String(book).toLowerCase(),
      String(sport).toLowerCase(),
    );

    const enriched: any[] = [];
    for (const p of parsed) {
      const propType = normalizePropType(String(p.prop_type));
      const xref = await crossReference(
        supabase,
        { ...p, prop_type: propType },
        String(sport).toLowerCase(),
      );
      enriched.push({
        session_id,
        player_name: String(p.player_name).trim(),
        prop_type: propType,
        side: p.side,
        line: Number(p.line),
        over_price: typeof p.over_price === "number" ? p.over_price : null,
        under_price: typeof p.under_price === "number" ? p.under_price : null,
        raw_ocr_text: p.raw_text ?? null,
        confidence: typeof p.confidence === "number" ? p.confidence : 0.85,
        source_channel,
        ...xref,
      });
    }

    let inserted = 0;
    if (enriched.length > 0) {
      const { error, count } = await supabase
        .from("ocr_scanned_props")
        .upsert(enriched, {
          onConflict: "session_id,player_name,prop_type,side,line",
          count: "exact",
        });
      if (error) throw new Error(`db_upsert: ${error.message}`);
      inserted = count ?? enriched.length;
    }

    return new Response(
      JSON.stringify({ ok: true, parsed: parsed.length, inserted, props: enriched }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ocr-prop-scan error", e);
    const msg = e instanceof Error ? e.message : "unknown";
    const status = msg === "rate_limited" ? 429 : msg === "ai_credits_exhausted" ? 402 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
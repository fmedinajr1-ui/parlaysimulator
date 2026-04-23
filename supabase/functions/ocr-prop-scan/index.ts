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
const OPENAI_VISION_URL = "https://api.openai.com/v1/chat/completions";
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

// Maps the scanner's short prop type to the canonical name used in unified_props
// (which follows the Odds API "player_*" convention).
const UNIFIED_PROP_MAP: Record<string, string> = {
  points: "player_points",
  rebounds: "player_rebounds",
  assists: "player_assists",
  threes: "player_threes",
  pra: "player_points_rebounds_assists",
  pr: "player_points_rebounds",
  pa: "player_points_assists",
  ra: "player_rebounds_assists",
  shots_on_goal: "player_shots_on_goal",
  steals: "player_steals",
  blocks: "player_blocks",
  goals: "player_goals",
  // MLB / others stay as-is — they aren't prefixed in unified_props for those sports
  hits: "hits",
  total_bases: "total_bases",
  strikeouts: "strikeouts",
  passing_yards: "passing_yards",
  rushing_yards: "rushing_yards",
  receiving_yards: "receiving_yards",
  receptions: "receptions",
};

// Prop types that exist on PrizePicks/Underdog but have no liquid sportsbook
// market. Drop them from the pool instead of failing to match.
const UNSUPPORTED_PROP_TYPES = new Set([
  "2_pt_made",
  "fg_made",
  "fg_attempts",
  "free_throws_made",
  "ft_made",
  "first_basket",
  "double_double",
  "triple_double",
]);

function depunct(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function lastNameInitialKey(name: string): string | null {
  const tokens = depunct(name).split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  const first = tokens[0][0];
  const last = tokens[tokens.length - 1];
  return `${first}|${last}`;
}

function americanToImpliedProb(odds: number | null | undefined): number | null {
  if (odds == null || Number.isNaN(odds)) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function buildVisionMessages(frames: string[], book: string, sport: string) {
  const system = `You are a precise sportsbook OCR parser. Extract EVERY player prop visible.\nBook: ${book}\nSport: ${sport}\n${BOOK_HINTS[book] ?? ""}\nIf a single card shows BOTH over and under, output TWO rows (one per side).\nOnly include props where the player_name and line are clearly readable.\nReturn structured tool call only.`;

  const content: any[] = [{ type: "text", text: "Extract all visible player props from these screenshots." }];
  for (const f of frames) {
    const url = f.startsWith("data:") ? f : `data:image/jpeg;base64,${f}`;
    content.push({ type: "image_url", image_url: { url } });
  }

  return {
    system,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
  };
}

function parseVisionToolCall(data: any) {
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return [];
  try {
    const parsed = JSON.parse(call.function.arguments);
    return Array.isArray(parsed.props) ? parsed.props : [];
  } catch {
    return [];
  }
}

async function lovableVisionOcr(frames: string[], book: string, sport: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const { messages } = buildVisionMessages(frames, book, sport);

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages,
      tools: [VISION_TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "extract_props" } },
    }),
  });

  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) throw new Error(`vision_${res.status}: ${await res.text()}`);

  const data = await res.json();
  return parseVisionToolCall(data);
}

async function openAiVisionOcr(frames: string[], book: string, sport: string) {
  const openAIKey = Deno.env.get("OPENAI_API_KEY");
  if (!openAIKey) throw new Error("OPENAI_API_KEY missing");

  const { messages } = buildVisionMessages(frames, book, sport);
  const models = ["gpt-4o", "gpt-4o-mini"];
  let lastError: Error | null = null;

  for (const model of models) {
    const res = await fetch(OPENAI_VISION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAIKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: [VISION_TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "extract_props" } },
      }),
    });

    if (res.status === 402) throw new Error("openai_credits_exhausted");
    if (res.status === 429) {
      lastError = new Error("openai_rate_limited");
      continue;
    }
    if (!res.ok) {
      const detail = await res.text();
      lastError = new Error(`openai_vision_${res.status}: ${detail}`);
      if (res.status >= 500 && model !== models[models.length - 1]) continue;
      throw lastError;
    }

    const data = await res.json();
    return parseVisionToolCall(data);
  }

  throw lastError ?? new Error("openai_vision_failed");
}

async function visionOcr(frames: string[], book: string, sport: string) {
  const hasLovable = Boolean(Deno.env.get("LOVABLE_API_KEY"));
  const hasOpenAI = Boolean(Deno.env.get("OPENAI_API_KEY"));
  if (!hasLovable && !hasOpenAI) throw new Error("ocr_provider_not_configured");

  let lovableError: Error | null = null;

  if (hasLovable) {
    try {
      return await lovableVisionOcr(frames, book, sport);
    } catch (error) {
      lovableError = error instanceof Error ? error : new Error(String(error));
      console.error("[ocr-prop-scan] Lovable OCR failed:", lovableError.message);
      if (!hasOpenAI) throw lovableError;
    }
  }

  if (hasOpenAI) {
    try {
      return await openAiVisionOcr(frames, book, sport);
    } catch (error) {
      const openAiError = error instanceof Error ? error : new Error(String(error));
      console.error("[ocr-prop-scan] OpenAI OCR failed:", openAiError.message);
      if (lovableError?.message === "ai_credits_exhausted" && openAiError.message === "openai_credits_exhausted") {
        throw new Error("ai_credits_exhausted");
      }
      throw openAiError;
    }
  }

  throw lovableError ?? new Error("ocr_provider_unavailable");
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

const EDGE_THRESHOLD = 0.04; // 4% — minimum fair-vs-implied edge to consider a side "live"

async function findUnifiedMatch(supabase: any, playerName: string, unifiedPropType: string, line: number, today: string) {
  // Strategy 1: depunct exact match — the strongest signal (handles "CJ McCollum" vs "C.J. McCollum")
  const target = depunct(playerName);
  const { data: candidates } = await supabase
    .from("unified_props")
    .select("id,player_name,prop_type,current_line,over_price,under_price,event_id,commence_time")
    .eq("prop_type", unifiedPropType)
    .gte("commence_time", today)
    .limit(400);

  if (!candidates || candidates.length === 0) return null;

  const sameLine = (m: any) => Math.abs(Number(m.current_line) - Number(line)) < 0.5;

  // Pass 1 — depunctuated equality
  let pool = candidates.filter((m: any) => depunct(m.player_name) === target);
  if (pool.length > 0) return pool.find(sameLine) ?? pool[0];

  // Pass 2 — last-name + first-initial
  const key = lastNameInitialKey(playerName);
  if (key) {
    pool = candidates.filter((m: any) => lastNameInitialKey(m.player_name) === key);
    if (pool.length > 0) return pool.find(sameLine) ?? pool[0];
  }

  // Pass 3 — last name only (handles missing first initial)
  const tokens = target.split(" ").filter(Boolean);
  if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    pool = candidates.filter((m: any) => {
      const t = depunct(m.player_name).split(" ").filter(Boolean);
      return t.length > 0 && t[t.length - 1] === last;
    });
    if (pool.length === 1) return pool[0]; // only safe if unambiguous
  }

  return null;
}

async function crossReference(supabase: any, prop: any, sport: string) {
  const propType = normalizePropType(prop.prop_type);
  const line = Number(prop.line);

  // Hard drop: prop types that simply do not exist as a real market
  if (UNSUPPORTED_PROP_TYPES.has(propType)) {
    return {
      matched_unified_prop_id: null,
      market_price_delta: null,
      market_over_price: null,
      market_under_price: null,
      l10_hit_rate: null,
      l10_avg: null,
      sweet_spot_id: null,
      dna_score: 0,
      composite_score: 0,
      correlation_tags: [],
      blocked: true,
      block_reason: "unsupported_market",
      recommended_side: null,
      edge_pct: null,
      fair_prob: null,
      implied_prob: null,
      verdict: "Unsupported market",
    };
  }

  const unifiedPropType = UNIFIED_PROP_MAP[propType] ?? propType;
  const today = new Date().toISOString().slice(0, 10);
  const matched = await findUnifiedMatch(supabase, prop.player_name, unifiedPropType, line, today);

  // L10 lookup (used for both sides)
  let l10Vals: number[] = [];
  let l10Avg: number | null = null;
  const logsTable =
    sport === "nba" ? "nba_player_game_logs"
    : sport === "mlb" ? "mlb_player_game_logs"
    : null;

  if (logsTable) {
    const { data: logsExact } = await supabase
      .from(logsTable)
      .select("*")
      .eq("player_name", matched?.player_name ?? prop.player_name)
      .order("game_date", { ascending: false })
      .limit(10);
    let logs = logsExact ?? [];
    if (logs.length === 0) {
      const { data: logsFuzzy } = await supabase
        .from(logsTable)
        .select("*")
        .ilike("player_name", `%${prop.player_name}%`)
        .order("game_date", { ascending: false })
        .limit(10);
      logs = logsFuzzy ?? [];
    }
    if (logs.length > 0) {
      const statKey = mapStatKey(propType, logsTable);
      if (statKey) {
        l10Vals = logs.map((l: any) => Number(l[statKey])).filter((v: number) => !Number.isNaN(v));
        if (l10Vals.length > 0) l10Avg = l10Vals.reduce((a, b) => a + b, 0) / l10Vals.length;
      }
    }
  }

  const overHits = l10Vals.filter((v) => v > line).length;
  const underHits = l10Vals.filter((v) => v < line).length;
  const fairOver = l10Vals.length > 0 ? overHits / l10Vals.length : null;
  const fairUnder = l10Vals.length > 0 ? underHits / l10Vals.length : null;

  // Sweet spot lookup
  let sweetSpotId: string | null = null;
  const { data: sweet } = await supabase
    .from("category_sweet_spots")
    .select("id")
    .ilike("player_name", `%${prop.player_name}%`)
    .eq("category", propType)
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .limit(1)
    .maybeSingle();
  sweetSpotId = sweet?.id ?? null;

  // No matched market → cannot compute edge → block
  if (!matched) {
    return {
      matched_unified_prop_id: null,
      market_price_delta: null,
      market_over_price: null,
      market_under_price: null,
      l10_hit_rate: null,
      l10_avg: l10Avg,
      sweet_spot_id: sweetSpotId,
      dna_score: 30,
      composite_score: 0,
      correlation_tags: [],
      blocked: true,
      block_reason: "no_market_data",
      recommended_side: null,
      edge_pct: null,
      fair_prob: null,
      implied_prob: null,
      verdict: `No live market for ${prop.player_name} ${propType} ${line}`,
    };
  }

  const impliedOver = americanToImpliedProb(matched.over_price);
  const impliedUnder = americanToImpliedProb(matched.under_price);

  // Compute edge for each side; pick the bigger one
  const overEdge = fairOver != null && impliedOver != null ? fairOver - impliedOver : null;
  const underEdge = fairUnder != null && impliedUnder != null ? fairUnder - impliedUnder : null;

  let recommendedSide: "over" | "under" | null = null;
  let edge: number | null = null;
  let fairProb: number | null = null;
  let impliedProb: number | null = null;

  if (overEdge != null || underEdge != null) {
    if ((overEdge ?? -1) >= (underEdge ?? -1)) {
      recommendedSide = "over"; edge = overEdge; fairProb = fairOver; impliedProb = impliedOver;
    } else {
      recommendedSide = "under"; edge = underEdge; fairProb = fairUnder; impliedProb = impliedUnder;
    }
  }

  let blocked = false;
  let blockReason: string | null = null;
  let verdict = "";

  if (l10Vals.length === 0) {
    blocked = true; blockReason = "low_l10_sample";
    verdict = `No L10 sample for ${prop.player_name}`;
  } else if (edge == null || edge < EDGE_THRESHOLD) {
    blocked = true; blockReason = "no_edge";
    const o = overEdge != null ? `O ${(overEdge * 100).toFixed(0)}%` : "O n/a";
    const u = underEdge != null ? `U ${(underEdge * 100).toFixed(0)}%` : "U n/a";
    verdict = `No edge — ${o} · ${u}`;
  } else {
    const sideHits = recommendedSide === "over" ? overHits : underHits;
    const marketPx = recommendedSide === "over" ? matched.over_price : matched.under_price;
    const pxStr = marketPx != null ? `${marketPx > 0 ? "+" : ""}${marketPx}` : "n/a";
    verdict = `${recommendedSide!.toUpperCase()} ${line} — L10 ${sideHits}/${l10Vals.length} · market ${pxStr} · fair ${(fairProb! * 100).toFixed(0)}% · edge +${(edge * 100).toFixed(0)}%`;
  }

  // composite_score = edge weighted heavily, plus bonuses
  const edgeBoost = edge != null ? Math.max(0, edge) * 200 : 0; // edge of 10% → 20
  const composite = Math.round(
    edgeBoost
      + (sweetSpotId ? 15 : 0)
      + (l10Vals.length >= 8 ? 10 : 0)
      + (fairProb != null && fairProb >= 0.7 ? 10 : 0)
      + 30 // base
  );

  const dna = computeDna({
    l10Hit: fairProb,
    marketPriceDelta: null,
    hasMatch: true,
    sweetSpotId,
  });

  const correlationTags: string[] = [];
  if (matched.event_id) correlationTags.push(`game:${matched.event_id}`);
  if (sweetSpotId) correlationTags.push("sweet_spot");
  if (fairProb != null && fairProb >= 0.7) correlationTags.push("hot_l10");

  return {
    matched_unified_prop_id: matched.id,
    market_over_price: matched.over_price ?? null,
    market_under_price: matched.under_price ?? null,
    market_price_delta: null,
    l10_hit_rate: fairProb,
    l10_avg: l10Avg,
    sweet_spot_id: sweetSpotId,
    dna_score: dna,
    composite_score: composite,
    correlation_tags: correlationTags,
    blocked,
    block_reason: blockReason,
    recommended_side: recommendedSide,
    edge_pct: edge != null ? Number((edge * 100).toFixed(2)) : null,
    fair_prob: fairProb,
    implied_prob: impliedProb,
    verdict,
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
    const error = msg === "openai_credits_exhausted" ? "ai_credits_exhausted" : msg;
    const status = error === "rate_limited" ? 429 : error === "ai_credits_exhausted" ? 402 : 500;
    const message =
      error === "rate_limited"
        ? "Scanner is busy right now. Please try the screenshot again in a minute."
        : error === "ai_credits_exhausted"
          ? "Scanner AI balance is exhausted right now. Add more AI balance to resume screenshot scanning."
          : error === "ocr_provider_not_configured"
            ? "Scanner OCR is not configured."
            : "Scanner failed to analyze the screenshot.";
    return new Response(JSON.stringify({ ok: false, error, message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
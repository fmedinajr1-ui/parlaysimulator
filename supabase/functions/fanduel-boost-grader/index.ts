// @ts-nocheck
// FanDuel Boost Grader
// For each fresh boost in fanduel_boosts that has no fade row yet,
// flips every leg, looks up the real market in unified_props, computes
// fair probability from L10 logs, and stores a fade ticket in
// fanduel_boost_fades.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EDGE_THRESHOLD = 0.04; // 4% fade edge per leg
const MIN_FADE_LEGS = 2;

// ---------- shared helpers (inlined from ocr-prop-scan) ----------
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function depunct(name: string): string {
  return stripDiacritics(String(name ?? ""))
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function nameTokens(name: string): string[] {
  return depunct(name).split(" ").filter((t) => t && !NAME_SUFFIXES.has(t));
}
function canonicalName(name: string): string {
  return nameTokens(name).join(" ");
}
function lastNameInitialKey(name: string): string | null {
  const tokens = nameTokens(name);
  if (tokens.length < 2) return null;
  return `${tokens[0][0]}|${tokens[tokens.length - 1]}`;
}
function lastNameOnly(name: string): string | null {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return null;
  return tokens[tokens.length - 1];
}
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
function americanToImpliedProb(odds: number | null | undefined): number | null {
  if (odds == null || Number.isNaN(odds)) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}
function impliedToAmerican(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}
function combineAmericanOdds(legs: number[]): number {
  if (legs.length === 0) return 0;
  const decimal = legs.reduce((acc, am) => {
    const dec = am > 0 ? am / 100 + 1 : 100 / Math.abs(am) + 1;
    return acc * dec;
  }, 1);
  // back to American
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

// Normalize raw market strings into a canonical key, then map to unified_props prop_type.
function normalizeMarketKey(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(made|3pt|3 pt|3 pointers|3pointers|three pointers|threes made)\b/g, "threes")
    .replace(/\bpts\b/g, "points")
    .replace(/\breb\b/g, "rebounds")
    .replace(/\bast\b/g, "assists")
    .replace(/\bstl\b/g, "steals")
    .replace(/\bblk\b/g, "blocks")
    .replace(/\bso\b/g, "strikeouts")
    .replace(/\bks\b/g, "strikeouts")
    .replace(/\btb\b/g, "total bases")
    .replace(/\bsog\b/g, "shots on goal")
    .replace(/\s+/g, " ")
    .trim();
}

const MARKET_MAP: Record<string, string> = {
  // NBA singles
  "player points": "player_points",
  "points": "player_points",
  "player rebounds": "player_rebounds",
  "rebounds": "player_rebounds",
  "player assists": "player_assists",
  "assists": "player_assists",
  "player threes": "player_threes",
  "threes": "player_threes",
  "player steals": "player_steals",
  "steals": "player_steals",
  "player blocks": "player_blocks",
  "blocks": "player_blocks",
  // NBA combos
  "player pra": "player_points_rebounds_assists",
  "pra": "player_points_rebounds_assists",
  "points rebounds and assists": "player_points_rebounds_assists",
  "player points rebounds and assists": "player_points_rebounds_assists",
  "player points rebounds assists": "player_points_rebounds_assists",
  "points and rebounds": "player_points_rebounds",
  "player points and rebounds": "player_points_rebounds",
  "player points rebounds": "player_points_rebounds",
  "points and assists": "player_points_assists",
  "player points and assists": "player_points_assists",
  "player points assists": "player_points_assists",
  "rebounds and assists": "player_rebounds_assists",
  "player rebounds and assists": "player_rebounds_assists",
  "player rebounds assists": "player_rebounds_assists",
  // NHL
  "player shots on goal": "player_shots_on_goal",
  "shots on goal": "player_shots_on_goal",
  "player goals": "player_goals",
  "goals": "player_goals",
  // MLB
  "player hits": "batter_hits",
  "hits": "batter_hits",
  "batter hits": "batter_hits",
  "player total bases": "batter_total_bases",
  "total bases": "batter_total_bases",
  "batter total bases": "batter_total_bases",
  "player strikeouts": "pitcher_strikeouts",
  "strikeouts": "pitcher_strikeouts",
  "pitcher strikeouts": "pitcher_strikeouts",
};

function flipSide(side: string | null): "over" | "under" | null {
  if (!side) return null;
  const s = side.toLowerCase();
  if (s === "over" || s === "more" || s === "higher") return "under";
  if (s === "under" || s === "less" || s === "lower") return "over";
  return null;
}

async function findUnifiedMatch(
  supabase: any,
  playerName: string,
  unifiedPropType: string,
  line: number,
  today: string,
) {
  if (!playerName) return null;
  const target = canonicalName(playerName);
  const { data: candidates } = await supabase
    .from("unified_props")
    .select("id,player_name,prop_type,current_line,over_price,under_price,event_id,commence_time")
    .eq("prop_type", unifiedPropType)
    .gte("commence_time", today)
    .limit(800);

  if (!candidates || candidates.length === 0) return null;

  // Tolerant line picking: prefer exact, then within 0.5, then within 1.0,
  // then any (closest by absolute distance).
  const closest = (pool: any[]) => {
    if (pool.length === 0) return null;
    const exact = pool.find((m) => Math.abs(Number(m.current_line) - Number(line)) < 0.01);
    if (exact) return exact;
    const within05 = pool
      .filter((m) => Math.abs(Number(m.current_line) - Number(line)) <= 0.5)
      .sort((a, b) => Math.abs(Number(a.current_line) - line) - Math.abs(Number(b.current_line) - line));
    if (within05.length > 0) return within05[0];
    const within1 = pool
      .filter((m) => Math.abs(Number(m.current_line) - Number(line)) <= 1.0)
      .sort((a, b) => Math.abs(Number(a.current_line) - line) - Math.abs(Number(b.current_line) - line));
    if (within1.length > 0) return within1[0];
    return [...pool].sort(
      (a, b) => Math.abs(Number(a.current_line) - line) - Math.abs(Number(b.current_line) - line),
    )[0];
  };

  // 1. Exact canonical match (suffix/diacritic insensitive).
  let pool = candidates.filter((m: any) => canonicalName(m.player_name) === target);
  if (pool.length > 0) return closest(pool);

  // 2. First-initial + last-name match.
  const key = lastNameInitialKey(playerName);
  if (key) {
    pool = candidates.filter((m: any) => lastNameInitialKey(m.player_name) === key);
    if (pool.length > 0) return closest(pool);
  }

  // 3. Unique last-name match.
  const last = lastNameOnly(playerName);
  if (last) {
    pool = candidates.filter((m: any) => lastNameOnly(m.player_name) === last);
    if (pool.length === 1) return closest(pool);
    if (pool.length > 1) {
      // Tie-break by closeness on full canonical name.
      const ranked = pool
        .map((m: any) => ({ m, d: levenshtein(canonicalName(m.player_name), target) }))
        .sort((a, b) => a.d - b.d);
      if (ranked.length > 0 && ranked[0].d <= 2 && (ranked.length === 1 || ranked[1].d > ranked[0].d)) {
        return closest([ranked[0].m]);
      }
    }
  }

  // 4. Fuzzy fallback: closest canonical name within edit distance ≤ 2.
  const fuzzy = candidates
    .map((m: any) => ({ m, d: levenshtein(canonicalName(m.player_name), target) }))
    .filter((r: any) => r.d <= 2)
    .sort((a: any, b: any) => a.d - b.d);
  if (fuzzy.length > 0) return closest([fuzzy[0].m]);

  return null;
}

function logsTableForSport(sport: string | null): string | null {
  if (sport === "nba") return "nba_player_game_logs";
  if (sport === "mlb") return "mlb_player_game_logs";
  return null;
}

function statKeyForMarket(unifiedPropType: string, table: string): string | null {
  if (table === "nba_player_game_logs") {
    const m: Record<string, string> = {
      player_points: "pts", player_rebounds: "reb", player_assists: "ast",
      player_threes: "fg3m",
      player_points_rebounds_assists: "pra",
      player_points_rebounds: "pr",
      player_points_assists: "pa",
      player_rebounds_assists: "ra",
      player_steals: "stl",
      player_blocks: "blk",
    };
    return m[unifiedPropType] ?? null;
  }
  if (table === "mlb_player_game_logs") {
    const m: Record<string, string> = {
      batter_hits: "hits",
      batter_total_bases: "total_bases",
      pitcher_strikeouts: "strikeouts",
    };
    return m[unifiedPropType] ?? null;
  }
  return null;
}

async function gradeOneLeg(supabase: any, leg: any, boostSport: string | null) {
  const playerName = leg.player_name ?? null;
  const line = leg.line != null ? Number(leg.line) : null;
  const originalSide = (leg.side ?? "").toLowerCase();
  const fadeSide = flipSide(originalSide);
  const sport = (leg.sport ?? boostSport ?? "").toLowerCase() || null;
  const rawMarket = String(leg.market_type ?? "").toLowerCase();
  const unifiedPropType = MARKET_MAP[rawMarket] ?? null;

  const baseLeg = {
    sport,
    player_name: playerName,
    market_type: rawMarket,
    line,
    original_side: originalSide || null,
    fade_side: fadeSide,
    game_description: leg.game_description ?? null,
  };

  if (!playerName || line == null || !fadeSide) {
    return { ...baseLeg, status: "skipped", skip_reason: "non_player_or_unmappable_leg" };
  }
  if (!unifiedPropType) {
    return { ...baseLeg, status: "skipped", skip_reason: "unsupported_market" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const matched = await findUnifiedMatch(supabase, playerName, unifiedPropType, line, today);
  if (!matched) {
    return { ...baseLeg, status: "skipped", skip_reason: "no_market_data" };
  }

  // L10
  const table = logsTableForSport(sport);
  let l10Vals: number[] = [];
  if (table) {
    const { data: logs } = await supabase
      .from(table)
      .select("*")
      .eq("player_name", matched.player_name ?? playerName)
      .order("game_date", { ascending: false })
      .limit(10);
    const statKey = statKeyForMarket(unifiedPropType, table);
    if (logs && logs.length > 0 && statKey) {
      l10Vals = logs.map((l: any) => Number(l[statKey])).filter((v: number) => !Number.isNaN(v));
    }
  }

  if (l10Vals.length < 5) {
    return { ...baseLeg, status: "skipped", skip_reason: "low_l10_sample", l10_sample: l10Vals.length };
  }

  const overHits = l10Vals.filter((v) => v > line).length;
  const underHits = l10Vals.filter((v) => v < line).length;
  const fairOver = overHits / l10Vals.length;
  const fairUnder = underHits / l10Vals.length;
  const fairFade = fadeSide === "over" ? fairOver : fairUnder;

  const fadePrice = fadeSide === "over" ? matched.over_price : matched.under_price;
  const impliedFade = americanToImpliedProb(fadePrice);
  if (impliedFade == null || fadePrice == null) {
    return { ...baseLeg, status: "skipped", skip_reason: "no_fade_price" };
  }

  const edge = fairFade - impliedFade;
  if (edge < EDGE_THRESHOLD) {
    return {
      ...baseLeg,
      status: "skipped",
      skip_reason: "no_fade_edge",
      fade_price: fadePrice,
      fair_prob: fairFade,
      implied_prob: impliedFade,
      edge_pct: edge,
    };
  }

  return {
    ...baseLeg,
    status: "fade",
    fade_price: fadePrice,
    matched_unified_prop_id: matched.id,
    matched_player: matched.player_name,
    matched_line: matched.current_line,
    fair_prob: fairFade,
    implied_prob: impliedFade,
    edge_pct: edge,
    l10_sample: l10Vals.length,
    l10_hits_fade_side: fadeSide === "over" ? overHits : underHits,
  };
}

async function gradeBoost(supabase: any, boost: any) {
  const legs = Array.isArray(boost.legs) ? boost.legs : [];
  const graded = [];
  for (const leg of legs) {
    graded.push(await gradeOneLeg(supabase, leg, boost.sport));
  }

  const fadeLegs = graded.filter((g) => g.status === "fade");
  const skippedLegs = graded.filter((g) => g.status === "skipped");

  let combinedAmericanOdds: number | null = null;
  let combinedFadeEdgePct: number | null = null;
  let verdict: "fade" | "skip" = "skip";

  if (fadeLegs.length >= MIN_FADE_LEGS) {
    combinedAmericanOdds = combineAmericanOdds(fadeLegs.map((l) => Number(l.fade_price)));
    // combined fair prob (independence assumption — the same approximation the rest of the engine uses)
    const combinedFair = fadeLegs.reduce((acc, l) => acc * Number(l.fair_prob), 1);
    const combinedImplied = fadeLegs.reduce((acc, l) => acc * Number(l.implied_prob), 1);
    combinedFadeEdgePct = combinedFair - combinedImplied;
    verdict = "fade";
  }

  return {
    fade_legs: fadeLegs,
    skipped_legs: skippedLegs,
    combined_american_odds: combinedAmericanOdds,
    combined_fade_edge_pct: combinedFadeEdgePct,
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

    // Pull recent boosts that don't yet have a fade row
    const { data: ungraded, error } = await supabase
      .from("fanduel_boosts")
      .select("id, title, sport, legs, boosted_odds, original_odds, category, pays_text")
      .gte("scraped_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order("scraped_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const boostIds = (ungraded ?? []).map((b: any) => b.id);
    let alreadyGraded: Set<string> = new Set();
    if (boostIds.length > 0) {
      const { data: existing } = await supabase
        .from("fanduel_boost_fades")
        .select("boost_id")
        .in("boost_id", boostIds);
      alreadyGraded = new Set((existing ?? []).map((r: any) => r.boost_id));
    }

    const todo = (ungraded ?? []).filter((b: any) => !alreadyGraded.has(b.id));

    let graded = 0;
    let fadeCount = 0;
    let skipCount = 0;
    const errors: string[] = [];

    for (const boost of todo) {
      try {
        const result = await gradeBoost(supabase, boost);
        const { error: insertError } = await supabase.from("fanduel_boost_fades").insert({
          boost_id: boost.id,
          fade_legs: result.fade_legs,
          skipped_legs: result.skipped_legs,
          combined_american_odds: result.combined_american_odds,
          combined_fade_edge_pct: result.combined_fade_edge_pct,
          verdict: result.verdict,
        });
        if (insertError) {
          errors.push(`insert_${boost.id}:${insertError.message}`);
          continue;
        }
        graded++;
        if (result.verdict === "fade") fadeCount++;
        else skipCount++;
      } catch (e) {
        errors.push(`grade_${boost.id}:${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, candidates: todo.length, graded, fade: fadeCount, skip: skipCount, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fanduel-boost-grader error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
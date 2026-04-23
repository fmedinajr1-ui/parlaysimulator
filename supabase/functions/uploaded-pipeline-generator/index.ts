import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

import type { Pick, PickReasoning } from "../_shared/constants.ts";
import { etDateKey } from "../_shared/date-et.ts";
import { americanOddsToImpliedProb, edgePct } from "../_shared/edge-calc.ts";
import { loadDirectPickRows } from "../_shared/direct-pick-sources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  dry_run: z.boolean().optional().default(false),
  sport: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(12),
}).default({});

type UnifiedPropRow = {
  event_id: string | null;
  sport: string | null;
  game_description: string | null;
  commence_time: string | null;
  player_name: string | null;
  prop_type: string | null;
  current_line: number | null;
  bookmaker: string | null;
  is_active: boolean | null;
  odds_updated_at: string | null;
  updated_at: string | null;
  over_price: number | null;
  under_price: number | null;
};

type PropCandidateRow = {
  player_id: string | null;
  player_name: string | null;
  team: string | null;
  opponent: string | null;
  sport: string | null;
  prop_type: string | null;
  line: number | null;
  american_odds_over: number | null;
  american_odds_under: number | null;
  l3_avg: number | null;
  l5_avg: number | null;
  l10_avg: number | null;
  l10_hit_rate_over: number | null;
  l10_hit_rate_under: number | null;
  h2h_avg: number | null;
  h2h_games: number | null;
  opponent_rank_vs_prop: number | null;
  opponent_defensive_rating: number | null;
  game_id: string | null;
  game_start_utc: string | null;
};

type ManualTrainingRule = {
  rule_key: string;
  is_active: boolean | null;
  rule_logic: {
    type?: string;
    event_id?: string;
    guidance_text?: string;
    selected_props?: Array<{
      player_name?: string;
      prop_type?: string;
      current_line?: number | null;
    }>;
  } | null;
};

type MarketOffer = {
  sportsbook: string;
  americanOdds: number;
  impliedProbability: number;
};

type SideCandidate = {
  eventId: string;
  sport: string;
  gameDescription: string;
  commenceTime: string;
  playerName: string;
  propType: string;
  line: number;
  side: "over" | "under";
  offers: MarketOffer[];
  bestOffer: MarketOffer;
  consensusProbability: number;
  consensusBookCount: number;
  latestUpdateAt: string | null;
};

type ManualOverrideMatch = {
  guidanceText: string;
  preferredDirection: "over" | "under" | null;
};

function normalizeKeyPart(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "na";
  return String(value).trim().toLowerCase();
}

function americanToDecimal(odds: number) {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function removeVig(impliedProbs: number[]) {
  const total = impliedProbs.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return impliedProbs;
  return impliedProbs.map((value) => value / total);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function parseTeams(gameDescription: string) {
  const parts = gameDescription.split(" @ ");
  if (parts.length === 2) {
    return { away: parts[0].trim(), home: parts[1].trim() };
  }
  return { away: gameDescription, home: "Unknown" };
}

function formatPropType(propType: string) {
  return propType
    .replace(/^player_/i, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function consensusProbability(
  sideOffers: MarketOffer[],
  pairedOffers: MarketOffer[],
) {
  if (!sideOffers.length) return 0;

  const pairedByBook = new Map(
    pairedOffers.map((offer) => [offer.sportsbook.toLowerCase(), offer]),
  );

  const devigged = sideOffers
    .map((offer) => {
      const paired = pairedByBook.get(offer.sportsbook.toLowerCase());
      if (!paired) return null;
      return removeVig([
        offer.impliedProbability,
        paired.impliedProbability,
      ])[0];
    })
    .filter((value): value is number => value !== null);

  if (devigged.length > 0) {
    return median(devigged);
  }

  return median(sideOffers.map((offer) => offer.impliedProbability));
}

function extractPreferredDirection(
  guidanceText: string,
): "over" | "under" | null {
  const explicit = guidanceText.match(
    /preferred direction\s*:\s*(over|under)/i,
  );
  if (explicit) return explicit[1].toLowerCase() as "over" | "under";

  const loose = guidanceText.match(/\b(lean|prefer|play)\s+(over|under)\b/i);
  if (loose) return loose[2].toLowerCase() as "over" | "under";

  return null;
}

function shortenGuidance(text: string, max = 140) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildOffer(
  odds: number | null,
  sportsbook: string | null,
): MarketOffer | null {
  if (odds === null || odds === undefined || !Number.isFinite(odds)) {
    return null;
  }
  return {
    sportsbook: sportsbook || "unknown",
    americanOdds: odds,
    impliedProbability: americanOddsToImpliedProb(odds),
  };
}

function chooseBestOffer(offers: MarketOffer[]) {
  return [...offers].sort((a, b) =>
    americanToDecimal(b.americanOdds) - americanToDecimal(a.americanOdds)
  )[0] ?? null;
}

function buildManualRuleMap(rules: ManualTrainingRule[]) {
  const map = new Map<string, ManualOverrideMatch>();

  for (const rule of rules) {
    const logic = rule.rule_logic;
    if (
      !logic || logic.type !== "manual_training_guidance" || !logic.event_id ||
      !logic.guidance_text
    ) continue;

    const preferredDirection = extractPreferredDirection(logic.guidance_text);

    for (const selectedProp of logic.selected_props || []) {
      const key = [
        normalizeKeyPart(logic.event_id),
        normalizeKeyPart(selectedProp.player_name),
        normalizeKeyPart(selectedProp.prop_type),
        normalizeKeyPart(selectedProp.current_line),
      ].join("::");

      map.set(key, {
        guidanceText: logic.guidance_text,
        preferredDirection,
      });
    }
  }

  return map;
}

function findClosestCandidate(
  candidateRows: PropCandidateRow[],
  market: SideCandidate,
) {
  const matches = candidateRows.filter(
    (row) =>
      normalizeKeyPart(row.player_name) ===
        normalizeKeyPart(market.playerName) &&
      normalizeKeyPart(row.prop_type) === normalizeKeyPart(market.propType),
  );

  if (matches.length === 0) return null;

  return matches.sort((a, b) => {
    const aDiff = Math.abs((a.line ?? market.line) - market.line);
    const bDiff = Math.abs((b.line ?? market.line) - market.line);
    return aDiff - bDiff;
  })[0];
}

function buildHistoricalAdjustment(
  market: SideCandidate,
  historical: PropCandidateRow | null,
  manualOverride: ManualOverrideMatch | null,
) {
  const sideHitRateRaw = market.side === "over"
    ? historical?.l10_hit_rate_over ?? null
    : historical?.l10_hit_rate_under ?? null;
  const sideHitRate = sideHitRateRaw !== null && sideHitRateRaw !== undefined
    ? sideHitRateRaw / 100
    : null;

  const l3 = historical?.l3_avg ?? null;
  const l10 = historical?.l10_avg ?? null;
  const h2hAvg = historical?.h2h_avg ?? null;
  const h2hGames = historical?.h2h_games ?? 0;

  let adjustedProbability = market.consensusProbability;
  const drivers: string[] = [];
  const sources = ["market_consensus"];

  if (sideHitRate !== null) {
    adjustedProbability = adjustedProbability * 0.65 + sideHitRate * 0.35;
    drivers.push(
      `L10 ${market.side} hit rate: ${(sideHitRate * 100).toFixed(0)}%`,
    );
    sources.push("l10_form");
  }

  if (l3 !== null && l10 !== null && l10 > 0) {
    const trendRatio = l3 / l10;
    const trendSupportsSide = market.side === "over"
      ? trendRatio > 1.05
      : trendRatio < 0.95;
    if (trendSupportsSide) {
      adjustedProbability += 0.015;
    } else {
      adjustedProbability -= 0.01;
    }
    drivers.push(
      `${historical?.player_name || market.playerName} L3 ${
        l3.toFixed(1)
      } vs L10 ${l10.toFixed(1)}`,
    );
    sources.push("l3_vs_l10");
  }

  if (h2hAvg !== null && h2hGames >= 2) {
    const h2hSupportsSide = market.side === "over"
      ? h2hAvg > market.line
      : h2hAvg < market.line;
    adjustedProbability += h2hSupportsSide ? 0.015 : -0.015;
    drivers.push(
      `H2H avg ${h2hAvg.toFixed(1)} across ${h2hGames} matchup${
        h2hGames === 1 ? "" : "s"
      }`,
    );
    sources.push("h2h_history");
  }

  if (manualOverride) {
    if (
      manualOverride.preferredDirection &&
      manualOverride.preferredDirection !== market.side
    ) {
      return null;
    }

    adjustedProbability += manualOverride.preferredDirection === market.side
      ? 0.03
      : 0;
    drivers.push(
      `Manual guidance: ${shortenGuidance(manualOverride.guidanceText, 120)}`,
    );
    sources.push("manual_training_guidance");
  }

  adjustedProbability = clamp(adjustedProbability, 0.05, 0.92);

  return {
    adjustedProbability,
    drivers: drivers.slice(0, 3),
    sources,
    sideHitRateRaw,
    l3,
    l10,
    h2hAvg,
    h2hGames,
  };
}

function buildRiskNote(
  market: SideCandidate,
  historical: PropCandidateRow | null,
  manualOverride: ManualOverrideMatch | null,
) {
  if (manualOverride && manualOverride.preferredDirection === market.side) {
    return "Manual training guidance supports this side, but it still depends on the live book holding this number and the matchup playing cleanly.";
  }

  if ((historical?.h2h_games ?? 0) < 2) {
    return "Historical matchup sample is thin here, so the edge leans more on market pricing than deep opponent-specific evidence.";
  }

  return "If the market has already corrected or the player's role shifts before tip, this price edge can disappear fast.";
}

function buildPicks(
  markets: SideCandidate[],
  historicalRows: PropCandidateRow[],
  manualRuleMap: Map<string, ManualOverrideMatch>,
  limit: number,
) {
  const picks: Pick[] = [];

  for (const market of markets) {
    const manualKey = [
      normalizeKeyPart(market.eventId),
      normalizeKeyPart(market.playerName),
      normalizeKeyPart(market.propType),
      normalizeKeyPart(market.line),
    ].join("::");
    const manualOverride = manualRuleMap.get(manualKey) ?? null;
    const historical = findClosestCandidate(historicalRows, market);
    const adjustment = buildHistoricalAdjustment(
      market,
      historical,
      manualOverride,
    );

    if (!adjustment) continue;

    const edge = edgePct(
      adjustment.adjustedProbability,
      market.bestOffer.americanOdds,
    );
    if (edge < 3) continue;

    const { away, home } = parseTeams(market.gameDescription);
    const confidence = Math.round(
      clamp(
        adjustment.adjustedProbability * 100 + edge * 0.9 +
          (manualOverride ? 2 : 0),
        54,
        91,
      ),
    );

    const reasoning: PickReasoning = {
      headline: `${market.playerName} ${
        formatPropType(market.propType)
      } ${market.side} has a price gap versus the rest of the market${
        manualOverride ? " and lines up with manual guidance" : ""
      }.`,
      drivers: [
        `Best price ${market.side} ${
          market.bestOffer.americanOdds > 0 ? "+" : ""
        }${market.bestOffer.americanOdds} at ${market.bestOffer.sportsbook} vs ${market.consensusBookCount}-book consensus ${
          (market.consensusProbability * 100).toFixed(1)
        }%`,
        ...adjustment.drivers,
      ].slice(0, 3),
      risk_note: buildRiskNote(market, historical, manualOverride),
      matchup: `${market.playerName} — ${away} @ ${home}`,
      sources: adjustment.sources,
    };

    picks.push({
      id: [
        "uploaded-pipeline-v1",
        market.eventId,
        normalizeKeyPart(market.playerName),
        normalizeKeyPart(market.propType),
        String(market.line),
        market.side,
      ].join(":"),
      sport: market.sport,
      player_name: market.playerName,
      team: historical?.team ?? away,
      opponent: historical?.opponent ?? home,
      prop_type: market.propType,
      line: market.line,
      side: market.side,
      american_odds: market.bestOffer.americanOdds,
      confidence,
      edge_pct: Number(edge.toFixed(2)),
      tier: confidence >= 80
        ? "elite"
        : confidence >= 70
        ? "high"
        : confidence >= 60
        ? "medium"
        : "exploration",
      reasoning,
      recency: {
        l3_avg: adjustment.l3 ?? undefined,
        l5_avg: historical?.l5_avg ?? undefined,
        l10_avg: adjustment.l10 ?? undefined,
        l10_hit_rate: adjustment.sideHitRateRaw ?? undefined,
        h2h_avg: adjustment.h2hAvg ?? undefined,
        h2h_games: adjustment.h2hGames ?? undefined,
      },
      generated_at: new Date().toISOString(),
      generator: "uploaded-pipeline-v1",
      game_start_utc: historical?.game_start_utc ?? market.commenceTime,
      parlay_id: undefined,
    });
  }

  return picks
    .sort((a, b) =>
      (b.edge_pct ?? 0) - (a.edge_pct ?? 0) || b.confidence - a.confidence
    )
    .slice(0, limit);
}

async function loadMarketRows(
  sb: ReturnType<typeof createClient>,
  sport?: string,
) {
  const now = new Date();
  const end = new Date(now.getTime() + 36 * 60 * 60 * 1000);

  const collected: UnifiedPropRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < 5000; offset += pageSize) {
    let query = sb
      .from("unified_props")
      .select(
        "event_id, sport, game_description, commence_time, player_name, prop_type, current_line, bookmaker, is_active, odds_updated_at, updated_at, over_price, under_price",
      )
      .gte(
        "commence_time",
        new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      )
      .lt("commence_time", end.toISOString())
      .not("player_name", "is", null)
      .not("prop_type", "is", null)
      .not("current_line", "is", null)
      .range(offset, offset + pageSize - 1);

    if (sport) {
      query = query.eq("sport", sport);
    }

    const { data, error } = await query;
    if (error) throw error;

    const page = (data ?? []) as UnifiedPropRow[];
    collected.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return collected;
}

async function loadHistoricalRows(
  sb: ReturnType<typeof createClient>,
  sport?: string,
) {
  let query = sb
    .from("prop_candidates")
    .select(
      "player_id, player_name, team, opponent, sport, prop_type, line, american_odds_over, american_odds_under, l3_avg, l5_avg, l10_avg, l10_hit_rate_over, l10_hit_rate_under, h2h_avg, h2h_games, opponent_rank_vs_prop, opponent_defensive_rating, game_id, game_start_utc",
    )
    .eq("date", etDateKey());

  if (sport) {
    query = query.eq("sport", sport);
  }

  const { data, error } = await query;
  if (error) {
    console.warn(
      "[uploaded-pipeline-generator] prop_candidates load failed",
      error.message,
    );
    return [] as PropCandidateRow[];
  }

  return (data ?? []) as PropCandidateRow[];
}

async function loadManualTrainingRules(sb: ReturnType<typeof createClient>) {
  const { data, error } = await sb
    .from("bot_owner_rules")
    .select("rule_key, is_active, rule_logic")
    .eq("is_active", true)
    .eq("enforcement", "manual_override");

  if (error) {
    console.warn(
      "[uploaded-pipeline-generator] manual rule load failed",
      error.message,
    );
    return [] as ManualTrainingRule[];
  }

  return (data ?? []) as ManualTrainingRule[];
}

function buildMarkets(rows: UnifiedPropRow[]) {
  const grouped = new Map<string, UnifiedPropRow[]>();

  for (const row of rows) {
    if (row.is_active === false) continue;
    if (
      !row.player_name || !row.prop_type || row.current_line === null ||
      !row.commence_time || !row.game_description || !row.sport
    ) continue;

    const key = [
      normalizeKeyPart(row.event_id || `${row.sport}:${row.game_description}`),
      normalizeKeyPart(row.player_name),
      normalizeKeyPart(row.prop_type),
      normalizeKeyPart(row.current_line),
    ].join("::");

    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  const markets: SideCandidate[] = [];

  for (const rowsForMarket of grouped.values()) {
    const first = rowsForMarket[0];
    const overOffers = rowsForMarket
      .map((row) => buildOffer(row.over_price, row.bookmaker))
      .filter((offer): offer is MarketOffer => Boolean(offer));
    const underOffers = rowsForMarket
      .map((row) => buildOffer(row.under_price, row.bookmaker))
      .filter((offer): offer is MarketOffer => Boolean(offer));

    const overBest = chooseBestOffer(overOffers);
    const underBest = chooseBestOffer(underOffers);

    const latestUpdateAt = rowsForMarket
      .map((row) => row.odds_updated_at || row.updated_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

    if (overBest && overOffers.length >= 3) {
      markets.push({
        eventId: first.event_id || `${first.sport}:${first.game_description}`,
        sport: first.sport,
        gameDescription: first.game_description,
        commenceTime: first.commence_time,
        playerName: first.player_name!,
        propType: first.prop_type!,
        line: first.current_line!,
        side: "over",
        offers: overOffers,
        bestOffer: overBest,
        consensusProbability: consensusProbability(overOffers, underOffers),
        consensusBookCount: overOffers.length,
        latestUpdateAt,
      });
    }

    if (underBest && underOffers.length >= 3) {
      markets.push({
        eventId: first.event_id || `${first.sport}:${first.game_description}`,
        sport: first.sport,
        gameDescription: first.game_description,
        commenceTime: first.commence_time,
        playerName: first.player_name!,
        propType: first.prop_type!,
        line: first.current_line!,
        side: "under",
        offers: underOffers,
        bestOffer: underBest,
        consensusProbability: consensusProbability(underOffers, overOffers),
        consensusBookCount: underOffers.length,
        latestUpdateAt,
      });
    }
  }

  return markets;
}

async function savePicks(sb: ReturnType<typeof createClient>, picks: Pick[]) {
  if (picks.length === 0) return 0;

  const rows = picks.map((pick) => ({
    id: pick.id,
    pick_date: etDateKey(),
    player_name: pick.player_name,
    team: pick.team,
    opponent: pick.opponent,
    sport: pick.sport,
    prop_type: pick.prop_type,
    line: pick.line,
    side: pick.side,
    american_odds: pick.american_odds,
    confidence: pick.confidence,
    edge_pct: pick.edge_pct,
    tier: pick.tier,
    reasoning: pick.reasoning,
    recency: pick.recency,
    generator: pick.generator,
    game_id: pick.id.split(":")[1] ?? null,
    game_start_utc: pick.game_start_utc,
    status: "locked",
    generated_at: pick.generated_at,
  }));

  const { error } = await sb.from("bot_daily_picks").upsert(rows, {
    onConflict: "id",
  });
  if (error) throw error;
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const parsed = BodySchema.safeParse(
      req.method === "POST" ? await req.json().catch(() => ({})) : {},
    );
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { dry_run, sport, limit } = parsed.data;
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [marketRows, historicalRows, manualRules, directSourceState] = await Promise.all([
      loadMarketRows(sb, sport),
      loadHistoricalRows(sb, sport),
      loadManualTrainingRules(sb),
      loadDirectPickRows(sb, { targetDate: etDateKey(), minimumRiskRows: 8, fallbackLimit: 40 }),
    ]);

    const markets = buildMarkets(marketRows);
    const manualRuleMap = buildManualRuleMap(manualRules);
    const picks = buildPicks(markets, historicalRows, manualRuleMap, limit);
    const saved = dry_run ? 0 : await savePicks(sb, picks);

    const sourceMix = (directSourceState.rows ?? []).reduce<Record<string, number>>(
      (acc, r: any) => {
        const k = (r.source_origin ?? "unknown").toString();
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      },
      {},
    );

    return new Response(
      JSON.stringify({
        success: true,
        generator: "uploaded-pipeline-v1",
        dry_run,
        inputs: {
          market_rows: marketRows.length,
          market_candidates: markets.length,
          historical_rows: historicalRows.length,
          manual_rules: manualRules.length,
          manual_rule_matches: manualRuleMap.size,
          direct_source_rows: directSourceState.rows.length,
          direct_source_mix: sourceMix,
        },
        source_diagnostics: directSourceState.diagnostics,
        generated: picks.length,
        saved,
        picks: picks.slice(0, 5).map((pick) => ({
          id: pick.id,
          player_name: pick.player_name,
          prop_type: pick.prop_type,
          line: pick.line,
          side: pick.side,
          edge_pct: pick.edge_pct,
          confidence: pick.confidence,
        })),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

// Soccer Sharp Market Engine — ingest + comparison + alert evaluator.
// Pulls Pinnacle (sharp) + US books from The Odds API for target leagues,
// power-devigs Pinnacle, computes per-book edges, updates line movement,
// and fires alerts (LEAN/STRONG/HAMMER + STEAM).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  americanToImplied,
  classifyEdge,
  edgePct,
  expectedValue,
  impliedToAmerican,
  powerDevig,
} from "../_shared/soccer-devig.ts";
import { soccerChessScore } from "../_shared/soccer-chess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The Odds API soccer sport keys for the requested leagues.
const SPORT_KEYS = [
  // The Odds API splits WC qualifiers by confederation – the umbrella key 404s.
  "soccer_fifa_world_cup_qualifiers_europe",
  "soccer_fifa_world_cup_qualifiers_south_america",
  "soccer_fifa_world_cup_qualifiers_concacaf",
  "soccer_fifa_world_cup_qualifiers_africa",
  "soccer_fifa_world_cup_qualifiers_asia",
  "soccer_usa_mls",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_uefa_champs_league",
  "soccer_conmebol_copa_libertadores",
];

// Map The Odds API bookmaker keys → our internal slugs.
const BOOK_MAP: Record<string, string> = {
  pinnacle: "pinnacle",
  circasports: "circa",
  betonlineag: "betonline",
  draftkings: "draftkings",
  fanduel: "fanduel",
  betmgm: "betmgm",
  hardrockbet: "hardrock",
  williamhill_us: "caesars", // Caesars on Odds API
};
const COMPARE_BOOKS = ["hardrock", "draftkings", "fanduel", "caesars", "betmgm"];
// Sharp anchor priority: Pinnacle first, then Circa, then BetOnline as fallback
// when Pinnacle hasn't posted AH/Totals yet.
const SHARP_BOOK_PRIORITY = [
  { key: "pinnacle", slug: "pinnacle" },
  { key: "circasports", slug: "circa" },
  { key: "betonlineag", slug: "betonline" },
] as const;

type Outcome = { name: string; price: number; point?: number };
type Market = { key: string; outcomes: Outcome[] };
type Bookmaker = { key: string; last_update: string; markets: Market[] };
type Event = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  if (!apiKey) {
    return json({ ok: false, error: "THE_ODDS_API_KEY not configured" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stats = {
    sports: 0,
    events: 0,
    sharpRows: 0,
    fallbackRows: 0,
    comparisons: 0,
    alerts: 0,
    errors: [] as string[],
  };

  for (const sportKey of SPORT_KEYS) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${apiKey}` +
        `&regions=us,us2,eu&markets=h2h,spreads,totals&oddsFormat=american` +
        `&bookmakers=${Object.keys(BOOK_MAP).join(",")}`;
      const res = await fetch(url);
      if (!res.ok) {
        // 404 = league out of season / unsupported key. Treat as non-fatal silent skip.
        if (res.status !== 404) stats.errors.push(`${sportKey}: HTTP ${res.status}`);
        continue;
      }
      const events = (await res.json()) as Event[];
      stats.sports++;
      for (const evt of events) {
        const r = await processEvent(supabase, sportKey, evt);
        stats.events++;
        stats.sharpRows += r.sharpRows;
        stats.fallbackRows += r.fallbackRows;
        stats.comparisons += r.comparisons;
        stats.alerts += r.alerts;
        stats.errors.push(...r.errors);
      }
    } catch (err) {
      stats.errors.push(`${sportKey}: ${(err as Error).message}`);
    }
  }

  return json({ ok: true, stats });
});

async function processEvent(supabase: any, sportKey: string, evt: Event) {
  const result = { sharpRows: 0, fallbackRows: 0, comparisons: 0, alerts: 0, errors: [] as string[] };
  // Pick a sharp anchor PER market type — Pinnacle preferred, then Circa, then BetOnline.
  // This lets us still generate edges when Pinnacle hasn't posted AH/Totals yet.
  const sharpSlugs = new Set<string>(SHARP_BOOK_PRIORITY.map((s) => s.slug));
  const marketKeys = ["h2h", "spreads", "totals"] as const;

  for (const mKey of marketKeys) {
    // Find first sharp book in priority order that offers this market.
    let sharpBook: Bookmaker | undefined;
    let sharpSlug = "pinnacle";
    for (const cand of SHARP_BOOK_PRIORITY) {
      const bm = evt.bookmakers.find((b) => b.key === cand.key);
      if (bm && bm.markets.some((m) => m.key === mKey)) {
        sharpBook = bm;
        sharpSlug = cand.slug;
        break;
      }
    }
    const market = sharpBook?.markets.find((m) => m.key === mKey) ?? buildConsensusSharpMarket(evt, mKey);
    if (!market) continue;
    const usingConsensusFallback = !sharpBook;
    const otherBooks = evt.bookmakers.filter((b) => b !== sharpBook);

    const marketType = mapMarketKey(market.key);
    if (!marketType) continue;

    // Group by playable line. Spreads need home/away paired by opposite points;
    // totals pair Over/Under on the same point; h2h has no line.
    const groups = groupMarketOutcomes(marketType, market.outcomes, evt);
    const anchorSlug = usingConsensusFallback ? "consensus" : sharpSlug;
    for (const [pointKey, outcomes] of Object.entries(groups)) {
      // Need exactly 2 sides to devig (for 3-way h2h we still treat home vs away pair)
      const sides = pickTwoSides(marketType, outcomes, evt);
      if (!sides) continue;
      const { sideA, sideB, lineValue } = sides;
      const { fairA, fairB } = powerDevig(sideA.price, sideB.price);
      if (!Number.isFinite(fairA) || !Number.isFinite(fairB)) continue;

      // Insert sharp line snapshot
      const { data: sharpInsert, error: sharpErr } = await supabase
        .from("soccer_sharp_lines")
        .insert({
          match_id: evt.id,
          league: sportKey,
          home_team: evt.home_team,
          away_team: evt.away_team,
          commence_time: evt.commence_time,
          market_type: marketType,
          line: lineValue,
          side_a_label: sideA.name,
          side_b_label: sideB.name,
          pinnacle_price_a: sideA.price,
          pinnacle_price_b: sideB.price,
          sharp_probability_a: fairA,
          sharp_probability_b: fairB,
          raw: { pointKey, outcomes, sharp_book: usingConsensusFallback ? "consensus" : sharpSlug },
        })
        .select("id")
        .single();
      if (sharpErr) {
        result.errors.push(`${evt.id}:${marketType}:${sharpErr.message}`);
        continue;
      }
      result.sharpRows++;
      if (usingConsensusFallback) result.fallbackRows++;

      // Track sharp anchor line movement
      await updateMovement(supabase, evt.id, anchorSlug, marketType, "a", lineValue, sideA.price);
      await updateMovement(supabase, evt.id, anchorSlug, marketType, "b", lineValue, sideB.price);

      // Compare each US book that has matching market+line
      for (const book of otherBooks) {
        const slug = BOOK_MAP[book.key];
        if (!slug || sharpSlugs.has(slug) || !COMPARE_BOOKS.includes(slug)) continue;
        const bookMarket = book.markets.find((m) => m.key === market.key);
        if (!bookMarket) continue;
          const bookGroups = groupMarketOutcomes(marketType, bookMarket.outcomes, evt);
        const matched = bookGroups[pointKey] ?? null;
        if (!matched) continue;
        const bookSides = pickTwoSides(marketType, matched, evt);
        if (!bookSides) continue;

        for (const sideKey of ["a", "b"] as const) {
          const sharpProb = sideKey === "a" ? fairA : fairB;
          const bookSide = sideKey === "a" ? bookSides.sideA : bookSides.sideB;
          const bookProb = americanToImplied(bookSide.price);
          if (!Number.isFinite(bookProb)) continue;
          const edge = edgePct(sharpProb, bookProb);

          await supabase.from("soccer_book_comparisons").insert({
            sharp_line_id: sharpInsert.id,
            match_id: evt.id,
            sportsbook: slug,
            market_type: marketType,
            line: lineValue,
            side: sideKey,
            sportsbook_price: bookSide.price,
            sportsbook_probability: bookProb,
            sharp_probability: sharpProb,
            edge_percent: edge,
          });
          result.comparisons++;

          await updateMovement(supabase, evt.id, slug, marketType, sideKey, lineValue, bookSide.price);

          // Alert evaluation
          const cls = classifyEdge(edge);
          if (cls === "PASS") continue;

          // CHESS inputs
          const ahMove = marketType === "asian_handicap"
            ? await recentMoveMagnitude(supabase, evt.id, anchorSlug, "asian_handicap")
            : 0;
          const totalMove = marketType === "totals"
            ? await recentMoveMagnitude(supabase, evt.id, anchorSlug, "totals")
            : 0;
          const chess = soccerChessScore({
            edgePct: edge,
            ahLineMove: ahMove,
            totalLineMove: totalMove,
            lineupImpact: 0,
            publicSentiment: 0,
          });

          if (edge > 4 && chess > 70) {
            // STEAM detection: sharp anchor moved within last 15min AND this book hasn't matched line
            const steam = await isSteam(supabase, evt.id, marketType, lineValue, slug, anchorSlug);
            const classification = steam ? "STEAM" : (edge >= 6 && chess >= 80 ? "HAMMER" : cls);
            const recommendedSide = sideKey === "a" ? sideA.name : sideB.name;
            await supabase.from("soccer_sharp_alerts").insert({
              match_id: evt.id,
              home_team: evt.home_team,
              away_team: evt.away_team,
              league: sportKey,
              market: marketType,
              line: lineValue,
              sportsbook: slug,
              recommended_side: recommendedSide,
              sharp_probability: sharpProb,
              sportsbook_probability: bookProb,
              edge_percent: edge,
              chess_score: chess,
              classification,
              expected_value: expectedValue(sharpProb, bookSide.price),
              confidence: chess,
              risk_flags: [
                ...(steam ? ["steam_detected"] : []),
                ...(anchorSlug !== "pinnacle" ? [`sharp_fallback_${anchorSlug}`] : []),
              ],
              status: "open",
            });
            result.alerts++;
          }
        }
      }
    }
  }
  return result;
}

function mapMarketKey(k: string): string | null {
  if (k === "h2h") return "moneyline";
  if (k === "spreads") return "asian_handicap";
  if (k === "totals") return "totals";
  return null;
}

function groupByPoint(outcomes: Outcome[]): Record<string, Outcome[]> {
  const out: Record<string, Outcome[]> = {};
  for (const o of outcomes) {
    const key = o.point != null ? String(o.point) : "_";
    (out[key] ||= []).push(o);
  }
  return out;
}

function groupMarketOutcomes(marketType: string, outcomes: Outcome[], evt: Event): Record<string, Outcome[]> {
  if (marketType !== "asian_handicap") return groupByPoint(outcomes);

  const groups: Record<string, Outcome[]> = {};
  const homeOutcomes = outcomes.filter((o) => o.name === evt.home_team && o.point != null);
  const awayOutcomes = outcomes.filter((o) => o.name === evt.away_team && o.point != null);
  for (const home of homeOutcomes) {
    const away = awayOutcomes.find((o) => Math.abs(Number(o.point) + Number(home.point)) < 0.001);
    if (away) groups[String(home.point)] = [home, away];
  }
  return Object.keys(groups).length ? groups : groupByPoint(outcomes);
}

function buildConsensusSharpMarket(evt: Event, marketKey: "h2h" | "spreads" | "totals"): Market | null {
  const marketType = mapMarketKey(marketKey);
  if (!marketType) return null;

  const buckets = new Map<string, { line: number | null; sideAName: string; sideBName: string; fairA: number[]; fairB: number[] }>();
  for (const book of evt.bookmakers) {
    const slug = BOOK_MAP[book.key];
    if (!slug || !COMPARE_BOOKS.includes(slug)) continue;
    const market = book.markets.find((m) => m.key === marketKey);
    if (!market) continue;

    for (const [pointKey, outcomes] of Object.entries(groupMarketOutcomes(marketType, market.outcomes, evt))) {
      const sides = pickTwoSides(marketType, outcomes, evt);
      if (!sides) continue;
      const { fairA, fairB } = powerDevig(sides.sideA.price, sides.sideB.price);
      if (!Number.isFinite(fairA) || !Number.isFinite(fairB)) continue;
      const bucket = buckets.get(pointKey) ?? {
        line: sides.lineValue,
        sideAName: sides.sideA.name,
        sideBName: sides.sideB.name,
        fairA: [],
        fairB: [],
      };
      bucket.fairA.push(fairA);
      bucket.fairB.push(fairB);
      buckets.set(pointKey, bucket);
    }
  }

  const outcomes: Outcome[] = [];
  for (const b of buckets.values()) {
    if (b.fairA.length < 2) continue;
    const fairA = b.fairA.reduce((a, n) => a + n, 0) / b.fairA.length;
    const fairB = b.fairB.reduce((a, n) => a + n, 0) / b.fairB.length;
    outcomes.push({ name: b.sideAName, price: impliedToAmerican(fairA), point: b.line ?? undefined });
    outcomes.push({
      name: b.sideBName,
      price: impliedToAmerican(fairB),
      point: marketType === "asian_handicap" && b.line != null ? -Number(b.line) : b.line ?? undefined,
    });
  }
  return outcomes.length >= 2 ? { key: marketKey, outcomes } : null;
}

function pickTwoSides(
  marketType: string,
  outcomes: Outcome[],
  evt: Event,
): { sideA: Outcome; sideB: Outcome; lineValue: number | null } | null {
  if (marketType === "moneyline") {
    // Soccer h2h is 3-way (home/draw/away). Devig home vs away only for now.
    const home = outcomes.find((o) => o.name === evt.home_team);
    const away = outcomes.find((o) => o.name === evt.away_team);
    if (!home || !away) return null;
    return { sideA: home, sideB: away, lineValue: null };
  }
  if (marketType === "asian_handicap") {
    // Two outcomes on the same point (one positive sign for home, negative for away or vice versa)
    if (outcomes.length < 2) return null;
    const home = outcomes.find((o) => o.name === evt.home_team);
    const away = outcomes.find((o) => o.name === evt.away_team);
    if (!home || !away) return null;
    return { sideA: home, sideB: away, lineValue: home.point ?? null };
  }
  if (marketType === "totals") {
    const over = outcomes.find((o) => /over/i.test(o.name));
    const under = outcomes.find((o) => /under/i.test(o.name));
    if (!over || !under) return null;
    return { sideA: over, sideB: under, lineValue: over.point ?? null };
  }
  return null;
}

async function updateMovement(
  supabase: any,
  matchId: string,
  book: string,
  marketType: string,
  side: string,
  line: number | null,
  price: number,
) {
  const { data: existing } = await supabase
    .from("soccer_line_movements")
    .select("*")
    .eq("match_id", matchId)
    .eq("sportsbook", book)
    .eq("market_type", marketType)
    .eq("side", side)
    .maybeSingle();

  if (!existing) {
    await supabase.from("soccer_line_movements").insert({
      match_id: matchId,
      sportsbook: book,
      market_type: marketType,
      side,
      opening_line: line,
      opening_price: price,
      current_line: line,
      current_price: price,
    });
    return;
  }
  const moved = existing.current_line !== line || existing.current_price !== price;
  if (!moved) return;
  await supabase
    .from("soccer_line_movements")
    .update({
      previous_line: existing.current_line,
      previous_price: existing.current_price,
      previous_at: existing.current_at,
      current_line: line,
      current_price: price,
      current_at: new Date().toISOString(),
      movement_count: (existing.movement_count ?? 0) + 1,
    })
    .eq("id", existing.id);
}

async function recentMoveMagnitude(supabase: any, matchId: string, book: string, marketType: string): Promise<number> {
  const { data } = await supabase
    .from("soccer_line_movements")
    .select("opening_line,current_line")
    .eq("match_id", matchId)
    .eq("sportsbook", book)
    .eq("market_type", marketType)
    .limit(2);
  if (!data?.length) return 0;
  let max = 0;
  for (const row of data) {
    if (row.opening_line != null && row.current_line != null) {
      max = Math.max(max, Math.abs(Number(row.current_line) - Number(row.opening_line)));
    }
  }
  return max;
}

async function isSteam(
  supabase: any,
  matchId: string,
  marketType: string,
  line: number | null,
  bookSlug: string,
  sharpSlug: string = "pinnacle",
): Promise<boolean> {
  // Sharp anchor moved within last 15 min AND this book's current line != sharp current line
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: pinMove } = await supabase
    .from("soccer_line_movements")
    .select("current_at,current_line")
    .eq("match_id", matchId)
    .eq("sportsbook", sharpSlug)
    .eq("market_type", marketType)
    .gte("current_at", fifteenMinAgo)
    .gt("movement_count", 0)
    .limit(1);
  if (!pinMove?.length) return false;
  const { data: bookMove } = await supabase
    .from("soccer_line_movements")
    .select("current_line")
    .eq("match_id", matchId)
    .eq("sportsbook", bookSlug)
    .eq("market_type", marketType)
    .limit(1);
  const bookLine = bookMove?.[0]?.current_line ?? null;
  return bookLine != null && line != null && Number(bookLine) !== Number(line);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
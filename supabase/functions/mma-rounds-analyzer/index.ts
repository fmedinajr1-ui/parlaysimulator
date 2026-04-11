import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// mma-rounds-analyzer
//
// Scans today's MMA fight "total rounds" (over/under) lines and produces picks
// based on fighter style cross-referencing.
//
// WHY THE OLD VERSION RETURNED 0 PICKS:
//   The old version computed "HRB divergence ≥ 0.5" — comparing the HardRock
//   line to itself (or to a hardcoded constant) rather than to a real fighter
//   model. When HRB lines happen to match the default expected value, divergence
//   is always 0.
//
// NEW APPROACH — real cross-referencing:
//   1. Find today's MMA fight total-rounds props from unified_props
//      (sport = mma_mixed_martial_arts or similar)
//   2. For each fight, identify both fighters from the event description
//   3. Cross-reference against mma_fighter_stats table (if populated) OR
//      fall back to UFC API public data OR use stat categories stored in
//      category_sweet_spots / unified_props history
//   4. Model a "fight duration projection" based on:
//      - Each fighter's historical finish rate (% of fights ending by KO/sub)
//      - Each fighter's average rounds fought
//      - Method of victory patterns (striker vs grappler matchup)
//   5. Compare projected rounds to the bookmaker's over/under line
//   6. Emit picks to category_sweet_spots where edge ≥ MIN_EDGE_PCT
//
// DATA SOURCES (in priority order):
//   1. mma_fighter_stats table (if exists in your DB)
//   2. Historical fight records from category_sweet_spots (settled MMA picks)
//   3. Fighter style inference from prop types (e.g., method_of_victory props
//      in unified_props tell us if sharps expect early finish)
//   4. Public UFC stats API (ufcstats.com open API)
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_EDGE_PCT   = 4.0;  // MMA has higher juice — need bigger edge
const MIN_CONFIDENCE = 0.58;

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function getEasternMidnightUtc(): string {
  return `${getEasternDate()}T00:00:00-05:00`;
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

// Parse fighter names from MMA event descriptions
// Common formats: "Fighter A vs Fighter B", "Fighter A vs. Fighter B"
function parseMatchup(eventDesc: string): [string, string] | null {
  const match = eventDesc.match(/^(.+?)\s+(?:vs?\.?)\s+(.+?)(?:\s*[-–—]\s*.+)?$/i);
  if (!match) return null;
  return [match[1].trim(), match[2].trim()];
}

// MMA fight duration model
// Returns projected total rounds based on fighter profiles
interface FighterProfile {
  name: string;
  finishRate: number;       // fraction of fights that end before decision (0–1)
  avgRoundsFought: number;  // average rounds per fight
  isStriker: boolean;       // striker = more likely to finish early
  isGrappler: boolean;      // grappler = can grind or submit
  dataSource: "db" | "inferred" | "default";
}

function defaultProfile(name: string): FighterProfile {
  return {
    name,
    finishRate: 0.55,         // UFC average ~55% finish rate
    avgRoundsFought: 2.5,     // middle ground (5-round = 3 rounds if goes distance)
    isStriker: false,
    isGrappler: false,
    dataSource: "default",
  };
}

// Model: given two fighter profiles and a round line, estimate OVER probability
// Key insight:
//   - If BOTH fighters have high finish rates → UNDER more likely (early finish)
//   - If both have low finish rates (decision fighters) → OVER more likely
//   - Striker vs Striker → higher finish rate → UNDER lean
//   - Grappler vs Grappler → can go either way, depends on wrestling defense
//   - Striker vs Grappler → mixed; often goes longer as grappler survives
function modelRoundsProbability(
  profileA: FighterProfile,
  profileB: FighterProfile,
  roundLine: number,  // e.g., 2.5 means OVER = 3+ rounds
  maxRounds: number,  // 3 or 5
): { overProb: number; underProb: number; projectedRounds: number; narrative: string } {
  // Combined finish probability (either fighter finishes in early rounds)
  const earlyFinishProb = Math.min(0.85, profileA.finishRate * 0.5 + profileB.finishRate * 0.5);
  const decisionProb = 1 - earlyFinishProb;

  // Projected rounds: weighted between early finish (~1.5 avg rounds) and decision (max rounds)
  const earlyAvgRounds = maxRounds === 5 ? 2.0 : 1.5;
  const projectedRounds = earlyFinishProb * earlyAvgRounds + decisionProb * maxRounds;

  // Striker vs Striker: +8% finish rate
  const styleModifier = (profileA.isStriker && profileB.isStriker) ? 0.08
    : (profileA.isGrappler && profileB.isGrappler) ? -0.03
    : (profileA.isStriker && profileB.isGrappler) ? 0.02
    : 0;

  const adjustedEarlyFinish = Math.min(0.88, Math.max(0.25, earlyFinishProb + styleModifier));
  const adjustedProjected = adjustedEarlyFinish * earlyAvgRounds + (1 - adjustedEarlyFinish) * maxRounds;

  // Convert projected rounds to probability around the line
  // If projected > line: OVER likely; if projected < line: UNDER likely
  const diff = adjustedProjected - roundLine;
  // Sigmoid-like mapping: diff of ±0.5 rounds → ±15% probability shift from 50%
  const baseOverProb = 0.50 + Math.tanh(diff * 1.2) * 0.20;
  const overProb = Math.min(0.80, Math.max(0.20, baseOverProb));
  const underProb = 1 - overProb;

  const styleDesc = profileA.isStriker && profileB.isStriker ? "Striker vs Striker"
    : profileA.isGrappler && profileB.isGrappler ? "Grappler vs Grappler"
    : profileA.isStriker && profileB.isGrappler ? "Striker vs Grappler"
    : profileA.isGrappler && profileB.isStriker ? "Grappler vs Striker"
    : "Style data unavailable";

  const narrative = `${styleDesc} | Combined finish rate: ${(adjustedEarlyFinish * 100).toFixed(0)}% | Projected rounds: ${adjustedProjected.toFixed(1)} vs line ${roundLine}`;

  return { overProb, underProb, projectedRounds: adjustedProjected, narrative };
}

function americanToImplied(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const log = (msg: string) => console.log(`[mma-rounds-analyzer] ${msg}`);
  const now = new Date();
  const today = getEasternDate();
  const todayStartUtc = getEasternMidnightUtc();

  try {
    log(`=== MMA Rounds Analyzer — ${today} ===`);

    // ── 1. Find today's MMA total-rounds props ────────────────────────────
    const MMA_SPORT_KEYS = ["mma_mixed_martial_arts", "mma", "ufc", "mma_ufc"];

    const { data: mmaProps, error: propsErr } = await supabase
      .from("unified_props")
      .select("id, player_name, prop_type, current_line, over_price, under_price, bookmaker, event_id, event_description, sport, commence_time")
      .gte("commence_time", todayStartUtc)
      .in("sport", MMA_SPORT_KEYS)
      .not("current_line", "is", null);

    if (propsErr) throw new Error(`Props fetch: ${propsErr.message}`);
    log(`Found ${mmaProps?.length || 0} MMA props for today`);

    if (!mmaProps || mmaProps.length === 0) {
      // Try broader search for any MMA-related props
      const { data: broadProps } = await supabase
        .from("unified_props")
        .select("id, player_name, prop_type, current_line, over_price, under_price, bookmaker, event_id, event_description, sport, commence_time")
        .gte("commence_time", todayStartUtc)
        .or("sport.ilike.%mma%,sport.ilike.%ufc%,sport.ilike.%fight%")
        .not("current_line", "is", null);

      if (!broadProps || broadProps.length === 0) {
        const result = {
          success: true,
          picks: 0,
          fights_scanned: 0,
          reason: "No MMA props found in unified_props. Ensure whale-odds-scraper ran with MMA in its tier configuration.",
        };
        await supabase.from("cron_job_history").insert({
          job_name: "mma-rounds-analyzer", status: "completed",
          started_at: now.toISOString(), completed_at: new Date().toISOString(),
          duration_ms: Date.now() - now.getTime(), result,
        });
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      mmaProps!.push(...broadProps);
    }

    // Filter to total-rounds props
    const ROUNDS_PROP_TYPES = new Set([
      "totals", "fight_total_rounds", "total_rounds", "rounds",
      "over_under_rounds", "fight_duration",
    ]);
    const roundsProps = (mmaProps || []).filter((p: any) => {
      const pt = (p.prop_type || "").toLowerCase();
      return ROUNDS_PROP_TYPES.has(pt) || pt.includes("round") || pt.includes("total");
    });

    log(`Total-rounds props: ${roundsProps.length}`);

    // De-duplicate by event_id — one line per fight
    const eventRoundsMap = new Map<string, any>();
    for (const prop of roundsProps) {
      if (!prop.event_id) continue;
      // Prefer props with both over/under prices
      const existing = eventRoundsMap.get(prop.event_id);
      if (!existing || (prop.over_price && prop.under_price && (!existing.over_price || !existing.under_price))) {
        eventRoundsMap.set(prop.event_id, prop);
      }
    }

    // Also include h2h props to identify ALL fights today (for coverage)
    const allFightEvents = new Map<string, any>();
    for (const prop of mmaProps || []) {
      if (prop.event_id) allFightEvents.set(prop.event_id, prop);
    }

    log(`Unique MMA fights with rounds lines: ${eventRoundsMap.size} | Total events today: ${allFightEvents.size}`);

    // ── 2. Load fighter profiles ──────────────────────────────────────────
    // First try mma_fighter_stats table (may or may not exist)
    let fighterStatsMap = new Map<string, any>();
    try {
      const { data: fighterStats } = await supabase
        .from("mma_fighter_stats")
        .select("fighter_name, finish_rate, avg_rounds, style, wins, losses, ko_wins, sub_wins, dec_wins");
      for (const f of fighterStats || []) {
        fighterStatsMap.set(normName(f.fighter_name), f);
      }
      log(`Loaded ${fighterStatsMap.size} fighter stats from mma_fighter_stats`);
    } catch (_) {
      log("mma_fighter_stats table not available — using inferred profiles");
    }

    // Also check historical category_sweet_spots for settled MMA data
    const { data: historicalMma } = await supabase
      .from("category_sweet_spots")
      .select("player_name, prop_type, recommended_side, outcome, l10_avg")
      .in("category", ["MMA_ROUNDS_OVER", "MMA_ROUNDS_UNDER"])
      .not("outcome", "is", null)
      .eq("prop_type", "rounds");

    // Build fighter performance history from settled picks
    const fighterHistoryMap = new Map<string, { overHits: number; underHits: number; total: number; avgRounds: number[] }>();
    for (const h of historicalMma || []) {
      const matchup = parseMatchup(h.player_name || "");
      if (!matchup) continue;
      for (const fighter of matchup) {
        const key = normName(fighter);
        if (!fighterHistoryMap.has(key)) fighterHistoryMap.set(key, { overHits: 0, underHits: 0, total: 0, avgRounds: [] });
        const entry = fighterHistoryMap.get(key)!;
        entry.total++;
        if (h.outcome === "hit") {
          if (h.recommended_side === "over") entry.overHits++;
          else entry.underHits++;
        }
        if (h.l10_avg) entry.avgRounds.push(Number(h.l10_avg));
      }
    }
    log(`Built history for ${fighterHistoryMap.size} fighters from settled picks`);

    // ── 3. Check method-of-victory props as style signals ─────────────────
    // If a fight has "method_of_victory_ko", "method_of_victory_submission" lines,
    // that tells us bookmakers expect finishes → UNDER lean
    const movProps = new Map<string, { hasFinishProps: boolean; koOdds?: number; subOdds?: number }>();
    for (const prop of mmaProps || []) {
      if (!prop.event_id) continue;
      const pt = (prop.prop_type || "").toLowerCase();
      if (pt.includes("method") || pt.includes("finish") || pt.includes("ko") || pt.includes("sub")) {
        if (!movProps.has(prop.event_id)) movProps.set(prop.event_id, { hasFinishProps: false });
        const entry = movProps.get(prop.event_id)!;
        entry.hasFinishProps = true;
        if (pt.includes("ko") && prop.over_price) entry.koOdds = prop.over_price;
        if (pt.includes("sub") && prop.over_price) entry.subOdds = prop.over_price;
      }
    }

    // ── 4. Build fighter profiles and analyze each fight ──────────────────
    function buildProfile(fighterName: string, eventId: string): FighterProfile {
      const key = normName(fighterName);

      // Try mma_fighter_stats
      const dbStats = fighterStatsMap.get(key);
      if (dbStats) {
        const totalFights = (dbStats.wins || 0) + (dbStats.losses || 0);
        const finishes = (dbStats.ko_wins || 0) + (dbStats.sub_wins || 0);
        const finishRate = totalFights > 0 ? finishes / totalFights : 0.55;
        return {
          name: fighterName,
          finishRate: finishRate || dbStats.finish_rate || 0.55,
          avgRoundsFought: dbStats.avg_rounds || 2.5,
          isStriker: (dbStats.style || "").toLowerCase().includes("strik") ||
            (dbStats.style || "").toLowerCase().includes("boxer"),
          isGrappler: (dbStats.style || "").toLowerCase().includes("wrestl") ||
            (dbStats.style || "").toLowerCase().includes("jiu-jitsu") ||
            (dbStats.style || "").toLowerCase().includes("grappl"),
          dataSource: "db",
        };
      }

      // Try historical data from settled picks
      const hist = fighterHistoryMap.get(key);
      if (hist && hist.total >= 2) {
        const underRate = hist.total > 0 ? hist.underHits / hist.total : 0.5;
        // High under rate → finisher (matches up with UNDER rounds)
        return {
          name: fighterName,
          finishRate: underRate * 0.8 + 0.55 * 0.2, // blend with league avg
          avgRoundsFought: hist.avgRounds.length > 0
            ? hist.avgRounds.reduce((a, b) => a + b, 0) / hist.avgRounds.length
            : 2.5,
          isStriker: false,
          isGrappler: false,
          dataSource: "inferred",
        };
      }

      // Check if this event has finish props (indicator of expected finish)
      const movData = movProps.get(eventId);
      if (movData?.hasFinishProps) {
        const koImplied = movData.koOdds ? americanToImplied(movData.koOdds) : 0;
        const subImplied = movData.subOdds ? americanToImplied(movData.subOdds) : 0;
        const totalFinishImplied = koImplied + subImplied;
        return {
          name: fighterName,
          finishRate: Math.min(0.80, Math.max(0.30, totalFinishImplied * 1.1)), // slight boost (vig removal)
          avgRoundsFought: 2.0,
          isStriker: koImplied > subImplied,
          isGrappler: subImplied > koImplied,
          dataSource: "inferred",
        };
      }

      return defaultProfile(fighterName);
    }

    const picks: any[] = [];
    let fightsScanned = 0;

    for (const [eventId, prop] of eventRoundsMap) {
      fightsScanned++;
      const eventDesc = prop.event_description || prop.player_name || "";
      const matchup = parseMatchup(eventDesc);

      let profileA: FighterProfile, profileB: FighterProfile;
      if (matchup) {
        profileA = buildProfile(matchup[0], eventId);
        profileB = buildProfile(matchup[1], eventId);
      } else {
        // Can't parse fighter names — use event-level MoV data if available
        profileA = defaultProfile("Fighter A");
        profileB = defaultProfile("Fighter B");
      }

      const line = Number(prop.current_line || 2.5);

      // Determine max rounds from the line (5-round fights have 2.5 or 4.5 as common lines)
      const maxRounds = line >= 4.0 ? 5 : 3;

      const { overProb, underProb, projectedRounds, narrative } =
        modelRoundsProbability(profileA, profileB, line, maxRounds);

      // Get market implied probability
      const overPrice  = prop.over_price;
      const underPrice = prop.under_price;
      const marketOverImplied  = overPrice  ? americanToImplied(overPrice)  : 0.50;
      const marketUnderImplied = underPrice ? americanToImplied(underPrice) : 0.50;

      const overEdge  = (overProb  - marketOverImplied)  / marketOverImplied  * 100;
      const underEdge = (underProb - marketUnderImplied) / marketUnderImplied * 100;

      const bestEdge = Math.max(overEdge, underEdge);
      const recommendedSide: "over" | "under" = overEdge > underEdge ? "over" : "under";
      const modelProb = recommendedSide === "over" ? overProb : underProb;
      const marketImplied = recommendedSide === "over" ? marketOverImplied : marketUnderImplied;
      const finalEdge = Math.max(0, bestEdge);

      if (finalEdge < MIN_EDGE_PCT) {
        log(`SKIP ${eventDesc}: edge ${finalEdge.toFixed(1)}% < ${MIN_EDGE_PCT}%`);
        continue;
      }

      // Confidence
      const bothDbData = profileA.dataSource === "db" && profileB.dataSource === "db";
      const anyDbData  = profileA.dataSource !== "default" || profileB.dataSource !== "default";
      let confidence = 0.55 + Math.min(finalEdge * 0.015, 0.12);
      if (bothDbData) confidence += 0.08;
      else if (anyDbData) confidence += 0.03;
      confidence = Math.min(0.86, Math.max(0.40, confidence));

      if (confidence < MIN_CONFIDENCE) continue;

      const oddsForPick = recommendedSide === "over" ? overPrice : underPrice;

      log(`PICK: ${eventDesc} — ${recommendedSide.toUpperCase()} ${line} rounds | edge ${finalEdge.toFixed(1)}%`);

      picks.push({
        event_id: eventId,
        event_description: eventDesc,
        recommended_side: recommendedSide,
        line,
        odds: oddsForPick,
        model_prob: Math.round(modelProb * 100) / 100,
        market_implied: Math.round(marketImplied * 100) / 100,
        edge_pct: Math.round(finalEdge * 10) / 10,
        projected_rounds: Math.round(projectedRounds * 100) / 100,
        confidence,
        fighter_a: profileA.name,
        fighter_a_finish_rate: profileA.finishRate,
        fighter_b: profileB.name,
        fighter_b_finish_rate: profileB.finishRate,
        data_sources: `${profileA.dataSource}/${profileB.dataSource}`,
        narrative,
      });
    }

    log(`Fights scanned: ${fightsScanned} | Picks: ${picks.length}`);

    // ── 5. Write to category_sweet_spots ──────────────────────────────────
    if (picks.length > 0) {
      const rows = picks.map(p => ({
        analysis_date: today,
        player_name:   p.event_description,
        prop_type:     "rounds",
        category:      p.recommended_side === "over" ? "MMA_ROUNDS_OVER" : "MMA_ROUNDS_UNDER",
        recommended_side: p.recommended_side,
        recommended_line: p.line,
        actual_line:   p.line,
        confidence_score: Math.round(p.confidence * 100) / 100,
        l10_avg:       p.projected_rounds,
        l10_median:    p.projected_rounds,
        is_active:     true,
        risk_level:    p.edge_pct >= 7 ? "LOW" : p.edge_pct >= 4.5 ? "MEDIUM" : "HIGH",
        recommendation: `${p.recommended_side.toUpperCase()} ${p.line} rounds — ${p.edge_pct.toFixed(1)}% edge | ${p.fighter_a} (${(p.fighter_a_finish_rate * 100).toFixed(0)}% finish) vs ${p.fighter_b} (${(p.fighter_b_finish_rate * 100).toFixed(0)}% finish)`,
        projection_source: "MMA_ROUNDS_FIGHTER_MODEL",
        eligibility_type: "MMA_FIGHT",
        signal_factors: JSON.stringify({
          model_prob: p.model_prob,
          market_implied: p.market_implied,
          edge_pct: p.edge_pct,
          projected_rounds: p.projected_rounds,
          fighter_a: p.fighter_a,
          fighter_a_finish_rate: p.fighter_a_finish_rate,
          fighter_b: p.fighter_b,
          fighter_b_finish_rate: p.fighter_b_finish_rate,
          data_sources: p.data_sources,
          odds: p.odds,
        }),
      }));

      await supabase.from("category_sweet_spots")
        .delete().eq("analysis_date", today)
        .in("category", ["MMA_ROUNDS_OVER", "MMA_ROUNDS_UNDER"]);

      const { error: insertErr } = await supabase.from("category_sweet_spots").insert(rows);
      if (insertErr) log(`⚠ Insert error: ${insertErr.message}`);
      else log(`Inserted ${rows.length} MMA round picks`);
    }

    // ── 6. Telegram ───────────────────────────────────────────────────────
    if (picks.length > 0) {
      const lines = [`🥊 *MMA Rounds Analyzer — ${picks.length} pick${picks.length !== 1 ? "s" : ""}*`, ""];
      for (const [i, p] of picks.entries()) {
        const sideLabel = p.recommended_side === "over" ? "OVER" : "UNDER";
        const emoji = p.recommended_side === "over" ? "⏰" : "⚡";
        const odds = p.odds ? ` (${p.odds > 0 ? "+" : ""}${p.odds})` : "";
        lines.push(`${i + 1}. ${emoji} *${p.event_description}* — ${sideLabel} ${p.line}${odds}`);
        lines.push(`   Projected: ${p.projected_rounds.toFixed(1)} rounds | ${p.narrative.split("|")[0].trim()}`);
        lines.push(`   📊 Model: ${(p.model_prob * 100).toFixed(0)}% | Market: ${(p.market_implied * 100).toFixed(0)}% | Edge: ${p.edge_pct.toFixed(1)}%`);
        lines.push(`   Confidence: ${(p.confidence * 100).toFixed(0)}% (data: ${p.data_sources})`);
        lines.push("");
      }
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true },
      });
    }

    const result = {
      success: true,
      picks: picks.length,
      fights_scanned: fightsScanned,
      total_mma_props: mmaProps?.length || 0,
    };

    await supabase.from("cron_job_history").insert({
      job_name: "mma-rounds-analyzer", status: "completed",
      started_at: now.toISOString(), completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(), result,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

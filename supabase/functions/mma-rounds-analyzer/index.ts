import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// mma-rounds-analyzer (v2 — fighter profile model)
//
// Builds real fighter profiles from mma_fighter_stats + settled history,
// models projected fight duration, compares to bookmaker lines.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_EDGE_PCT = 2.5;
const MIN_CONFIDENCE = 0.52;

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

function parseMatchup(desc: string): [string, string] | null {
  const m = (desc || "").match(/^(.+?)\s+(?:vs?\.?)\s+(.+?)(?:\s*[-–—]\s*.+)?$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function americanToImplied(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

interface FighterProfile {
  name: string; finishRate: number; avgRoundsFought: number;
  isStriker: boolean; isGrappler: boolean;
  dataSource: "db" | "inferred" | "default";
}

function defaultProfile(name: string): FighterProfile {
  return { name, finishRate: 0.55, avgRoundsFought: 2.5, isStriker: false, isGrappler: false, dataSource: "default" };
}

function modelRoundsProbability(
  profileA: FighterProfile, profileB: FighterProfile,
  roundLine: number, maxRounds: number,
): { overProb: number; underProb: number; projectedRounds: number; narrative: string } {
  const earlyFinishProb = Math.min(0.85, profileA.finishRate * 0.5 + profileB.finishRate * 0.5);
  const earlyAvgRounds = maxRounds === 5 ? 2.0 : 1.5;

  const styleModifier = (profileA.isStriker && profileB.isStriker) ? 0.08
    : (profileA.isGrappler && profileB.isGrappler) ? -0.03
    : (profileA.isStriker && profileB.isGrappler) ? 0.02 : 0;

  const adjustedEarlyFinish = Math.min(0.88, Math.max(0.25, earlyFinishProb + styleModifier));
  const adjustedProjected = adjustedEarlyFinish * earlyAvgRounds + (1 - adjustedEarlyFinish) * maxRounds;

  const diff = adjustedProjected - roundLine;
  const baseOverProb = 0.50 + Math.tanh(diff * 1.2) * 0.20;
  const overProb = Math.min(0.80, Math.max(0.20, baseOverProb));

  const styleDesc = profileA.isStriker && profileB.isStriker ? "Striker vs Striker"
    : profileA.isGrappler && profileB.isGrappler ? "Grappler vs Grappler"
    : profileA.isStriker && profileB.isGrappler ? "Striker vs Grappler"
    : profileA.isGrappler && profileB.isStriker ? "Grappler vs Striker"
    : "Mixed styles";

  return {
    overProb, underProb: 1 - overProb,
    projectedRounds: adjustedProjected,
    narrative: `${styleDesc} | Finish rate: ${(adjustedEarlyFinish * 100).toFixed(0)}% | Projected: ${adjustedProjected.toFixed(1)} vs line ${roundLine}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const log = (msg: string) => console.log(`[mma-rounds] ${msg}`);
  const now = new Date();
  const today = getEasternDate();

  try {
    log(`=== MMA Rounds Analyzer — ${today} ===`);

    // 1. Find MMA props — use game_description (not event_description)
    const MMA_SPORT_KEYS = ["mma_mixed_martial_arts", "mma", "ufc", "mma_ufc"];

    const { data: mmaProps, error: propsErr } = await supabase
      .from("unified_props")
      .select("id, player_name, prop_type, current_line, over_price, under_price, bookmaker, event_id, game_description, sport, commence_time")
      .gte("commence_time", `${today}T00:00:00`)
      .in("sport", MMA_SPORT_KEYS)
      .not("current_line", "is", null);

    if (propsErr) throw new Error(`Props fetch: ${propsErr.message}`);
    log(`Found ${mmaProps?.length || 0} MMA props`);

    if (!mmaProps || mmaProps.length === 0) {
      // Broader search
      const { data: broadProps } = await supabase
        .from("unified_props")
        .select("id, player_name, prop_type, current_line, over_price, under_price, bookmaker, event_id, game_description, sport, commence_time")
        .gte("commence_time", `${today}T00:00:00`)
        .or("sport.ilike.%mma%,sport.ilike.%ufc%,sport.ilike.%fight%")
        .not("current_line", "is", null);

      if (!broadProps || broadProps.length === 0) {
        const result = { success: true, picks: 0, fights_scanned: 0, reason: "No MMA props found" };
        await supabase.from("cron_job_history").insert({
          job_name: "mma-rounds-analyzer", status: "completed",
          started_at: now.toISOString(), completed_at: new Date().toISOString(),
          duration_ms: Date.now() - now.getTime(), result,
        });
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      mmaProps!.push(...broadProps);
    }

    // Filter to rounds props
    const ROUNDS_PROP_TYPES = new Set(["totals", "fight_total_rounds", "total_rounds", "rounds", "over_under_rounds"]);
    const roundsProps = (mmaProps || []).filter((p: any) => {
      const pt = (p.prop_type || "").toLowerCase();
      return ROUNDS_PROP_TYPES.has(pt) || pt.includes("round") || pt.includes("total");
    });

    log(`Rounds props: ${roundsProps.length}`);

    // De-duplicate by event_id
    const eventRoundsMap = new Map<string, any>();
    for (const prop of roundsProps) {
      if (!prop.event_id) continue;
      const existing = eventRoundsMap.get(prop.event_id);
      if (!existing || (prop.over_price && prop.under_price)) {
        eventRoundsMap.set(prop.event_id, prop);
      }
    }

    log(`Unique fights with rounds: ${eventRoundsMap.size}`);

    // 2. Load fighter profiles from mma_fighter_stats
    let fighterStatsMap = new Map<string, any>();
    try {
      const { data: fighterStats } = await supabase
        .from("mma_fighter_stats")
        .select("fighter_name, finish_rate, avg_rounds, style, wins, losses, ko_wins, sub_wins, dec_wins");
      for (const f of fighterStats || []) {
        fighterStatsMap.set(normName(f.fighter_name), f);
      }
      log(`Loaded ${fighterStatsMap.size} fighters from mma_fighter_stats`);
    } catch (_) {
      log("mma_fighter_stats not available");
    }

    // Historical settled MMA picks
    const { data: historicalMma } = await supabase
      .from("category_sweet_spots")
      .select("player_name, recommended_side, outcome, l10_avg")
      .in("category", ["MMA_ROUNDS_OVER", "MMA_ROUNDS_UNDER"])
      .not("outcome", "is", null);

    const fighterHistoryMap = new Map<string, { underHits: number; total: number; avgRounds: number[] }>();
    for (const h of historicalMma || []) {
      const matchup = parseMatchup(h.player_name || "");
      if (!matchup) continue;
      for (const fighter of matchup) {
        const key = normName(fighter);
        if (!fighterHistoryMap.has(key)) fighterHistoryMap.set(key, { underHits: 0, total: 0, avgRounds: [] });
        const e = fighterHistoryMap.get(key)!;
        e.total++;
        if (h.outcome === "hit" && h.recommended_side === "under") e.underHits++;
        if (h.l10_avg) e.avgRounds.push(Number(h.l10_avg));
      }
    }

    // 3. Build profiles and analyze
    function buildProfile(fighterName: string): FighterProfile {
      const key = normName(fighterName);
      const db = fighterStatsMap.get(key);
      if (db) {
        const total = (db.wins || 0) + (db.losses || 0);
        const finishes = (db.ko_wins || 0) + (db.sub_wins || 0);
        return {
          name: fighterName,
          finishRate: total > 0 ? finishes / total : db.finish_rate || 0.55,
          avgRoundsFought: db.avg_rounds || 2.5,
          isStriker: (db.style || "").toLowerCase().includes("strik"),
          isGrappler: (db.style || "").toLowerCase().includes("grappl") || (db.style || "").toLowerCase().includes("wrestl"),
          dataSource: "db",
        };
      }
      const hist = fighterHistoryMap.get(key);
      if (hist && hist.total >= 2) {
        return {
          name: fighterName,
          finishRate: (hist.underHits / hist.total) * 0.8 + 0.55 * 0.2,
          avgRoundsFought: hist.avgRounds.length > 0 ? hist.avgRounds.reduce((a, b) => a + b, 0) / hist.avgRounds.length : 2.5,
          isStriker: false, isGrappler: false, dataSource: "inferred",
        };
      }
      return defaultProfile(fighterName);
    }

    const picks: any[] = [];
    let fightsScanned = 0;

    for (const [eventId, prop] of eventRoundsMap) {
      fightsScanned++;
      const desc = prop.game_description || prop.player_name || "";
      const matchup = parseMatchup(desc);

      const profileA = matchup ? buildProfile(matchup[0]) : defaultProfile("Fighter A");
      const profileB = matchup ? buildProfile(matchup[1]) : defaultProfile("Fighter B");

      const line = Number(prop.current_line || 2.5);
      const maxRounds = line >= 4.0 ? 5 : 3;

      const { overProb, underProb, projectedRounds, narrative } =
        modelRoundsProbability(profileA, profileB, line, maxRounds);

      const marketOverImplied = prop.over_price ? americanToImplied(prop.over_price) : 0.50;
      const marketUnderImplied = prop.under_price ? americanToImplied(prop.under_price) : 0.50;

      const overEdge = (overProb - marketOverImplied) / marketOverImplied * 100;
      const underEdge = (underProb - marketUnderImplied) / marketUnderImplied * 100;
      const bestEdge = Math.max(overEdge, underEdge);
      const recommendedSide: "over" | "under" = overEdge > underEdge ? "over" : "under";
      const modelProb = recommendedSide === "over" ? overProb : underProb;
      const marketImplied = recommendedSide === "over" ? marketOverImplied : marketUnderImplied;
      const finalEdge = Math.max(0, bestEdge);

      log(`  ${desc}: side=${recommendedSide} edge=${finalEdge.toFixed(1)}% proj=${projectedRounds.toFixed(2)} line=${line} model=${modelProb.toFixed(3)} mkt=${marketImplied.toFixed(3)} | ${profileA.dataSource}/${profileB.dataSource}`);

      if (finalEdge < MIN_EDGE_PCT) continue;

      const bothDb = profileA.dataSource === "db" && profileB.dataSource === "db";
      const anyDb = profileA.dataSource !== "default" || profileB.dataSource !== "default";
      let confidence = 0.52 + Math.min(finalEdge * 0.018, 0.15);
      if (bothDb) confidence += 0.10;
      else if (anyDb) confidence += 0.05;
      confidence = Math.min(0.86, Math.max(0.40, confidence));
      if (confidence < MIN_CONFIDENCE) continue;

      picks.push({
        event_id: eventId, game_desc: desc, recommended_side: recommendedSide,
        line, odds: recommendedSide === "over" ? prop.over_price : prop.under_price,
        model_prob: Math.round(modelProb * 100) / 100,
        market_implied: Math.round(marketImplied * 100) / 100,
        edge_pct: Math.round(finalEdge * 10) / 10,
        projected_rounds: Math.round(projectedRounds * 100) / 100,
        confidence, fighter_a: profileA.name, fighter_a_finish: profileA.finishRate,
        fighter_b: profileB.name, fighter_b_finish: profileB.finishRate,
        data_sources: `${profileA.dataSource}/${profileB.dataSource}`, narrative,
      });
    }

    log(`Fights scanned: ${fightsScanned} | Picks: ${picks.length}`);

    // 5. Write to category_sweet_spots
    if (picks.length > 0) {
      await supabase.from("category_sweet_spots")
        .delete().eq("analysis_date", today)
        .in("category", ["MMA_ROUNDS_OVER", "MMA_ROUNDS_UNDER"]);

      const rows = picks.map(p => ({
        analysis_date: today,
        player_name: p.game_desc,
        prop_type: "rounds",
        category: p.recommended_side === "over" ? "MMA_ROUNDS_OVER" : "MMA_ROUNDS_UNDER",
        recommended_side: p.recommended_side,
        recommended_line: p.line,
        actual_line: p.line,
        confidence_score: Math.round(p.confidence * 100) / 100,
        l10_avg: p.projected_rounds,
        l10_median: p.projected_rounds,
        is_active: true,
        risk_level: p.edge_pct >= 7 ? "LOW" : p.edge_pct >= 4.5 ? "MEDIUM" : "HIGH",
        recommendation: `${p.recommended_side.toUpperCase()} ${p.line} rounds — ${p.edge_pct.toFixed(1)}% edge | ${p.fighter_a} (${(p.fighter_a_finish * 100).toFixed(0)}%) vs ${p.fighter_b} (${(p.fighter_b_finish * 100).toFixed(0)}%)`,
        projection_source: "MMA_ROUNDS_FIGHTER_MODEL",
        eligibility_type: "MMA_FIGHT",
      }));

      const { error: insertErr } = await supabase.from("category_sweet_spots").insert(rows);
      if (insertErr) log(`⚠ Insert error: ${insertErr.message}`);
      else log(`Inserted ${rows.length} MMA picks`);
    }

    // 6. Telegram
    if (picks.length > 0) {
      const lines = [`🥊 *MMA Rounds — ${picks.length} pick${picks.length !== 1 ? "s" : ""}*`, ""];
      for (const [i, p] of picks.entries()) {
        const emoji = p.recommended_side === "over" ? "⏰" : "⚡";
        const odds = p.odds ? ` (${p.odds > 0 ? "+" : ""}${p.odds})` : "";
        lines.push(`${i + 1}. ${emoji} *${p.game_desc}* — ${p.recommended_side.toUpperCase()} ${p.line}${odds}`);
        lines.push(`   ${p.narrative}`);
        lines.push(`   📊 Model: ${(p.model_prob * 100).toFixed(0)}% | Market: ${(p.market_implied * 100).toFixed(0)}% | Edge: ${p.edge_pct.toFixed(1)}%`);
        lines.push("");
      }
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true },
      }).catch(() => {});
    }

    const result = { success: true, picks: picks.length, fights_scanned: fightsScanned };

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

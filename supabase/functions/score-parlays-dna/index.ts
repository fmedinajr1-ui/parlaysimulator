import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// score-parlays-dna  (FIXED)
//
// BUG 1 — Used new Date().toISOString().split("T")[0] (UTC midnight) to set
//   `today` for the parlay query. On a UTC server this is the wrong calendar
//   day when run between midnight UTC and midnight ET. Since parlays are
//   stored with an ET parlay_date, the query returns zero rows.
//   Fixed: getEasternDate().
//
// BUG 2 — Telegram sent via { type: "pick_dna", data: { message: msg } }.
//   The message string contains Markdown formatting (*bold*, etc.), but
//   bot-send-telegram only adds parse_mode when the caller passes it in
//   the body. Without parse_mode, asterisks render as literal characters
//   in Telegram. Fixed: direct { message, parse_mode: "Markdown" } invoke
//   — same pattern used by every other function in the codebase.
//
// BUG 3 — B/C grade prune logic was identical code duplicated verbatim in
//   the `weakLegs.length === 1` and `else` branches. Any future change to
//   the odds-recalc or update-parlays push must be made in two places and
//   will inevitably drift. Consolidated into a shared tryPruneParlay helper.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// BUG 1 FIX: ET-aware date
function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const PROP_LABELS: Record<string, string> = {
  threes: "3PT", points: "PTS", assists: "AST", rebounds: "REB",
  steals: "STL", blocks: "BLK", turnovers: "TO", pra: "PRA",
  pts_rebs: "P+R", pts_asts: "P+A", rebs_asts: "R+A",
  three_pointers_made: "3PT", fantasy_score: "FPTS",
  player_points: "PTS", player_rebounds: "REB", player_assists: "AST",
  player_threes: "3PT", player_blocks: "BLK", player_steals: "STL",
};

interface DnaWeight {
  signal_name: string;
  weight: number;
  avg_when_hit: number;
  avg_when_miss: number;
}

interface LegScore {
  player: string;
  prop: string;
  side: string;
  line: number;
  dna_score: number;
  buffer_pct: number;
  has_real_line: boolean;
  flags: string[];
}

interface ParlayGrade {
  parlay_id: string;
  strategy: string;
  grade: "A" | "B" | "C" | "F";
  original_legs: number;
  kept_legs: number;
  voided: boolean;
  leg_scores: LegScore[];
  action: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // BUG 1 FIX: ET date — parlays stored with ET parlay_date
  const today = getEasternDate();
  const log = (msg: string) => console.log(`[score-parlays-dna] ${msg}`);

  const SOFT_FLAGS = new Set<string>();

  try {
    const { data: parlays, error: pErr } = await supabase
      .from("bot_daily_parlays")
      .select("*")
      .eq("parlay_date", today)
      .eq("outcome", "pending");

    if (pErr) throw new Error(`Failed to load parlays: ${pErr.message}`);
    if (!parlays || parlays.length === 0) {
      log("No pending parlays found for today");
      return new Response(JSON.stringify({ success: true, message: "No pending parlays" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    log(`Found ${parlays.length} pending parlays`);

    const { data: weights } = await supabase
      .from("pick_score_weights")
      .select("signal_name, weight, avg_when_hit, avg_when_miss")
      .order("separation", { ascending: false });

    const dnaWeights: DnaWeight[] = weights || [];
    const weightMap = new Map(dnaWeights.map(w => [w.signal_name, w]));
    log(`Loaded ${dnaWeights.length} DNA weights`);

    const grades: ParlayGrade[] = [];
    const voidIds: string[] = [];
    const updateParlays: { id: string; legs: any[]; leg_count: number; expected_odds: number; dna_grade: string }[] = [];

    // BUG 3 FIX: shared prune-or-void helper
    function tryPruneParlay(
      parlayId: string,
      legs: any[],
      legScores: LegScore[],
    ): { action: string; grade: "B" | "C" | "F"; keptCount: number } {
      const keptLegScores = legScores.filter(l => !l.flags.some(f => !SOFT_FLAGS.has(f)));
      const keptLegData   = legs.filter((_: any, i: number) => !legScores[i].flags.some((f: string) => !SOFT_FLAGS.has(f)));
      const droppedCount  = legScores.length - keptLegScores.length;
      const gradeLabel: "B" | "C" = droppedCount === 1 ? "B" : "C";

      if (keptLegData.length >= 2) {
        const newOdds = keptLegData.reduce((acc: number, l: any) => {
          const legOdds = l.american_odds || l.odds || -110;
          const decimal = legOdds > 0 ? (legOdds / 100) + 1 : (100 / Math.abs(legOdds)) + 1;
          return acc * decimal;
        }, 1);
        updateParlays.push({
          id: parlayId,
          legs: keptLegData,
          leg_count: keptLegData.length,
          expected_odds: Math.round((newOdds - 1) * 100),
          dna_grade: gradeLabel,
        });
        return {
          action: `drop_${droppedCount}_leg${droppedCount > 1 ? "s" : ""}`,
          grade: gradeLabel,
          keptCount: keptLegData.length,
        };
      }

      voidIds.push(parlayId);
      return { action: "void", grade: "F", keptCount: 0 };
    }

    for (const parlay of parlays) {
      log(`--- Parlay ${parlay.id.slice(0,8)} (${parlay.strategy_name}) ---`);
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      const legScores: LegScore[] = [];

      for (const leg of legs) {
        const playerName  = leg.player_name || leg.player || "";
        const propType    = leg.prop_type || leg.type || "";
        const side        = leg.side || leg.recommendation || "";
        const line        = leg.line || leg.recommended_line || 0;
        const l10Avg      = leg.l10_avg || leg.l10_average || 0;
        const hasRealLine = leg.has_real_line !== false && leg.line_source !== "projected";

        let bufferPct = 0;
        let dnaScore  = 50;
        const flags: string[] = [];

        if (!(l10Avg === 0 && line > 0)) {
          bufferPct = line > 0
            ? side?.toLowerCase() === "over"
              ? ((l10Avg - line) / line) * 100
              : ((line - l10Avg) / line) * 100
            : 0;

          const l3Avg      = leg.l3_avg      || l10Avg;
          const l5Avg      = leg.l5_avg      || l10Avg;
          const seasonAvg  = leg.season_avg  || l10Avg;
          const l10Min     = leg.l10_min     || 0;
          const l10Median  = leg.l10_median  || l10Avg;
          const h2hAvg     = leg.h2h_avg_vs_opponent || 0;
          const projVal    = leg.projected_value     || 0;
          const sideUp     = side?.toLowerCase() === "over";

          const floorVsLine = (l10Min > 0 && line > 0)
            ? sideUp ? ((l10Min - line) / line) * 100 : ((line - l10Min) / line) * 100
            : 0;
          const medianBuffer = (l10Median > 0 && line > 0)
            ? sideUp ? ((l10Median - line) / line) * 100 : ((line - l10Median) / line) * 100
            : 0;
          const trendL5 = (l5Avg > 0 && l10Avg > 0)
            ? ((l5Avg - l10Avg) / l10Avg) * 100
            : 0;
          const stdDev    = leg.l10_std_dev || leg.std_dev || 0;
          const consistency = (stdDev > 0 && l10Avg > 0) ? stdDev / l10Avg : 0;
          const seasonVsLine = (seasonAvg > 0 && line > 0)
            ? sideUp ? ((seasonAvg - line) / line) * 100 : ((line - seasonAvg) / line) * 100
            : 0;
          const h2hVsLine = (h2hAvg > 0 && line > 0)
            ? sideUp ? ((h2hAvg - line) / line) * 100 : ((line - h2hAvg) / line) * 100
            : 0;
          const projectedBuffer = (projVal > 0 && line > 0)
            ? sideUp ? ((projVal - line) / line) * 100 : ((line - projVal) / line) * 100
            : 0;

          const rawHitRate  = leg.l10_hit_rate ?? leg.hit_rate ?? null;
          const hitRateNorm = rawHitRate != null && rawHitRate > 1 ? rawHitRate / 100 : rawHitRate;

          const signals: Record<string, number | null> = {
            buffer_pct:         bufferPct,
            l10_hit_rate:       hitRateNorm,
            confidence_score:   leg.confidence_score || leg.confidence || null,
            matchup_adjustment: leg.matchup_adjustment || null,
            pace_adjustment:    leg.pace_adjustment   || null,
            h2h_matchup_boost:  leg.h2h_matchup_boost || null,
            bounce_back_score:  leg.bounce_back_score || null,
            line_difference:    leg.line_difference   || null,
            floor_vs_line:      floorVsLine    || null,
            median_buffer:      medianBuffer   || null,
            trend_l5_vs_l10:    trendL5        || null,
            consistency:        consistency    || null,
            season_vs_line:     seasonVsLine   || null,
            h2h_vs_line:        h2hVsLine      || null,
            projected_buffer:   projectedBuffer || null,
          };

          let rawScore = 0, totalWeight = 0, signalsUsed = 0;
          for (const [signalName, value] of Object.entries(signals)) {
            if (value == null) continue;
            const w = weightMap.get(signalName);
            if (w && w.weight !== 0) {
              const range      = Math.abs(w.avg_when_hit - w.avg_when_miss) || 1;
              const normalized = (value - w.avg_when_miss) / range;
              rawScore    += normalized * w.weight;
              totalWeight += Math.abs(w.weight);
              signalsUsed++;
            }
          }

          dnaScore = totalWeight > 0
            ? Math.max(0, Math.min(100, 50 + (rawScore / totalWeight) * 50))
            : 50;

          log(`    DNA: signals=${signalsUsed} raw=${rawScore.toFixed(3)} weight=${totalWeight.toFixed(3)} score=${Math.round(dnaScore)} buf=${bufferPct.toFixed(1)}%`);

          if (!hasRealLine)                         flags.push("NO_FD_LINE");
          if (bufferPct < -10)                       flags.push("NEG_BUFFER");
          if (dnaScore < 30 && signalsUsed >= 3)    flags.push("LOW_DNA");
        }

        if (!playerName) flags.push("NO_PLAYER");

        legScores.push({
          player: playerName, prop: propType, side, line,
          dna_score: Math.round(dnaScore),
          buffer_pct: Math.round(bufferPct * 10) / 10,
          has_real_line: hasRealLine, flags,
        });
        log(`  Leg: ${playerName} ${propType} ${side} ${line} | DNA:${Math.round(dnaScore)} buf:${Math.round(bufferPct*10)/10}% flags:[${flags.join(',')}] real_line:${hasRealLine}`);
      }

      const fatalLegs = legScores.filter(l => l.flags.includes("NO_PLAYER"));
      const weakLegs  = legScores.filter(l => l.flags.some(f => !SOFT_FLAGS.has(f)));

      let grade: "A" | "B" | "C" | "F";
      let action = "keep";
      let keptLegsCount = legScores.length;

      if (fatalLegs.length > 0 || legScores.length === 0) {
        grade = "F";
        action = "void";
        keptLegsCount = 0;
        voidIds.push(parlay.id);
      } else if (weakLegs.length === 0) {
        grade = "A";
        action = "keep";
      } else {
        // BUG 3 FIX: single shared helper
        const pruneResult = tryPruneParlay(parlay.id, legs, legScores);
        grade         = pruneResult.grade as "A" | "B" | "C" | "F";
        action        = pruneResult.action;
        keptLegsCount = pruneResult.keptCount;
      }

      grades.push({
        parlay_id: parlay.id, strategy: parlay.strategy_name,
        grade, original_legs: legs.length, kept_legs: keptLegsCount,
        voided: action === "void", leg_scores: legScores, action,
      });
    }

    if (voidIds.length > 0) {
      const { error: voidErr } = await supabase
        .from("bot_daily_parlays")
        .update({ outcome: "void", lesson_learned: "DNA audit: unbettable (fake line / no player / insufficient legs)", dna_grade: "F" })
        .in("id", voidIds);
      if (voidErr) log(`Void error: ${voidErr.message}`);
      else log(`Voided ${voidIds.length} F-grade parlays`);
    }

    for (const up of updateParlays) {
      const { error: upErr } = await supabase
        .from("bot_daily_parlays")
        .update({
          legs: up.legs, leg_count: up.leg_count,
          expected_odds: up.expected_odds,
          lesson_learned: "DNA audit: weak legs pruned",
          dna_grade: up.dna_grade,
        })
        .eq("id", up.id);
      if (upErr) log(`Update error for ${up.id}: ${upErr.message}`);
    }

    const aGradeIds = grades
      .filter(g => g.grade === "A" && !voidIds.includes(g.parlay_id) && !updateParlays.some(u => u.id === g.parlay_id))
      .map(g => g.parlay_id);
    if (aGradeIds.length > 0) {
      const { error: aErr } = await supabase
        .from("bot_daily_parlays").update({ dna_grade: "A" }).in("id", aGradeIds);
      if (aErr) log(`A-grade update error: ${aErr.message}`);
      else log(`Marked ${aGradeIds.length} parlays as A-grade`);
    }

    const aCount = grades.filter(g => g.grade === "A").length;
    const bCount = grades.filter(g => g.grade === "B").length;
    const cCount = grades.filter(g => g.grade === "C").length;
    const fCount = grades.filter(g => g.grade === "F").length;
    log(`Grades: A=${aCount}, B=${bCount}, C=${cCount}, F=${fCount}`);

    const aGrades = grades.filter(g => g.grade === "A");
    const bGrades = grades.filter(g => g.grade === "B");
    const cGrades = grades.filter(g => g.grade === "C");
    const fGrades = grades.filter(g => g.grade === "F");

    const formatLeg = (l: LegScore) => {
      const label   = PROP_LABELS[l.prop] || l.prop?.toUpperCase() || "?";
      const sideChar = l.side?.toLowerCase() === "over" ? "O" : "U";
      return `${l.player} ${label} ${sideChar}${l.line} (DNA:${l.dna_score})`;
    };

    const dateLabel = new Date().toLocaleDateString("en-US", {
      month: "short", day: "numeric", timeZone: "America/New_York",
    });
    let msg = `🧬 *DNA PARLAY AUDIT — ${dateLabel}*\n`;
    msg += `${parlays.length} parlays scored | ${fGrades.length} voided | ${updateParlays.length} fixed\n\n`;

    if (aGrades.length > 0) {
      msg += `✅ *A-GRADE (${aGrades.length} keep as-is):*\n`;
      for (const g of aGrades.slice(0, 5)) {
        msg += `• ${g.leg_scores.map(formatLeg).join(" + ")}\n`;
      }
      if (aGrades.length > 5) msg += `  ...and ${aGrades.length - 5} more\n`;
      msg += "\n";
    }

    if (bGrades.length > 0 || cGrades.length > 0) {
      const fixed = [...bGrades, ...cGrades];
      msg += `⚠️ *B/C-GRADE (${fixed.length} fixed):*\n`;
      for (const g of fixed.slice(0, 5)) {
        const dropped = g.leg_scores.filter(l => l.flags.length > 0);
        msg += `• ${g.original_legs}→${g.kept_legs} legs`;
        if (dropped.length > 0) {
          msg += ` | Dropped: ${dropped.map(d => `${d.player} ${PROP_LABELS[d.prop] || d.prop} (DNA:${d.dna_score}, buf:${d.buffer_pct}%)`).join(", ")}`;
        }
        msg += "\n";
      }
      msg += "\n";
    }

    if (fGrades.length > 0) {
      msg += `❌ *VOIDED (${fGrades.length}):*\n`;
      for (const g of fGrades.slice(0, 5)) {
        const reasons = [...new Set(g.leg_scores.flatMap(l => l.flags))];
        msg += `• ${g.strategy} — ${reasons.join(", ")}\n`;
      }
      msg += "\n";
    }

    // BUG 2 FIX: direct message + parse_mode
    await supabase.functions.invoke("bot-send-telegram", {
      body: { message: msg, parse_mode: "Markdown", admin_only: true },
    });

    log("DNA audit complete and sent to Telegram");

    return new Response(JSON.stringify({
      success: true,
      total: parlays.length,
      voided: voidIds.length,
      fixed: updateParlays.length,
      grades: { A: aCount, B: bCount, C: cCount, F: fCount },
      grade_detail: grades.map(g => ({ id: g.parlay_id, grade: g.grade, action: g.action })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
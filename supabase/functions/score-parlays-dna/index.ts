import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = new Date().toISOString().split("T")[0];
  const log = (msg: string) => console.log(`[score-parlays-dna] ${msg}`);

  try {
    // 1. Load today's pending parlays
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

    // 2. Load DNA weights
    const { data: weights } = await supabase
      .from("pick_score_weights")
      .select("signal_name, weight, avg_when_hit, avg_when_miss")
      .order("separation", { ascending: false });

    const dnaWeights: DnaWeight[] = weights || [];
    const weightMap = new Map(dnaWeights.map(w => [w.signal_name, w]));
    log(`Loaded ${dnaWeights.length} DNA weights`);

    // 3. Score each parlay
    const grades: ParlayGrade[] = [];
    const voidIds: string[] = [];
    const updateParlays: { id: string; legs: any; leg_count: number; expected_odds: number }[] = [];

    for (const parlay of parlays) {
      log(`--- Parlay ${parlay.id.slice(0,8)} (${parlay.strategy_name}) ---`);
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      const legScores: LegScore[] = [];

      for (const leg of legs) {
        const playerName = leg.player_name || leg.player || "";
        const propType = leg.prop_type || leg.type || "";
        const side = leg.side || leg.recommendation || "";
        const line = leg.line || leg.recommended_line || 0;
        const l10Avg = leg.l10_avg || leg.l10_average || 0;
        const hasRealLine = leg.has_real_line !== false && leg.line_source !== "projected";

        let bufferPct = 0;
        let dnaScore = 50;
        const flags: string[] = [];

        // If no L10 avg data, assign neutral score — don't penalize missing stats
        if (l10Avg === 0 && line > 0) {
          // No stats available, keep neutral defaults
        } else {
          // Calculate buffer %
          bufferPct = line > 0
            ? side?.toLowerCase() === "over"
              ? ((l10Avg - line) / line) * 100
              : ((line - l10Avg) / line) * 100
            : 0;

          // Calculate DNA score using learned weights
          // Compute derived signals for DNA scoring
          const l3Avg = leg.l3_avg || l10Avg;
          const l5Avg = leg.l5_avg || l10Avg;
          const seasonAvg = leg.season_avg || l10Avg;
          const l10Min = leg.l10_min || 0;
          const l10Median = leg.l10_median || l10Avg;
          const h2hAvg = leg.h2h_avg_vs_opponent || 0;
          const projVal = leg.projected_value || 0;
          const sideUp = side?.toLowerCase() === "over";

          // floor_vs_line
          let floorVsLine = 0;
          if (l10Min > 0 && line > 0) {
            floorVsLine = sideUp ? ((l10Min - line) / line) * 100 : ((line - l10Min) / line) * 100;
          }
          // median_buffer
          let medianBuffer = 0;
          if (l10Median > 0 && line > 0) {
            medianBuffer = sideUp ? ((l10Median - line) / line) * 100 : ((line - l10Median) / line) * 100;
          }
          // trend_l5_vs_l10
          let trendL5 = 0;
          if (l5Avg > 0 && l10Avg > 0) {
            trendL5 = ((l5Avg - l10Avg) / l10Avg) * 100;
          }
          // consistency (CoV)
          const stdDev = leg.l10_std_dev || leg.std_dev || 0;
          let consistency = 0;
          if (stdDev > 0 && l10Avg > 0) {
            consistency = stdDev / l10Avg;
          }
          // season_vs_line
          let seasonVsLine = 0;
          if (seasonAvg > 0 && line > 0) {
            seasonVsLine = sideUp ? ((seasonAvg - line) / line) * 100 : ((line - seasonAvg) / line) * 100;
          }
          // h2h_vs_line
          let h2hVsLine = 0;
          if (h2hAvg > 0 && line > 0) {
            h2hVsLine = sideUp ? ((h2hAvg - line) / line) * 100 : ((line - h2hAvg) / line) * 100;
          }
          // projected_buffer
          let projectedBuffer = 0;
          if (projVal > 0 && line > 0) {
            projectedBuffer = sideUp ? ((projVal - line) / line) * 100 : ((line - projVal) / line) * 100;
          }

          const signals: Record<string, number | null> = {
            buffer_pct: bufferPct,
            l10_hit_rate: leg.l10_hit_rate || leg.hit_rate || null,
            l10_std_dev: stdDev || null,
            confidence_score: leg.confidence_score || leg.confidence || null,
            l10_avg: l10Avg || null,
            l5_avg: l5Avg || null,
            l3_avg: l3Avg || null,
            matchup_adjustment: leg.matchup_adjustment || null,
            pace_adjustment: leg.pace_adjustment || null,
            h2h_matchup_boost: leg.h2h_matchup_boost || null,
            bounce_back_score: leg.bounce_back_score || null,
            season_avg: seasonAvg || null,
            line_difference: leg.line_difference || null,
            floor_vs_line: floorVsLine || null,
            median_buffer: medianBuffer || null,
            trend_l5_vs_l10: trendL5 || null,
            consistency: consistency || null,
            season_vs_line: seasonVsLine || null,
            h2h_vs_line: h2hVsLine || null,
            games_played: leg.games_played || null,
            projected_buffer: projectedBuffer || null,
          };

          // buffer_pct is always valid (even if 0), keep it; skip nulls for everything else
          let rawScore = 0;
          let totalWeight = 0;
          for (const [signalName, value] of Object.entries(signals)) {
            if (value == null) continue; // skip missing data — don't penalize absent signals
            const w = weightMap.get(signalName);
            if (w && w.weight !== 0) {
              const range = Math.abs(w.avg_when_hit - w.avg_when_miss) || 1;
              const normalized = (value - w.avg_when_miss) / range;
              rawScore += normalized * w.weight;
              totalWeight += Math.abs(w.weight);
            }
          }

          dnaScore = totalWeight > 0
            ? Math.max(0, Math.min(100, 50 + (rawScore / totalWeight) * 50))
            : 50;

          if (!hasRealLine) flags.push("NO_FD_LINE"); // soft flag — informational only
          if (bufferPct < -10) flags.push("NEG_BUFFER"); // hard flag — widened from -5% to -10%
          if (dnaScore < 30) flags.push("LOW_DNA"); // hard flag
        }

        if (!playerName) flags.push("NO_PLAYER");

        legScores.push({
          player: playerName,
          prop: propType,
          side,
          line,
          dna_score: Math.round(dnaScore),
          buffer_pct: Math.round(bufferPct * 10) / 10,
          has_real_line: hasRealLine,
          flags,
        });

        // Verbose per-leg logging for diagnostics
        log(`  Leg: ${playerName} ${propType} ${side} ${line} | DNA:${Math.round(dnaScore)} buf:${Math.round(bufferPct*10)/10}% flags:[${flags.join(',')}] real_line:${hasRealLine}`);
      }

      // Grade the parlay — split flags into hard (prunable) and soft (informational)
      const SOFT_FLAGS = new Set(["NO_FD_LINE"]);
      const weakLegs = legScores.filter(l => l.flags.some(f => !SOFT_FLAGS.has(f)));
      const fatalLegs = legScores.filter(l =>
        l.flags.includes("NO_PLAYER")
      );

      let grade: "A" | "B" | "C" | "F";
      let action = "keep";

      if (fatalLegs.length > 0 || legScores.length === 0) {
        grade = "F";
        action = "void";
        voidIds.push(parlay.id);
      } else if (weakLegs.length === 0) {
        grade = "A";
        action = "keep";
      } else if (weakLegs.length === 1) {
        grade = "B";
        // Drop weak leg if remaining >= 2
        const keptLegs = legScores.filter(l => !l.flags.some(f => !SOFT_FLAGS.has(f)));
        if (keptLegs.length >= 2) {
          action = `drop_${weakLegs.length}_leg`;
          const keptLegData = legs.filter((_: any, i: number) => !legScores[i].flags.some((f: string) => !SOFT_FLAGS.has(f)));
          const newOdds = keptLegData.reduce((acc: number, l: any) => {
            const legOdds = l.american_odds || l.odds || -110;
            const decimal = legOdds > 0 ? (legOdds / 100) + 1 : (100 / Math.abs(legOdds)) + 1;
            return acc * decimal;
          }, 1);
          updateParlays.push({
            id: parlay.id,
            legs: keptLegData,
            leg_count: keptLegData.length,
            expected_odds: Math.round((newOdds - 1) * 100),
          });
        } else {
          action = "void";
          grade = "F";
          voidIds.push(parlay.id);
        }
      } else {
        grade = "C";
        const keptLegs = legScores.filter(l => !l.flags.some(f => !SOFT_FLAGS.has(f)));
        if (keptLegs.length >= 2) {
          action = `drop_${weakLegs.length}_legs`;
          const keptLegData = legs.filter((_: any, i: number) => !legScores[i].flags.some((f: string) => !SOFT_FLAGS.has(f)));
          const newOdds = keptLegData.reduce((acc: number, l: any) => {
            const legOdds = l.american_odds || l.odds || -110;
            const decimal = legOdds > 0 ? (legOdds / 100) + 1 : (100 / Math.abs(legOdds)) + 1;
            return acc * decimal;
          }, 1);
          updateParlays.push({
            id: parlay.id,
            legs: keptLegData,
            leg_count: keptLegData.length,
            expected_odds: Math.round((newOdds - 1) * 100),
          });
        } else {
          action = "void";
          grade = "F";
          voidIds.push(parlay.id);
        }
      }

      grades.push({
        parlay_id: parlay.id,
        strategy: parlay.strategy_name,
        grade,
        original_legs: legs.length,
        kept_legs: action === "void" ? 0 : legScores.filter(l => !l.flags.some(f => !SOFT_FLAGS.has(f))).length,
        voided: action === "void",
        leg_scores: legScores,
        action,
      });
    }

    // 4. Apply changes
    // Void F-grade parlays
    if (voidIds.length > 0) {
      const { error: voidErr } = await supabase
        .from("bot_daily_parlays")
        .update({ outcome: "void", lesson_learned: "DNA audit: unbettable (fake line / no player / insufficient legs)", dna_grade: "F" })
        .in("id", voidIds);
      if (voidErr) log(`Void error: ${voidErr.message}`);
      else log(`Voided ${voidIds.length} F-grade parlays`);
    }

    // Update pruned parlays
    for (const up of updateParlays) {
      const gradeEntry = grades.find(g => g.parlay_id === up.id);
      const { error: upErr } = await supabase
        .from("bot_daily_parlays")
        .update({
          legs: up.legs,
          leg_count: up.leg_count,
          expected_odds: up.expected_odds,
          lesson_learned: "DNA audit: weak legs pruned",
          dna_grade: gradeEntry?.grade || "C",
        })
        .eq("id", up.id);
      if (upErr) log(`Update error for ${up.id}: ${upErr.message}`);
    }

    // Persist dna_grade on all non-voided, non-pruned parlays (A-grades)
    const aGradeIds = grades
      .filter(g => g.grade === "A" && !voidIds.includes(g.parlay_id) && !updateParlays.some(u => u.id === g.parlay_id))
      .map(g => g.parlay_id);
    if (aGradeIds.length > 0) {
      const { error: aErr } = await supabase
        .from("bot_daily_parlays")
        .update({ dna_grade: "A" })
        .in("id", aGradeIds);
      if (aErr) log(`A-grade update error: ${aErr.message}`);
      else log(`Marked ${aGradeIds.length} parlays as A-grade`);
    }

    log(`Grades: A=${grades.filter(g => g.grade === "A").length}, B=${grades.filter(g => g.grade === "B").length}, C=${grades.filter(g => g.grade === "C").length}, F=${grades.filter(g => g.grade === "F").length}`);

    // 5. Build Telegram message
    const aGrades = grades.filter(g => g.grade === "A");
    const bGrades = grades.filter(g => g.grade === "B");
    const cGrades = grades.filter(g => g.grade === "C");
    const fGrades = grades.filter(g => g.grade === "F");

    const formatLeg = (l: LegScore) => {
      const label = PROP_LABELS[l.prop] || l.prop?.toUpperCase() || "?";
      const sideChar = l.side?.toLowerCase() === "over" ? "O" : "U";
      return `${l.player} ${label} ${sideChar}${l.line} (DNA:${l.dna_score})`;
    };

    let msg = `🧬 DNA PARLAY AUDIT — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}\n`;
    msg += `${parlays.length} parlays scored | ${fGrades.length} voided | ${updateParlays.length} fixed\n\n`;

    if (aGrades.length > 0) {
      msg += `✅ A-GRADE (${aGrades.length} keep as-is):\n`;
      for (const g of aGrades.slice(0, 5)) {
        msg += `• ${g.leg_scores.map(formatLeg).join(" + ")}\n`;
      }
      if (aGrades.length > 5) msg += `  ...and ${aGrades.length - 5} more\n`;
      msg += "\n";
    }

    if (bGrades.length > 0 || cGrades.length > 0) {
      const fixed = [...bGrades, ...cGrades];
      msg += `⚠️ B/C-GRADE (${fixed.length} fixed):\n`;
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
      msg += `❌ VOIDED (${fGrades.length}):\n`;
      for (const g of fGrades.slice(0, 5)) {
        const reasons = g.leg_scores.flatMap(l => l.flags).filter((v, i, a) => a.indexOf(v) === i);
        msg += `• ${g.strategy} — ${reasons.join(", ")}\n`;
      }
      msg += "\n";
    }

    // Send to Telegram
    await supabase.functions.invoke("bot-send-telegram", {
      body: { type: "pick_dna", data: { message: msg } },
    });

    log("DNA audit complete and sent to Telegram");

    return new Response(JSON.stringify({
      success: true,
      total: parlays.length,
      voided: voidIds.length,
      fixed: updateParlays.length,
      grades: grades.map(g => ({ id: g.parlay_id, grade: g.grade, action: g.action })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

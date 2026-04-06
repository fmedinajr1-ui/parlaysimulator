import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[Self-Audit] ${msg}`);

  try {
    // 1. Load all active owner rules
    const { data: rules, error: rulesErr } = await supabase
      .from("bot_owner_rules")
      .select("*")
      .eq("is_active", true);

    if (rulesErr) throw rulesErr;
    if (!rules || rules.length === 0) {
      log("No active rules found — skipping audit");
      return new Response(JSON.stringify({ success: true, violations: 0, message: "No rules to audit" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log(`Loaded ${rules.length} active rules`);

    // 2. Get recent outputs from last 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    // Fetch recent parlays
    const { data: recentParlays } = await supabase
      .from("bot_daily_parlays")
      .select("*")
      .eq("parlay_date", today)
      .gte("created_at", thirtyMinAgo);

    // Fetch recent prediction accuracy entries  
    const { data: recentPredictions } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .gte("created_at", thirtyMinAgo)
      .limit(200);

    // Fetch recent engine tracker entries
    const { data: recentTracker } = await supabase
      .from("engine_live_tracker")
      .select("*")
      .gte("created_at", thirtyMinAgo)
      .limit(200);

    const violations: Array<{
      rule_key: string;
      violation_description: string;
      action_taken: string;
      affected_record_id: string;
      affected_table: string;
      metadata: Record<string, unknown>;
    }> = [];

    // 3. Apply each rule against recent outputs
    for (const rule of rules) {
      const logic = rule.rule_logic as Record<string, unknown>;

      // Rule: pitcher_k_follow_market
      if (rule.rule_key === "pitcher_k_follow_market") {
        const pitcherKTypes = (logic.prop_types as string[]) || ["pitcher_strikeouts", "pitcher_ks"];
        
        // Check prediction accuracy entries for pitcher K violations
        for (const pred of (recentPredictions || [])) {
          const pt = ((pred as any).prop_type || "").toLowerCase();
          if (!pitcherKTypes.some((k: string) => pt.includes(k))) continue;
          
          const direction = ((pred as any).direction || "").toLowerCase();
          const predictedSide = ((pred as any).predicted_side || (pred as any).recommended_side || "").toLowerCase();
          
          // Rising line should be OVER, dropping should be UNDER
          if (direction === "rising" && predictedSide === "under") {
            violations.push({
              rule_key: rule.rule_key,
              violation_description: `Pitcher K line rising but recommended UNDER for ${(pred as any).player_name || "unknown"} — should be OVER`,
              action_taken: rule.enforcement === "hard_block" ? "blocked" : "warned",
              affected_record_id: (pred as any).id || "",
              affected_table: "fanduel_prediction_accuracy",
              metadata: { player: (pred as any).player_name, prop_type: pt, direction, side: predictedSide },
            });
          } else if (direction === "dropping" && predictedSide === "over") {
            violations.push({
              rule_key: rule.rule_key,
              violation_description: `Pitcher K line dropping but recommended OVER for ${(pred as any).player_name || "unknown"} — should be UNDER`,
              action_taken: rule.enforcement === "hard_block" ? "blocked" : "warned",
              affected_record_id: (pred as any).id || "",
              affected_table: "fanduel_prediction_accuracy",
              metadata: { player: (pred as any).player_name, prop_type: pt, direction, side: predictedSide },
            });
          }
        }
      }

      // Rule: cross_ref_gate_mandatory
      if (rule.rule_key === "cross_ref_gate_mandatory") {
        for (const tracker of (recentTracker || [])) {
          const t = tracker as any;
          if (!t.prop_type || t.prop_type.startsWith("team_")) continue;
          
          const hitRate = t.l10_hit_rate || t.hit_rate_l10 || null;
          const l10Avg = t.l10_avg || null;
          const line = t.line || t.recommended_line || null;
          const side = ((t.side || t.recommended_side || "").toLowerCase());
          
          if (hitRate !== null && hitRate < 0.3 && l10Avg !== null && line !== null) {
            const l10Contradicts = (side === "over" && l10Avg < line * 0.9) || (side === "under" && l10Avg > line * 1.1);
            if (l10Contradicts) {
              violations.push({
                rule_key: rule.rule_key,
                violation_description: `${t.player_name}: L10 avg (${l10Avg}) contradicts ${side} ${line} with hit rate ${(hitRate * 100).toFixed(0)}%`,
                action_taken: rule.enforcement === "hard_block" ? "blocked" : "warned",
                affected_record_id: t.id || "",
                affected_table: "engine_live_tracker",
                metadata: { player: t.player_name, l10_avg: l10Avg, line, side, hit_rate: hitRate },
              });
            }
          }
        }
      }

      // Rule: cascade_needs_direction
      if (rule.rule_key === "cascade_needs_direction") {
        for (const pred of (recentPredictions || [])) {
          const p = pred as any;
          if (p.signal_type !== "cascade") continue;
          if (!p.dominant_direction && !p.recommended_side) {
            violations.push({
              rule_key: rule.rule_key,
              violation_description: `Cascade alert for ${p.player_name || p.event_description || "unknown"} missing dominant direction`,
              action_taken: "warned",
              affected_record_id: p.id || "",
              affected_table: "fanduel_prediction_accuracy",
              metadata: { signal: "cascade", player: p.player_name },
            });
          }
        }
      }

      // Rule: non_nba_follow_market
      if (rule.rule_key === "non_nba_follow_market") {
        const nonNbaSports = (logic.sports_excluded_from_regression as string[]) || ["NHL", "MLB", "NCAAB", "NCAAF", "NFL", "WNBA", "MLS"];
        for (const pred of (recentPredictions || [])) {
          const p = pred as any;
          if (!["take_it_now", "live_drift"].includes(p.signal_type)) continue;
          const sport = (p.sport || "").toUpperCase();
          if (!nonNbaSports.some((s: string) => sport.includes(s))) continue;
          
          // Check if regression was incorrectly applied (predicted_direction = "snapback" for non-NBA)
          if (p.predicted_direction === "snapback") {
            violations.push({
              rule_key: rule.rule_key,
              violation_description: `${p.player_name}: Regression/snapback logic used for ${p.sport} — should follow market direction`,
              action_taken: rule.enforcement === "hard_block" ? "blocked" : "warned",
              affected_record_id: p.id || "",
              affected_table: "fanduel_prediction_accuracy",
              metadata: { player: p.player_name, sport: p.sport, signal_type: p.signal_type, direction: p.predicted_direction },
            });
          }
        }
      }
    }

    // 4. Log all violations to bot_audit_log
    if (violations.length > 0) {
      const auditRows = violations.map((v) => ({
        rule_key: v.rule_key,
        violation_description: v.violation_description,
        action_taken: v.action_taken,
        affected_record_id: v.affected_record_id,
        affected_table: v.affected_table,
        metadata: v.metadata,
      }));

      await supabase.from("bot_audit_log").insert(auditRows);
      log(`Logged ${violations.length} violations to bot_audit_log`);
    }

    // 5. Send Telegram summary if violations found
    if (violations.length > 0) {
      const blocked = violations.filter((v) => v.action_taken === "blocked");
      const warned = violations.filter((v) => v.action_taken === "warned");

      const lines: string[] = [
        `🛡️ *Self-Audit Report*`,
        `${violations.length} violation(s) detected`,
        `🚫 Blocked: ${blocked.length} | ⚠️ Warned: ${warned.length}`,
        ``,
      ];

      for (const v of violations.slice(0, 8)) {
        lines.push(`${v.action_taken === "blocked" ? "🚫" : "⚠️"} [${v.rule_key}] ${v.violation_description}`);
      }
      if (violations.length > 8) {
        lines.push(`... and ${violations.length - 8} more`);
      }

      try {
        await supabase.functions.invoke("bot-send-telegram", {
          body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true },
        });
      } catch (_) { /* ignore */ }
    }

    // 6. Log to activity
    await supabase.from("bot_activity_log").insert({
      event_type: "self_audit",
      message: violations.length > 0
        ? `Self-audit found ${violations.length} violation(s)`
        : `Self-audit clean — ${rules.length} rules checked`,
      severity: violations.length > 0 ? "warning" : "info",
      metadata: {
        rules_checked: rules.length,
        violations: violations.length,
        recent_parlays: (recentParlays || []).length,
        recent_predictions: (recentPredictions || []).length,
        recent_tracker: (recentTracker || []).length,
      },
    });

    log(`Audit complete: ${violations.length} violations from ${rules.length} rules`);

    return new Response(JSON.stringify({
      success: true,
      rules_checked: rules.length,
      violations: violations.length,
      details: violations,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    log(`Fatal: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = formatter.format(now);

  console.log(`[Verdicts] Finalizing verdicts for ${today}`);

  try {
    // Get all snapshots for today
    const { data: snapshots, error: snapErr } = await supabase
      .from("mispriced_line_snapshots")
      .select("*")
      .eq("analysis_date", today)
      .order("scan_time", { ascending: true });

    if (snapErr) throw new Error(`Snapshot fetch error: ${snapErr.message}`);
    if (!snapshots || snapshots.length === 0) {
      console.log("[Verdicts] No snapshots found for today");
      return new Response(JSON.stringify({ success: true, verdicts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group snapshots by player|prop|sport
    const grouped = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      const key = `${snap.player_name}|${snap.prop_type}|${snap.sport}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(snap);
    }

    const verdicts: any[] = [];
    let steamCount = 0;
    let trapCount = 0;

    for (const [key, snaps] of grouped) {
      // Need at least 2 snapshots to detect movement
      if (snaps.length < 2) continue;

      const first = snaps[0]; // earliest
      const last = snaps[snaps.length - 1]; // latest

      const firstLine = Number(first.book_line);
      const lastLine = Number(last.book_line);
      const lineMovement = lastLine - firstLine;

      // Edge movement: if edge grew stronger in same direction = confirmation
      const firstEdge = Number(first.edge_pct);
      const lastEdge = Number(last.edge_pct);
      const edgeMovement = lastEdge - firstEdge;

      // Price movement proxy: use edge_pct difference as price movement indicator
      // Positive edgeMovement on OVER = line dropped (whale on over)
      // Negative edgeMovement on OVER = line went up (market faded)
      const signal = last.signal;
      const isOver = signal === "OVER";

      // Line moved in favor of the signal = STEAM
      // Line moved against = TRAP
      const lineInFavor = isOver
        ? lineMovement < -0.5 // line dropped = good for over
        : lineMovement > 0.5; // line went up = good for under

      const lineAgainst = isOver
        ? lineMovement > 0.5
        : lineMovement < -0.5;

      // Also check edge strengthening
      const edgeStrengthened = isOver
        ? lastEdge > firstEdge + 3
        : lastEdge < firstEdge - 3;

      let whaleSignal = "NONE";
      let verdict = "HOLD";
      let verdictReason = "";

      if (lineInFavor || edgeStrengthened) {
        // Strong steam: both line moved AND edge strengthened
        if (lineInFavor && edgeStrengthened) {
          whaleSignal = "STEAM";
          verdict = "SHARP_CONFIRMED";
          verdictReason = `Line moved ${Math.abs(lineMovement).toFixed(1)} pts in favor + edge grew ${Math.abs(edgeMovement).toFixed(0)}%`;
          steamCount++;
        } else if (Math.abs(lineMovement) >= 1.0 || Math.abs(edgeMovement) >= 8) {
          whaleSignal = "STEAM";
          verdict = "SHARP_CONFIRMED";
          verdictReason = lineInFavor
            ? `Line moved ${Math.abs(lineMovement).toFixed(1)} pts in favor`
            : `Edge strengthened ${Math.abs(edgeMovement).toFixed(0)}%`;
          steamCount++;
        } else {
          verdict = "HOLD";
          verdictReason = "Minor favorable movement — not conclusive";
        }
      } else if (lineAgainst) {
        if (Math.abs(lineMovement) >= 1.0) {
          whaleSignal = "FREEZE";
          verdict = "TRAP";
          verdictReason = `Line moved ${Math.abs(lineMovement).toFixed(1)} pts against signal — market faded`;
          trapCount++;
        } else {
          verdict = "HOLD";
          verdictReason = "Minor adverse movement";
        }
      } else {
        verdict = "HOLD";
        verdictReason = `No significant movement across ${snaps.length} scans`;
      }

      verdicts.push({
        player_name: first.player_name,
        prop_type: first.prop_type,
        sport: first.sport,
        analysis_date: today,
        first_scan_line: firstLine,
        first_scan_price: firstEdge,
        final_scan_line: lastLine,
        final_scan_price: lastEdge,
        price_movement: edgeMovement,
        line_movement: lineMovement,
        whale_signal: whaleSignal,
        verdict,
        verdict_reason: verdictReason,
      });
    }

    // Upsert verdicts
    if (verdicts.length > 0) {
      const chunkSize = 50;
      let inserted = 0;
      for (let i = 0; i < verdicts.length; i += chunkSize) {
        const chunk = verdicts.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("mispriced_line_verdicts")
          .upsert(chunk, { onConflict: "player_name,prop_type,analysis_date,sport" });
        if (error) {
          console.error(`[Verdicts] Upsert error:`, error.message);
        } else {
          inserted += chunk.length;
        }
      }
      console.log(`[Verdicts] Upserted ${inserted} verdicts (${steamCount} STEAM, ${trapCount} TRAP)`);
    }

    // ── Cross-reference against unified_props for real FanDuel lines ──
    const { data: liveProps } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, current_line, over_price, under_price")
      .eq("bookmaker", "fanduel");

    const liveLineMap = new Map<string, { line: number; over: number | null; under: number | null }>();
    for (const p of liveProps || []) {
      const key = `${p.player_name}|${p.prop_type}`;
      liveLineMap.set(key, { line: p.current_line, over: p.over_price, under: p.under_price });
    }

    // Send Telegram alert for STEAM/TRAP verdicts — only verified lines
    const actionable = verdicts.filter(v => v.verdict !== "HOLD");
    if (actionable.length > 0) {
      try {
        const dateLabel = new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "America/New_York",
        }).format(now);

        // Filter SHARP verdicts to only those with verified FanDuel lines
        const steamVerdicts = actionable
          .filter(v => v.verdict === "SHARP_CONFIRMED")
          .filter(v => {
            const key = `${v.player_name}|${v.prop_type}`;
            const live = liveLineMap.get(key);
            if (!live) {
              console.log(`[Verdicts] 🚫 Skipping ${v.player_name} ${v.prop_type} — no FanDuel line found`);
              return false;
            }
            return true;
          });
        const trapVerdicts = actionable.filter(v => v.verdict === "TRAP");

        const verifiedSteamCount = steamVerdicts.length;

        let msg = `🐋 *WHALE VERDICTS — ${dateLabel}*\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `${verifiedSteamCount} 🟢 SHARP | ${trapCount} 🔴 TRAP\n\n`;

        if (steamVerdicts.length > 0) {
          msg += `*🟢 SHARP CONFIRMED*\n`;
          for (const v of steamVerdicts.slice(0, 8)) {
            const propLabel = v.prop_type.replace(/^player_/, "").replace(/^batter_/, "").replace(/^pitcher_/, "").replace(/_/g, " ").toUpperCase();
            const key = `${v.player_name}|${v.prop_type}`;
            const live = liveLineMap.get(key)!;
            const side = v.price_movement > 0 ? "O" : "U";
            const odds = side === "O" ? live.over : live.under;
            const oddsStr = odds ? (odds > 0 ? ` (+${odds})` : ` (${odds})`) : "";
            msg += `• *${v.player_name}* ${propLabel} ${side} ${live.line}${oddsStr}\n`;
            msg += `  📗 FanDuel: ${live.line} | ${v.first_scan_line}→${v.final_scan_line} | ${v.verdict_reason}\n`;
          }
          msg += "\n";
        }

        if (trapVerdicts.length > 0) {
          msg += `*🔴 TRAP — MARKET FADED*\n`;
          for (const v of trapVerdicts.slice(0, 5)) {
            const propLabel = v.prop_type.replace(/^player_/, "").replace(/^batter_/, "").replace(/^pitcher_/, "").replace(/_/g, " ").toUpperCase();
            msg += `• *${v.player_name}* ${propLabel} — ${v.verdict_reason}\n`;
          }
        }

        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "custom",
            data: { message: msg },
          }),
        });
        console.log("[Verdicts] Telegram alert sent");
      } catch (teleErr) {
        console.error("[Verdicts] Telegram error:", teleErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_verdicts: verdicts.length,
        steam: steamCount,
        trap: trapCount,
        hold: verdicts.length - steamCount - trapCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Verdicts] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

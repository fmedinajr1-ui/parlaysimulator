import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrackedLeg {
  player_name: string;
  prop_type: string;
  side: string;
  line: number;
  initial_price: number | null;
  current_price: number | null;
  sport: string;
  event_id: string | null;
  commence_time: string | null;
  team: string | null;
}

interface PlayerMovement {
  player_name: string;
  prop_type: string;
  current_line: number;
  opening_line: number | null;
  direction: "rising" | "dropping" | "stable";
  magnitude: number;
}

function getVerdict(isSteaming: boolean, correlationRate: number, isFading: boolean): { emoji: string; label: string } {
  if (isSteaming && correlationRate >= 0.7) return { emoji: "✅", label: "CONFIRMED" };
  if (isSteaming && correlationRate >= 0.4) return { emoji: "⚠️", label: "PARTIAL" };
  if (isFading && correlationRate < 0.4) return { emoji: "🚨", label: "TRAP WARNING" };
  if (isFading) return { emoji: "⚠️", label: "CAUTION" };
  return { emoji: "➖", label: "NEUTRAL" };
}

function priceDirection(initial: number | null, current: number | null): { label: string; isSteaming: boolean; isFading: boolean } {
  if (!initial || !current) return { label: "no data", isSteaming: false, isFading: false };
  const diff = current - initial;
  // For negative odds: more negative = steaming (e.g., -152 → -170)
  // For positive odds: more positive could also mean movement
  if (Math.abs(diff) < 3) return { label: "stable", isSteaming: false, isFading: false };
  // Steaming = price getting more negative (stronger) for the picked side
  const isSteaming = current < initial; // e.g., -152 → -170
  const isFading = current > initial;   // e.g., -152 → -130
  const arrow = isSteaming ? "⬆️ steaming" : "⬇️ drifting back";
  return { label: arrow, isSteaming, isFading };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[Parlay Tracker Monitor] ${msg}`);

  try {
    // Fetch all active tracked parlays
    const { data: parlays, error: fetchErr } = await supabase
      .from("tracked_parlays")
      .select("*")
      .eq("status", "active");

    if (fetchErr) throw fetchErr;
    if (!parlays || parlays.length === 0) {
      log("No active tracked parlays");
      return new Response(JSON.stringify({ success: true, message: "No active parlays" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log(`Processing ${parlays.length} active tracked parlay(s)`);
    const now = new Date();

    for (const parlay of parlays) {
      const legs: TrackedLeg[] = parlay.legs || [];
      const chatId = parlay.chat_id;
      let allPastStart = true;
      let anyWithin30Min = false;

      const legReports: string[] = [];
      let confirmedCount = 0;
      let trapCount = 0;
      const snapshotEntry: any = { timestamp: now.toISOString(), legs: [] };

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const emoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][i] || `${i + 1}.`;

        // Check timing
        if (leg.commence_time) {
          const gameTime = new Date(leg.commence_time);
          const minutesUntil = (gameTime.getTime() - now.getTime()) / 60000;
          if (minutesUntil > 0) allPastStart = false;
          if (minutesUntil > 0 && minutesUntil <= 30) anyWithin30Min = true;
        }

        // Get current price from unified_props
        let currentPrice = leg.current_price;
        const { data: currentProps } = await supabase
          .from("unified_props")
          .select("*")
          .ilike("player_name", `%${leg.player_name}%`)
          .eq("prop_type", leg.prop_type)
          .limit(1);

        const currentProp = currentProps?.[0];
        if (currentProp) {
          currentPrice = leg.side === "over" ? currentProp.over_price : currentProp.under_price;
          // Update leg with current price
          legs[i] = { ...leg, current_price: currentPrice };
        }

        const { label: dirLabel, isSteaming, isFading } = priceDirection(leg.initial_price, currentPrice);

        // Team correlation scan — find all players in same event_id
        const teamPlayers: PlayerMovement[] = [];
        let correlationRate = 0;

        if (leg.event_id) {
          const { data: eventProps } = await supabase
            .from("unified_props")
            .select("player_name, prop_type, line, previous_line, team")
            .eq("event_id", leg.event_id);

          if (eventProps && eventProps.length > 0) {
            // Filter to same prop category or same team
            const relevantProps = eventProps.filter((p: any) =>
              p.prop_type === leg.prop_type ||
              (p.team && leg.team && p.team === leg.team)
            );

            for (const p of relevantProps) {
              if (p.player_name === leg.player_name && p.prop_type === leg.prop_type) continue;
              const prevLine = p.previous_line ?? p.line;
              const diff = p.line - prevLine;
              let direction: "rising" | "dropping" | "stable" = "stable";
              if (diff > 0.25) direction = "rising";
              else if (diff < -0.25) direction = "dropping";

              teamPlayers.push({
                player_name: p.player_name,
                prop_type: p.prop_type,
                current_line: p.line,
                opening_line: prevLine,
                direction,
                magnitude: Math.abs(diff),
              });
            }

            // Calculate correlation: what % of players are moving in the direction that supports the pick
            const supportDirection = leg.side === "over" ? "rising" : "dropping";
            const aligned = teamPlayers.filter(p => p.direction === supportDirection).length;
            const moving = teamPlayers.filter(p => p.direction !== "stable").length;
            correlationRate = moving > 0 ? aligned / moving : 0;
          }
        }

        const verdict = getVerdict(isSteaming, correlationRate, isFading);
        if (verdict.label === "CONFIRMED") confirmedCount++;
        if (verdict.label === "TRAP WARNING") trapCount++;

        // Build report for this leg
        const initialStr = leg.initial_price ? `${leg.initial_price > 0 ? "+" : ""}${leg.initial_price}` : "?";
        const currentStr = currentPrice ? `${currentPrice > 0 ? "+" : ""}${currentPrice}` : "?";

        const lines: string[] = [
          `${emoji} ${leg.player_name} ${leg.prop_type.replace(/_/g, " ").toUpperCase()} ${leg.side.toUpperCase()} ${leg.line}`,
          `   Open: ${initialStr} → Now: ${currentStr} (${dirLabel})`,
        ];

        // Add team correlation details
        if (teamPlayers.length > 0) {
          const supportDir = leg.side === "over" ? "RISING" : "DROPPING";
          const aligned = teamPlayers.filter(p => p.direction === (leg.side === "over" ? "rising" : "dropping")).length;
          lines.push(`   🔗 TEAM CORRELATION: ${aligned}/${teamPlayers.length} players ${supportDir}`);

          // Show top 3 movers
          const sorted = [...teamPlayers].sort((a, b) => b.magnitude - a.magnitude).slice(0, 3);
          for (const p of sorted) {
            const arrow = p.direction === "rising" ? "⬆️" : p.direction === "dropping" ? "⬇️" : "➖";
            const sign = p.direction === "rising" ? "+" : p.direction === "dropping" ? "-" : "";
            lines.push(`     ${p.player_name}: ${p.current_line} (${sign}${p.magnitude.toFixed(1)}) ${arrow}`);
          }

          const pct = Math.round(correlationRate * 100);
          lines.push(`   📊 ${pct}% aligned ${supportDir} → ${verdict.label} ${verdict.emoji}`);
        } else {
          lines.push(`   🔗 No team correlation data available`);
          lines.push(`   ${verdict.emoji} ${verdict.label}`);
        }

        legReports.push(lines.join("\n"));

        snapshotEntry.legs.push({
          player_name: leg.player_name,
          current_price: currentPrice,
          correlation_rate: correlationRate,
          team_players_count: teamPlayers.length,
          verdict: verdict.label,
        });
      }

      // Determine if this is a final verdict or regular update
      const isFinalVerdict = anyWithin30Min && !parlay.final_verdict_sent;

      const header = isFinalVerdict
        ? "🔒 *FINAL VERDICT — 30 min to tip*"
        : `📊 *PARLAY TRACKER* — ${now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET`;

      const footer = isFinalVerdict
        ? `\n🎯 Confidence: ${confirmedCount}/${legs.length} legs confirmed${trapCount > 0 ? ` | ⚠️ ${trapCount} trap warning(s)` : ""}\n💡 ${confirmedCount >= Math.ceil(legs.length / 2) ? "Recommend: PLAY ✅" : trapCount > 0 ? "Recommend: BAIL 🚨" : "Recommend: PLAY with caution ⚠️"}`
        : `\nOverall: ${confirmedCount}/${legs.length} legs confirmed by team correlation${trapCount > 0 ? ` | 🚨 ${trapCount} trap flag(s)` : " ✅"}`;

      const fullMessage = [header, "", ...legReports, footer].join("\n");

      // Send to Telegram
      try {
        await supabase.functions.invoke("bot-send-telegram", {
          body: { message: fullMessage, parse_mode: "Markdown", chat_id: chatId },
        });
        log(`Sent ${isFinalVerdict ? "FINAL VERDICT" : "update"} for tracker ${parlay.id}`);
      } catch (e: any) {
        log(`Telegram send failed for ${parlay.id}: ${e.message}`);
      }

      // Update the parlay record
      const updates: any = {
        legs,
        leg_snapshots: [...(parlay.leg_snapshots || []), snapshotEntry],
      };

      if (isFinalVerdict) {
        updates.final_verdict_sent = true;
      }

      if (allPastStart) {
        updates.status = "completed";
      }

      await supabase
        .from("tracked_parlays")
        .update(updates)
        .eq("id", parlay.id);
    }

    return new Response(JSON.stringify({
      success: true,
      processed: parlays.length,
      timestamp: now.toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

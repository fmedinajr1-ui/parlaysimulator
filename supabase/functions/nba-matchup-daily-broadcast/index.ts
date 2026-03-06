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
  const startTime = Date.now();

  const log = (msg: string) => console.log(`[nba-matchup-daily-broadcast] ${msg}`);

  try {
    // Step 1: Run the bidirectional matchup scanner
    log("Running bidirectional matchup scanner...");
    const { error: scanError } = await supabase.functions.invoke("bot-matchup-defense-scanner", { body: {} });
    if (scanError) {
      log(`Scanner error: ${JSON.stringify(scanError)}`);
    } else {
      log("✅ Scanner complete");
    }

    // Step 2: Query results
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    const { data: findings, error: queryError } = await supabase
      .from("bot_research_findings")
      .select("*")
      .eq("category", "matchup_defense_scan")
      .eq("research_date", today)
      .order("relevance_score", { ascending: false });

    if (queryError) {
      log(`Query error: ${JSON.stringify(queryError)}`);
      throw queryError;
    }

    if (!findings || findings.length === 0) {
      log("No matchup findings for today");
      await supabase.functions.invoke("bot-send-telegram", {
        body: {
          message: `🏀 NBA Bidirectional Matchup Scan — ${today}\n\n⚠️ No games or matchup data found for today.`,
          bypass_quiet_hours: true,
        },
      });
      return new Response(JSON.stringify({ success: true, findings: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 3: Extract recommendations from key_insights
    const insights = findings[0]?.key_insights as any;
    const recommendations: any[] = insights?.recommendations || [];

    if (recommendations.length === 0) {
      log("No recommendations in findings");
      await supabase.functions.invoke("bot-send-telegram", {
        body: {
          message: `🏀 NBA Bidirectional Matchup Scan — ${today}\n\n⚠️ Scanner ran but found no actionable matchups.`,
          bypass_quiet_hours: true,
        },
      });
      return new Response(JSON.stringify({ success: true, findings: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 4: Categorize and format with player-level validation
    const elite: any[] = [];
    const prime: any[] = [];
    const favorable: any[] = [];
    const avoid: any[] = [];
    const benchUnders: any[] = [];

    for (const rec of recommendations) {
      const label = rec.matchup_label || "neutral";
      const entry = {
        attacking_team: rec.attacking_team,
        defending_team: rec.defending_team,
        prop_type: rec.prop_type,
        side: rec.side,
        score: rec.matchup_score,
        offRank: rec.offense_rank,
        defRank: rec.defense_rank,
        player_backed: rec.player_backed || false,
        player_targets: rec.player_targets || [],
      };

      if (label === "elite") elite.push(entry);
      else if (label === "prime") prime.push(entry);
      else if (label === "favorable") favorable.push(entry);
      else if (label === "avoid") avoid.push(entry);
      else if (label === "bench_under") benchUnders.push(entry);
    }

    // Step 5: Format message with player-level detail
    const formatEntry = (i: any) => {
      const header = `  • ${i.attacking_team} ${capitalize(i.prop_type)} vs ${i.defending_team} DEF (Score: ${i.score})`;
      const ranks = `    OFF #${i.offRank} vs DEF #${i.defRank}`;

      if (i.player_targets && i.player_targets.length > 0) {
        const playerLines = i.player_targets.slice(0, 3).map((p: any) =>
          `      ✅ ${p.player_name} ${i.side.toUpperCase()} ${p.line} (L10: ${p.l10_avg} avg, ${p.l10_hit_rate}% hit, floor ${p.l10_min})`
        ).join("\n");
        return `${header}\n${ranks}\n${playerLines}`;
      } else {
        return `${header}\n${ranks}\n      ⚠️ Environment only — no individual player data supports this`;
      }
    };

    const formatSection = (emoji: string, headerText: string, items: any[]) => {
      if (items.length === 0) return "";
      const backed = items.filter(i => i.player_backed).length;
      const envOnly = items.length - backed;
      const lines = items.slice(0, 6).map(formatEntry).join("\n\n");
      const backingNote = backed > 0 ? `${backed} player-backed` : `⚠️ all environment-only`;
      return `${emoji} ${headerText} (${items.length} — ${backingNote})\n${lines}\n\n`;
    };

    const playerBackedTotal = recommendations.filter((r: any) => r.player_backed).length;
    const envOnlyTotal = recommendations.length - playerBackedTotal;

    const message = `🏀📊 NBA BIDIRECTIONAL MATCHUP SCAN — ${today}\n\n` +
      `${recommendations.length} matchups analyzed | ${playerBackedTotal} player-backed | ${envOnlyTotal} env-only\n` +
      `Score = (OppDefRank × 0.6) + ((31-TeamOffRank) × 0.4)\n\n` +
      formatSection("🔥", "ELITE (Score ≥22)", elite) +
      formatSection("⭐", "PRIME (Score 18-22)", prime) +
      formatSection("✅", "FAVORABLE (Score 14-18)", favorable) +
      formatSection("🚫", "AVOID (Score ≤8)", avoid) +
      `📋 Summary: ${elite.length} elite, ${prime.length} prime, ${favorable.length} favorable, ${avoid.length} avoid\n` +
      `🎯 Player-backed signals are validated against L10 game log data`;

    await supabase.functions.invoke("bot-send-telegram", {
      body: { message, bypass_quiet_hours: true },
    });

    const duration = Date.now() - startTime;
    log(`✅ Broadcast complete in ${duration}ms — ${recommendations.length} matchups, ${playerBackedTotal} player-backed`);

    await supabase.from("cron_job_history").insert({
      job_name: "nba-matchup-daily-broadcast",
      status: "completed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { total: recommendations.length, elite: elite.length, prime: prime.length, avoid: avoid.length, player_backed: playerBackedTotal },
    });

    return new Response(JSON.stringify({ success: true, findings: recommendations.length, elite: elite.length, prime: prime.length, player_backed: playerBackedTotal, duration }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    log(`Fatal error: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

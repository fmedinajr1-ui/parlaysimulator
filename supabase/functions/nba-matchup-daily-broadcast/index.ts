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

    // Step 3: Categorize findings
    const elite: any[] = [];
    const prime: any[] = [];
    const favorable: any[] = [];
    const avoid: any[] = [];

    for (const f of findings) {
      const insights = f.key_insights as any;
      const label = insights?.matchup_label || "neutral";
      const score = insights?.matchup_score || f.relevance_score || 0;

      const entry = {
        title: f.title,
        score,
        offRank: insights?.offense_rank,
        defRank: insights?.defense_rank,
        recs: insights?.prop_recommendations || [],
        label,
      };

      if (label === "elite") elite.push(entry);
      else if (label === "prime") prime.push(entry);
      else if (label === "favorable") favorable.push(entry);
      else if (label === "avoid") avoid.push(entry);
    }

    // Step 4: Format message
    const formatSection = (emoji: string, header: string, items: any[]) => {
      if (items.length === 0) return "";
      const lines = items.slice(0, 6).map(i =>
        `  • ${i.title} (Score: ${i.score})\n    OFF #${i.offRank} vs DEF #${i.defRank} → ${i.recs.join(", ")}`
      ).join("\n");
      return `${emoji} ${header} (${items.length})\n${lines}\n\n`;
    };

    const message = `🏀📊 NBA BIDIRECTIONAL MATCHUP SCAN — ${today}\n\n` +
      `${findings.length} matchups analyzed (Offense + Defense)\n` +
      `Score = (OppDefRank × 0.6) + ((31-TeamOffRank) × 0.4)\n\n` +
      formatSection("🔥", "ELITE (Score ≥22)", elite) +
      formatSection("⭐", "PRIME (Score 18-22)", prime) +
      formatSection("✅", "FAVORABLE (Score 14-18)", favorable) +
      formatSection("🚫", "AVOID (Score ≤8)", avoid) +
      `Total: ${elite.length} elite, ${prime.length} prime, ${favorable.length} favorable, ${avoid.length} avoid`;

    await supabase.functions.invoke("bot-send-telegram", {
      body: { message, bypass_quiet_hours: true },
    });

    const duration = Date.now() - startTime;
    log(`✅ Broadcast complete in ${duration}ms — ${findings.length} matchups`);

    await supabase.from("cron_job_history").insert({
      job_name: "nba-matchup-daily-broadcast",
      status: "completed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { total: findings.length, elite: elite.length, prime: prime.length, avoid: avoid.length },
    });

    return new Response(JSON.stringify({ success: true, findings: findings.length, elite: elite.length, prime: prime.length, duration }), {
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

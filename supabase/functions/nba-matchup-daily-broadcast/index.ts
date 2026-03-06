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

    const formatBenchUnderEntry = (i: any) => {
      const playerLines = i.player_targets.slice(0, 3).map((p: any) =>
        `  • ${p.player_name} UNDER ${p.line} ${capitalize(i.prop_type)} vs ${i.defending_team} (L10: ${p.l10_avg} avg, ${p.l10_hit_rate}% hit, ceiling ${p.player_name ? i.player_targets.find((t: any) => t.player_name === p.player_name)?.l10_min ?? '?' : '?'})`
      ).join("\n");
      return playerLines;
    };

    const formatSection = (emoji: string, headerText: string, items: any[]) => {
      if (items.length === 0) return "";
      const backed = items.filter(i => i.player_backed).length;
      const envOnly = items.length - backed;
      const lines = items.slice(0, 6).map(formatEntry).join("\n\n");
      const backingNote = backed > 0 ? `${backed} player-backed` : `⚠️ all environment-only`;
      return `${emoji} ${headerText} (${items.length} — ${backingNote})\n${lines}\n\n`;
    };

    // Format bench unders section — flatten all player targets
    const formatBenchUndersSection = (items: any[]) => {
      if (items.length === 0) return "";
      const allTargets: string[] = [];
      for (const item of items) {
        for (const p of (item.player_targets || []).slice(0, 3)) {
          allTargets.push(`  • ${p.player_name} UNDER ${p.line} ${capitalize(item.prop_type)} vs ${item.defending_team} (L10: ${p.l10_avg} avg, ${p.l10_hit_rate}% hit, margin ${p.margin})`);
        }
      }
      if (allTargets.length === 0) return "";
      return `📉 BENCH PLAYER UNDERS (${allTargets.length} player-backed)\n${allTargets.slice(0, 10).join("\n")}\n\n`;
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
      formatBenchUndersSection(benchUnders) +
      `📋 Summary: ${elite.length} elite, ${prime.length} prime, ${favorable.length} favorable, ${avoid.length} avoid, ${benchUnders.length} bench unders\n` +
      `🎯 Player-backed signals are validated against L10 game log data`;

    await supabase.functions.invoke("bot-send-telegram", {
      body: { message, bypass_quiet_hours: true },
    });

    // === PHASE: Create trackable bidirectional under parlays ===
    log("Building bidirectional bench under parlays...");

    // Load stake config
    const { data: stakeConfig } = await supabase
      .from("bot_stake_config").select("*").limit(1).maybeSingle();
    const execStake = stakeConfig?.execution_stake ?? 250;

    // Collect all strong under targets (80%+ L10 hit rate)
    const strongUnders: any[] = [];
    for (const item of benchUnders) {
      for (const p of (item.player_targets || [])) {
        if ((p.l10_hit_rate || 0) >= 80) {
          strongUnders.push({
            player_name: p.player_name,
            prop_type: item.prop_type,
            side: "UNDER",
            line: p.line,
            category: `NBA_${item.prop_type?.toUpperCase() || 'PROPS'}`,
            l10_hit_rate: p.l10_hit_rate / 100,
            l10_avg: p.l10_avg,
            l10_min: p.l10_min,
            l10_max: p.margin != null ? p.line - p.margin : null,
            defending_team: item.defending_team,
            quality_tier: p.l10_hit_rate >= 90 ? "elite" : "strong",
          });
        }
      }
    }

    log(`Found ${strongUnders.length} strong under targets (80%+ L10 hit rate)`);

    // Build 3-leg parlays from strong unders
    let underParlaysInserted = 0;
    if (strongUnders.length >= 3) {
      // Sort by hit rate descending
      strongUnders.sort((a: any, b: any) => (b.l10_hit_rate || 0) - (a.l10_hit_rate || 0));

      // Build up to 2 non-overlapping 3-leg parlays
      const usedPlayers = new Set<string>();
      for (let parlayIdx = 0; parlayIdx < 2 && strongUnders.length >= 3; parlayIdx++) {
        const available = strongUnders.filter((u: any) => !usedPlayers.has(u.player_name));
        if (available.length < 3) break;

        const selected = available.slice(0, 3);
        const legs = selected.map((u: any) => ({
          player: u.player_name,
          prop: u.prop_type,
          side: "UNDER",
          line: u.line,
          category: u.category,
          l10_hit_rate: u.l10_hit_rate,
          l10_avg: u.l10_avg,
          l10_min: u.l10_min,
          l10_max: u.l10_max,
          defending_team: u.defending_team,
          quality_tier: u.quality_tier,
        }));

        const combinedProb = selected.reduce((acc: number, u: any) => acc * (u.l10_hit_rate || 0.8), 1);
        const estimatedOdds = combinedProb > 0 ? Math.round((1 / combinedProb - 1) * 100) : 200;
        const stake = execStake;
        const payout = Math.round(stake * (estimatedOdds / 100 + 1) * 100) / 100;

        const { error: insertErr } = await supabase.from("bot_daily_parlays").insert({
          strategy_name: "bidirectional_bench_under",
          tier: "execution",
          parlay_date: today,
          legs,
          leg_count: legs.length,
          combined_probability: Math.round(combinedProb * 1000) / 1000,
          expected_odds: estimatedOdds,
          simulated_stake: stake,
          simulated_payout: payout,
          selection_rationale: `Bidirectional Bench Under: ${legs.length} UNDER legs from matchup scan with 80%+ L10 hit rates. Stake: $${stake}.`,
          is_simulated: true,
        });

        if (insertErr) {
          log(`Bench under parlay insert error: ${JSON.stringify(insertErr)}`);
        } else {
          underParlaysInserted++;
          selected.forEach((u: any) => usedPlayers.add(u.player_name));
        }
      }
    }

    log(`✅ Inserted ${underParlaysInserted} bidirectional bench under parlays`);
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

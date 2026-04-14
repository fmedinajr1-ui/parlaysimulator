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

    // Step 4: Categorize
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

    // Step 5: Format message with risk tags
    const formatEntry = (i: any) => {
      const header = `  • ${i.attacking_team} ${capitalize(i.prop_type)} vs ${i.defending_team} DEF (Score: ${i.score})`;
      const ranks = `    OFF #${i.offRank} vs DEF #${i.defRank}`;

      if (i.player_targets && i.player_targets.length > 0) {
        const playerLines = i.player_targets.slice(0, 3).map((p: any) => {
          // Base line with L10 stats
          let playerLine = `      ✅ ${p.player_name} ${i.side.toUpperCase()} ${p.line} (L10: ${p.l10_avg} avg, ${p.l10_hit_rate}% hit, floor ${p.l10_min})`;

          // FFG data
          const ffgScore = p.ffg_score ?? p.metadata?.ffg_score ?? null;
          const ffgLabel = p.ffg_label ?? p.metadata?.ffg_label ?? null;
          const l10Fga = p.l10_fga ?? p.metadata?.l10_fga ?? null;
          const l10_3pa = p.l10_3pa ?? p.metadata?.l10_3pa ?? null;

          if (ffgScore !== null && ffgLabel) {
            const ffgEmoji = ffgLabel === 'elite' ? '🔥' : ffgLabel === 'strong' ? '💪' : ffgLabel === 'weak' ? '⬇️' : '➖';
            let ffgPart = `FFG: ${ffgScore > 0 ? '+' : ''}${ffgScore} ${ffgEmoji} ${capitalize(ffgLabel)}`;
            if (l10Fga !== null || l10_3pa !== null) {
              const volParts: string[] = [];
              if (l10Fga !== null) volParts.push(`${l10Fga} FGA`);
              if (l10_3pa !== null) volParts.push(`${l10_3pa} 3PA`);
              ffgPart += ` (${volParts.join(', ')})`;
            }
            playerLine += ` | ${ffgPart}`;
          }

          // Risk tag rendering
          const riskTags: string[] = p.risk_tags || [];
          const l3Avg = p.l3_avg;

          if (riskTags.length > 0 || l3Avg !== null) {
            const contextParts: string[] = [];

            // L3 context
            if (l3Avg !== null) {
              const trendIcon = p.l3_trend === 'hot' ? '📈' : p.l3_trend === 'cold' ? '📉' : '➡️';
              contextParts.push(`L3: ${l3Avg} ${trendIcon}`);
            }

            // Blowout/spread context
            const blowoutTag = riskTags.find((t: string) => t.startsWith('BLOWOUT_RISK'));
            const spreadTag = riskTags.find((t: string) => t.startsWith('ELEVATED_SPREAD'));
            if (blowoutTag) {
              contextParts.push(`⚠️ ${blowoutTag}`);
            } else if (spreadTag) {
              contextParts.push(`🟡 ${spreadTag}`);
            }

            // L3 directional warnings
            if (riskTags.includes('L3_BELOW_LINE') && i.side === 'over') {
              contextParts.push('⚠️ L3 says UNDER');
            } else if (riskTags.includes('L3_ABOVE_LINE') && i.side === 'under') {
              contextParts.push('⚠️ L3 says OVER');
            } else if (riskTags.includes('L3_CONFIRMED')) {
              contextParts.push('✅ L3 CONFIRMED');
            }

            // Decline/surge
            if (riskTags.includes('L3_DECLINE')) {
              contextParts.push('📉 L3 DECLINE');
            }
            if (riskTags.includes('L3_SURGE')) {
              contextParts.push('📈 L3 SURGE');
            }

            if (contextParts.length > 0) {
              playerLine += `\n        (${contextParts.join(' | ')})`;
            }
          }

          return playerLine;
        }).join("\n");
        return `${header}\n${ranks}\n${playerLines}`;
      } else {
        return `${header}\n${ranks}\n      ⚠️ Environment only — no individual player data supports this`;
      }
    };

    const formatSection = (emoji: string, headerText: string, items: any[]) => {
      if (items.length === 0) return "";
      const backed = items.filter(i => i.player_backed).length;
      const backingNote = backed > 0 ? `${backed} player-backed` : `⚠️ all environment-only`;
      const lines = items.slice(0, 6).map(formatEntry).join("\n\n");
      return `${emoji} ${headerText} (${items.length} — ${backingNote})\n${lines}\n\n`;
    };

    // Format bench unders section
    const formatBenchUndersSection = (items: any[]) => {
      if (items.length === 0) return "";
      const allTargets: string[] = [];
      for (const item of items) {
        for (const p of (item.player_targets || []).slice(0, 3)) {
          let line = `  • ${p.player_name} UNDER ${p.line} ${capitalize(item.prop_type)} vs ${item.defending_team} (L10: ${p.l10_avg} avg, ${p.l10_hit_rate}% hit, margin ${p.margin})`;
          
          // Add risk tag context for bench unders too
          const riskTags: string[] = p.risk_tags || [];
          const contextParts: string[] = [];
          if (p.l3_avg !== null) {
            contextParts.push(`L3: ${p.l3_avg}`);
          }
          if (riskTags.includes('L3_CONFIRMED')) contextParts.push('✅');
          if (riskTags.includes('L3_ABOVE_LINE')) contextParts.push('⚠️ L3 says OVER');
          if (contextParts.length > 0) {
            line += ` (${contextParts.join(' | ')})`;
          }
          allTargets.push(line);
        }
      }
      if (allTargets.length === 0) return "";
      return `📉 BENCH PLAYER UNDERS (${allTargets.length} player-backed)\n${allTargets.slice(0, 10).join("\n")}\n\n`;
    };

    const playerBackedTotal = recommendations.filter((r: any) => r.player_backed).length;
    const envOnlyTotal = recommendations.length - playerBackedTotal;
    const riskTaggedTotal = recommendations.flatMap((r: any) => r.player_targets || []).filter((t: any) => t.risk_tags?.length > 0).length;

    // FFG summary counts
    const allPlayerTargets = recommendations.flatMap((r: any) => r.player_targets || []);
    const ffgEliteCount = allPlayerTargets.filter((t: any) => (t.ffg_label ?? t.metadata?.ffg_label) === 'elite').length;
    const ffgStrongCount = allPlayerTargets.filter((t: any) => (t.ffg_label ?? t.metadata?.ffg_label) === 'strong').length;
    const ffgSummary = (ffgEliteCount + ffgStrongCount) > 0
      ? `🎯 FFG: ${ffgEliteCount} elite, ${ffgStrongCount} strong volume targets\n`
      : '';

    const message = `🏀📊 NBA BIDIRECTIONAL MATCHUP SCAN — ${today}\n\n` +
      `${recommendations.length} matchups | ${playerBackedTotal} player-backed | ${riskTaggedTotal} risk-tagged\n` +
      ffgSummary +
      `Score = (OppDefRank × 0.6) + ((31-TeamOffRank) × 0.4)\n\n` +
      formatSection("🔥", "ELITE (Score ≥22)", elite) +
      formatSection("⭐", "PRIME (Score 18-22)", prime) +
      formatSection("✅", "FAVORABLE (Score 14-18)", favorable) +
      formatSection("🚫", "AVOID (Score ≤8)", avoid) +
      formatBenchUndersSection(benchUnders) +
      `📋 Summary: ${elite.length} elite, ${prime.length} prime, ${favorable.length} favorable, ${avoid.length} avoid, ${benchUnders.length} bench unders\n` +
      `🎯 Player-backed signals validated against L10 data\n` +
      `⚠️ Risk tags: check L3 trend + spread before placing\n` +
      `📊 FFG = Field Goal volume + efficiency vs defense gap`;

    await supabase.functions.invoke("bot-send-telegram", {
      body: { message, bypass_quiet_hours: true },
    });

    // === PHASE: Create trackable bidirectional under parlays ===
    log("Building bidirectional bench under parlays...");

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
            l3_avg: p.l3_avg ?? null,
            risk_tags: p.risk_tags || [],
          });
        }
      }
    }

    // Deduplicate strongUnders by player_name + prop_type (keep highest l10_hit_rate)
    const dedupMap = new Map<string, any>();
    for (const u of strongUnders) {
      const key = `${u.player_name}::${u.prop_type}`;
      if (!dedupMap.has(key) || u.l10_hit_rate > dedupMap.get(key).l10_hit_rate) {
        dedupMap.set(key, u);
      }
    }
    const dedupedUnders = [...dedupMap.values()];

    log(`Found ${strongUnders.length} raw strong under targets → ${dedupedUnders.length} after dedup`);

    // Build 3-leg parlays from strong unders
    let underParlaysInserted = 0;
    if (dedupedUnders.length >= 3) {
      dedupedUnders.sort((a: any, b: any) => (b.l10_hit_rate || 0) - (a.l10_hit_rate || 0));

      const usedPlayers = new Set<string>();
      for (let parlayIdx = 0; parlayIdx < 2 && dedupedUnders.length >= 3; parlayIdx++) {
        const available = dedupedUnders.filter((u: any) => !usedPlayers.has(u.player_name));
        if (available.length < 3) break;

        // Same-player guard: ensure unique player names in selected legs
        const selected: any[] = [];
        const selectedPlayers = new Set<string>();
        for (const u of available) {
          if (selectedPlayers.has(u.player_name)) continue;
          selected.push(u);
          selectedPlayers.add(u.player_name);
          if (selected.length >= 3) break;
        }
        if (selected.length < 3) break;

        const legs = selected.map((u: any) => ({
          player_name: u.player_name,
          player: u.player_name,
          prop_type: u.prop_type,
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
          l3_avg: u.l3_avg,
          risk_tags: u.risk_tags,
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

    const duration = Date.now() - startTime;
    log(`✅ Broadcast complete in ${duration}ms — ${recommendations.length} matchups, ${playerBackedTotal} player-backed, ${riskTaggedTotal} risk-tagged, ${underParlaysInserted} under parlays`);

    await supabase.from("cron_job_history").insert({
      job_name: "nba-matchup-daily-broadcast",
      status: "completed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { total: recommendations.length, elite: elite.length, prime: prime.length, avoid: avoid.length, player_backed: playerBackedTotal, risk_tagged: riskTaggedTotal, under_parlays: underParlaysInserted },
    });

    return new Response(JSON.stringify({ success: true, findings: recommendations.length, elite: elite.length, prime: prime.length, player_backed: playerBackedTotal, risk_tagged: riskTaggedTotal, under_parlays: underParlaysInserted, duration }), {
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

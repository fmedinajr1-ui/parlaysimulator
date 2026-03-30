import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Prop type mapping: matchup_history prop_type → fanduel_line_timeline prop_type
const PROP_MAP: Record<string, string> = {
  player_points: "player_points",
  player_threes: "player_threes",
  player_rebounds: "player_rebounds",
  player_assists: "player_assists",
};

// Reverse map for display
const PROP_LABEL: Record<string, string> = {
  player_points: "Points",
  player_threes: "3-Pointers",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
};

// Game log stat field for each prop type
const GAME_LOG_STAT: Record<string, string> = {
  player_points: "points",
  player_threes: "threes_made",
  player_rebounds: "rebounds",
  player_assists: "assists",
};

interface PerfectLineSignal {
  tier: "PERFECT" | "STRONG" | "LEAN";
  player_name: string;
  prop_type: string;
  line: number;
  over_price: number | null;
  under_price: number | null;
  opponent: string;
  avg_stat: number;
  min_stat: number;
  max_stat: number;
  games_played: number;
  hit_rate: number;
  edge_score: number;
  floor_gap: number;
  side: string;
  sport: string;
  event_id: string;
  event_description: string | null;
  hours_to_tip: number | null;
  // Recency data from game logs
  recent_games: number[];
  recent_avg: number | null;
  recency_boost: boolean;
}

function fmtOdds(price: number | null | undefined): string {
  if (!price) return "";
  return price > 0 ? `+${price}` : `${price}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[PerfectLineScanner] ${msg}`);
  const now = new Date();

  try {
    log("=== Starting Perfect Line Scan ===");

    // 1. Get latest FanDuel lines (most recent snapshot per player/prop)
    //    Only get lines for upcoming games (hours_to_tip > 0)
    const { data: latestLines, error: linesErr } = await supabase
      .from("fanduel_line_timeline")
      .select("*")
      .gt("hours_to_tip", -0.5) // include games about to start
      .order("snapshot_time", { ascending: false })
      .limit(2000);

    if (linesErr) throw new Error(`Lines fetch: ${linesErr.message}`);
    if (!latestLines || latestLines.length === 0) {
      log("No active FanDuel lines found");
      return new Response(JSON.stringify({ success: true, signals: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate: keep only the most recent snapshot per player+prop+event
    const latestByKey = new Map<string, any>();
    for (const row of latestLines) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, row);
      }
    }

    // Filter to prop types we can cross-reference
    const propLines = Array.from(latestByKey.values()).filter(
      (r: any) => PROP_MAP[r.prop_type]
    );
    log(`Found ${propLines.length} active prop lines to cross-reference`);

    if (propLines.length === 0) {
      return new Response(JSON.stringify({ success: true, signals: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Extract unique player names to look up matchup history
    const playerNames = [...new Set(propLines.map((r: any) => r.player_name))];

    // 3. Fetch matchup history for all relevant players
    const { data: matchups, error: matchErr } = await supabase
      .from("matchup_history")
      .select("*")
      .in("player_name", playerNames)
      .gte("games_played", 2);

    if (matchErr) log(`Matchup fetch warning: ${matchErr.message}`);

    // Build matchup lookup: player|opponent|prop_type → matchup record
    const matchupLookup = new Map<string, any>();
    for (const m of matchups || []) {
      const key = `${m.player_name.toLowerCase()}|${m.opponent.toLowerCase()}|${m.prop_type}`;
      matchupLookup.set(key, m);
    }
    log(`Loaded ${matchupLookup.size} matchup records`);

    // 4. Fetch recent game logs for recency weighting
    const { data: recentLogs, error: logErr } = await supabase
      .from("nba_player_game_logs")
      .select("player_name, opponent, game_date, points, rebounds, assists, threes_made, is_starter, is_home")
      .in("player_name", playerNames)
      .order("game_date", { ascending: false })
      .limit(5000);

    if (logErr) log(`Game logs fetch warning: ${logErr.message}`);

    // Build game log lookup: player|opponent → sorted game logs
    const gameLogLookup = new Map<string, any[]>();
    for (const gl of recentLogs || []) {
      const key = `${gl.player_name.toLowerCase()}|${gl.opponent?.toLowerCase()}`;
      if (!gameLogLookup.has(key)) gameLogLookup.set(key, []);
      gameLogLookup.get(key)!.push(gl);
    }

    // 5. Cross-reference lines against matchup history
    const signals: PerfectLineSignal[] = [];

    for (const line of propLines) {
      const propType = line.prop_type;
      const statField = GAME_LOG_STAT[propType];
      if (!statField) continue;

      const playerLower = line.player_name?.toLowerCase();
      if (!playerLower) continue;

      // Find matching matchup records for this player and prop type
      const matchingMatchups: any[] = [];
      for (const [key, m] of matchupLookup) {
        if (key.startsWith(`${playerLower}|`) && key.endsWith(`|${propType}`)) {
          matchingMatchups.push(m);
        }
      }

      const eventDesc = line.event_description?.toLowerCase() || "";

      for (const matchup of matchingMatchups) {
        const oppLower = matchup.opponent.toLowerCase();

        // Check if this opponent is in today's event
        if (!eventDesc.includes(oppLower) && !eventDesc.includes(oppLower.replace(/\s+/g, ""))) {
          const oppWords = oppLower.split(/\s+/);
          const anyMatch = oppWords.some((w: string) => w.length > 3 && eventDesc.includes(w));
          if (!anyMatch) continue;
        }

        const avgStat = Number(matchup.avg_stat);
        const minStat = Number(matchup.min_stat);
        const maxStat = Number(matchup.max_stat);
        const currentLine = Number(line.line);
        const gamesPlayed = matchup.games_played;

        if (!avgStat || !currentLine || currentLine <= 0) continue;

        const isOverValue = avgStat > currentLine;
        const side = isOverValue ? "OVER" : "UNDER";
        const hitRate = isOverValue
          ? Number(matchup.hit_rate_over || 0)
          : Number(matchup.hit_rate_under || 0);

        const edgeScore = ((avgStat - currentLine) / currentLine) * 100;
        const absEdge = Math.abs(edgeScore);
        const floorGap = isOverValue ? minStat - currentLine : currentLine - maxStat;

        const glKey = `${playerLower}|${oppLower}`;
        const gameLogs = gameLogLookup.get(glKey) || [];
        const recentStats = gameLogs.slice(0, 3).map((gl: any) => Number(gl[statField]) || 0);
        const recentAvg = recentStats.length > 0
          ? recentStats.reduce((a: number, b: number) => a + b, 0) / recentStats.length
          : null;

        const recencyBoost = recentAvg !== null && isOverValue
          ? recentAvg > avgStat
          : recentAvg !== null && !isOverValue
          ? recentAvg < avgStat
          : false;

        let tier: "PERFECT" | "STRONG" | "LEAN" | null = null;

        if (isOverValue) {
          if (absEdge >= 15 && floorGap >= 0 && hitRate >= 0.80 && gamesPlayed >= 3) {
            tier = "PERFECT";
          } else if (absEdge >= 10 && hitRate >= 0.65 && gamesPlayed >= 2) {
            tier = "STRONG";
          } else if (absEdge >= 5 && hitRate >= 0.55 && gamesPlayed >= 2) {
            tier = "LEAN";
          }
        } else {
          if (absEdge >= 15 && floorGap >= 0 && hitRate >= 0.80 && gamesPlayed >= 3) {
            tier = "PERFECT";
          } else if (absEdge >= 10 && hitRate >= 0.65 && gamesPlayed >= 2) {
            tier = "STRONG";
          } else if (absEdge >= 5 && hitRate >= 0.55 && gamesPlayed >= 2) {
            tier = "LEAN";
          }
        }

        if (!tier) continue;

        signals.push({
          tier,
          player_name: line.player_name,
          prop_type: propType,
          line: currentLine,
          over_price: line.over_price,
          under_price: line.under_price,
          opponent: matchup.opponent,
          avg_stat: avgStat,
          min_stat: minStat,
          max_stat: maxStat,
          games_played: gamesPlayed,
          hit_rate: hitRate,
          edge_score: edgeScore,
          floor_gap: floorGap,
          side,
          sport: line.sport || "basketball_nba",
          event_id: line.event_id,
          event_description: line.event_description,
          hours_to_tip: line.hours_to_tip,
          recent_games: recentStats,
          recent_avg: recentAvg,
          recency_boost: recencyBoost,
        });
      }
    }

    const tierOrder = { PERFECT: 0, STRONG: 1, LEAN: 2 };
    signals.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || Math.abs(b.edge_score) - Math.abs(a.edge_score));

    log(`Found ${signals.length} signals: ${signals.filter(s => s.tier === "PERFECT").length} PERFECT, ${signals.filter(s => s.tier === "STRONG").length} STRONG, ${signals.filter(s => s.tier === "LEAN").length} LEAN`);

    const alertSignals = signals.filter(s => s.tier === "PERFECT" || s.tier === "STRONG");

    if (alertSignals.length > 0) {
      const alerts: string[] = [];

      for (const s of alertSignals) {
        const tierEmoji = s.tier === "PERFECT" ? "🎯" : "🔵";
        const tierLabel = s.tier === "PERFECT" ? "PERFECT LINE" : "STRONG EDGE";
        const propLabel = PROP_LABEL[s.prop_type] || s.prop_type;
        const actionOdds = s.side === "OVER" ? s.over_price : s.under_price;
        const oddsStr = actionOdds ? ` (${fmtOdds(actionOdds)})` : "";
        const gapStr = s.edge_score > 0 ? `+${Math.abs(s.edge_score).toFixed(1)}%` : `${s.edge_score.toFixed(1)}%`;
        const floorStr = s.side === "OVER" && s.floor_gap >= 0
          ? `✅ Floor: ${s.min_stat} (ALWAYS clears)`
          : s.side === "OVER"
          ? `⚡ Floor: ${s.min_stat}`
          : `⚡ Ceiling: ${s.max_stat}`;
        const hitPct = (s.hit_rate * 100).toFixed(0);
        const hitFraction = `${Math.round(s.hit_rate * s.games_played)}/${s.games_played}`;

        const recencyLine = s.recent_games.length > 0
          ? `📅 Last ${s.recent_games.length} vs ${s.opponent}: ${s.recent_games.join(", ")}${s.recency_boost ? " 🔥 TRENDING" : ""}`
          : null;

        const alert = [
          `${tierEmoji} *${tierLabel} DETECTED*`,
          `${s.player_name} ${s.side} ${s.line} ${propLabel}${oddsStr}`,
          `📗 *FanDuel Line: ${s.line}${oddsStr}*`,
          `📊 vs ${s.opponent}: ${s.avg_stat} avg | ${hitFraction} ${s.side.toLowerCase()} | ${floorStr}`,
          `🔥 Historical: ${hitPct}% hit rate (${hitFraction} games)`,
          `✅ Gap: ${gapStr} above line`,
          recencyLine,
          `✅ *Action: ${s.side} ${s.line}${oddsStr}*`,
        ].filter(Boolean).join("\n");

        alerts.push(alert);
      }

      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;

      for (const alert of alerts) {
        const alertLen = alert.length + 2;
        if (currentPage.length > 0 && currentLen + alertLen > MAX_CHARS) {
          pages.push(currentPage);
          currentPage = [];
          currentLen = 0;
        }
        currentPage.push(alert);
        currentLen += alertLen;
      }
      if (currentPage.length > 0) pages.push(currentPage);

      for (let i = 0; i < pages.length; i++) {
        const pageLabel = pages.length > 1 ? ` (${i + 1}/${pages.length})` : "";
        const header = i === 0
          ? [`🎯 *Perfect Line Alerts*${pageLabel}`, `${alerts.length} matchup-based signal(s) — highest accuracy first`, ""]
          : [`🎯 *Perfect Lines${pageLabel}*`, ""];

        const msg = [...header, ...pages[i]].join("\n\n");

        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: msg, parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) {
          log(`Telegram error page ${i + 1}: ${tgErr.message}`);
        }
      }
    }

    const predictionRecords = signals.map(s => ({
      signal_type: `perfect_line_${s.tier.toLowerCase()}`,
      sport: s.sport,
      prop_type: s.prop_type,
      player_name: s.player_name,
      event_id: s.event_id,
      prediction: `${s.side} ${s.line}`,
      predicted_direction: s.side.toLowerCase(),
      predicted_magnitude: Math.abs(s.edge_score),
      confidence_at_signal: s.tier === "PERFECT" ? 90 : s.tier === "STRONG" ? 75 : 60,
      time_to_tip_hours: s.hours_to_tip,
      edge_at_signal: Math.abs(s.edge_score),
      signal_factors: {
        opponent: s.opponent,
        avg_stat: s.avg_stat,
        min_stat: s.min_stat,
        max_stat: s.max_stat,
        games_played: s.games_played,
        hit_rate: s.hit_rate,
        floor_gap: s.floor_gap,
        recent_games: s.recent_games,
        recent_avg: s.recent_avg,
        recency_boost: s.recency_boost,
      },
    }));

    if (predictionRecords.length > 0) {
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(predictionRecords);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    await supabase.from("cron_job_history").insert({
      job_name: "perfect-line-scanner",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: {
        lines_scanned: propLines.length,
        matchups_checked: matchupLookup.size,
        perfect: signals.filter(s => s.tier === "PERFECT").length,
        strong: signals.filter(s => s.tier === "STRONG").length,
        lean: signals.filter(s => s.tier === "LEAN").length,
        alerts_sent: alertSignals.length,
      },
    });

    log(`=== SCAN COMPLETE: ${signals.length} signals, ${alertSignals.length} alerts sent ===`);

    return new Response(
      JSON.stringify({
        success: true,
        signals: signals.length,
        alerts_sent: alertSignals.length,
        breakdown: {
          perfect: signals.filter(s => s.tier === "PERFECT").length,
          strong: signals.filter(s => s.tier === "STRONG").length,
          lean: signals.filter(s => s.tier === "LEAN").length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);

    await supabase.from("cron_job_history").insert({
      job_name: "perfect-line-scanner",
      status: "failed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      error_message: err.message,
    }).catch(() => {});

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

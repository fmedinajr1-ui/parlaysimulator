import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// detect-mispriced-lines  (FIXED)
//
// BUG 1 — MLB player_avg_l10 and player_avg_l20 fields were swapped.
//          player_avg_l10 was storing avgL20; player_avg_l20 was storing
//          avgSeason. Fixed to match the NBA field convention.
//
// BUG 2 — alignedEdgePct was not re-capped after team total boost (+8) and
//          intelligence multipliers (consensus +15%, feedback +20%). Cap is
//          now re-applied after all adjustments, just before the 15% gate.
//
// BUG 3 — Snapshot write was gated on mispricedResults.length > 0, so
//          correct-priced snapshots were silently lost on slow days. Snapshot
//          write now runs independently when either result set has rows.
//
// BUG 5 — feedbackAccuracy was reading outcome from mispriced_lines, but
//          nothing writes outcome back to that table. Changed to read from
//          fanduel_prediction_accuracy (which is actually settled) using
//          prop_type + sport as the join key.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NBA_PROP_TO_STAT: Record<string, string> = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_threes: "threes_made",
  player_blocks: "blocks",
  player_steals: "steals",
  player_turnovers: "turnovers",
  player_points_rebounds_assists: "pra",
  player_points_rebounds: "pr",
  player_points_assists: "pa",
  player_rebounds_assists: "ra",
  player_double_double: "double_double",
  player_triple_double: "triple_double",
};

const MLB_PROP_TO_STAT: Record<string, string> = {
  batter_hits: "hits",
  batter_rbis: "rbis",
  batter_runs_scored: "runs",
  batter_total_bases: "total_bases",
  batter_home_runs: "home_runs",
  batter_stolen_bases: "stolen_bases",
  pitcher_strikeouts: "pitcher_strikeouts",
  pitcher_outs: "pitcher_outs",
};

function getNbaStatValue(log: any, statKey: string): number | null {
  switch (statKey) {
    case "pra": return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
    case "pr":  return (log.points || 0) + (log.rebounds || 0);
    case "pa":  return (log.points || 0) + (log.assists || 0);
    case "ra":  return (log.rebounds || 0) + (log.assists || 0);
    case "double_double": {
      const cats = [log.points||0, log.rebounds||0, log.assists||0, log.steals||0, log.blocks||0];
      return cats.filter(v => v >= 10).length >= 2 ? 1 : 0;
    }
    case "triple_double": {
      const cats = [log.points||0, log.rebounds||0, log.assists||0, log.steals||0, log.blocks||0];
      return cats.filter(v => v >= 10).length >= 3 ? 1 : 0;
    }
    default: return log[statKey] ?? null;
  }
}

function getMlbStatValue(log: any, statKey: string): number | null {
  return log[statKey] ?? null;
}

function calcAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calcShootingContext(logs: any[]): Record<string, number | null> {
  let fgm=0, fga=0, ftm=0, fta=0, tpm=0, tpa=0;
  for (const log of logs) {
    fgm += log.field_goals_made || 0; fga += log.field_goals_attempted || 0;
    ftm += log.free_throws_made || 0; fta += log.free_throws_attempted || 0;
    tpm += log.threes_made || 0; tpa += log.threes_attempted || 0;
  }
  return {
    fg_pct:  fga > 0 ? Math.round((fgm/fga)*1000)/10 : null,
    ft_pct:  fta > 0 ? Math.round((ftm/fta)*1000)/10 : null,
    three_pct: tpa > 0 ? Math.round((tpm/tpa)*1000)/10 : null,
    avg_fgm: logs.length > 0 ? Math.round((fgm/logs.length)*10)/10 : null,
    avg_fga: logs.length > 0 ? Math.round((fga/logs.length)*10)/10 : null,
    avg_ftm: logs.length > 0 ? Math.round((ftm/logs.length)*10)/10 : null,
    avg_fta: logs.length > 0 ? Math.round((fta/logs.length)*10)/10 : null,
    avg_3pm: logs.length > 0 ? Math.round((tpm/logs.length)*10)/10 : null,
    avg_3pa: logs.length > 0 ? Math.round((tpa/logs.length)*10)/10 : null,
    avg_oreb: logs.length > 0 ? Math.round(calcAvg(logs.map(l => l.offensive_rebounds||0))*10)/10 : null,
    avg_dreb: logs.length > 0 ? Math.round(calcAvg(logs.map(l => l.defensive_rebounds||0))*10)/10 : null,
  };
}

function calcBaseballContext(logs: any[]): Record<string, number | null> {
  let totalHits=0, totalAB=0, totalWalks=0, totalTB=0;
  let totalRBIs=0, totalRuns=0, totalHR=0, totalSB=0;
  for (const log of logs) {
    totalHits  += log.hits||0;  totalAB    += log.at_bats||0;
    totalWalks += log.walks||0; totalTB    += log.total_bases||0;
    totalRBIs  += log.rbis||0;  totalRuns  += log.runs||0;
    totalHR    += log.home_runs||0; totalSB += log.stolen_bases||0;
  }
  const n = logs.length || 1;
  const avg = totalAB > 0 ? totalHits/totalAB : null;
  const obp = (totalAB+totalWalks) > 0 ? (totalHits+totalWalks)/(totalAB+totalWalks) : null;
  const slg = totalAB > 0 ? totalTB/totalAB : null;
  const ops = (obp !== null && slg !== null) ? obp+slg : null;
  return {
    avg: avg !== null ? Math.round(avg*1000)/1000 : null,
    obp: obp !== null ? Math.round(obp*1000)/1000 : null,
    slg: slg !== null ? Math.round(slg*1000)/1000 : null,
    ops: ops !== null ? Math.round(ops*1000)/1000 : null,
    avg_hits:        Math.round((totalHits/n)*10)/10,
    avg_rbis:        Math.round((totalRBIs/n)*10)/10,
    avg_total_bases: Math.round((totalTB/n)*10)/10,
    avg_runs:        Math.round((totalRuns/n)*10)/10,
    avg_hr:          Math.round((totalHR/n)*10)/10,
    avg_sb:          Math.round((totalSB/n)*10)/10,
  };
}

function getConfidenceTier(edgePct: number, gamesPlayed: number): string {
  const absEdge = Math.abs(edgePct);
  if (gamesPlayed < 5) return "LOW";
  if (absEdge >= 30 && gamesPlayed >= 15) return "ELITE";
  if (absEdge >= 20 && gamesPlayed >= 10) return "HIGH";
  if (absEdge >= 15) return "MEDIUM";
  return "LOW";
}

function calcCV(values: number[]): number {
  if (values.length < 3) return 0;
  const avg = calcAvg(values);
  if (avg === 0) return 0;
  const variance = values.reduce((s,v) => s + (v-avg)**2, 0) / values.length;
  return Math.sqrt(variance) / avg;
}

function getVarianceDampener(cv: number): number {
  if (cv > 0.50) return 0.60;
  if (cv > 0.35) return 0.80;
  return 1.0;
}

function getFeedbackMultiplier(accuracy: number | null): number {
  if (accuracy === null) return 1.0;
  if (accuracy >= 80) return 1.20;
  if (accuracy >= 60) return 1.0;
  if (accuracy >= 40) return 0.90;
  return 0.80;
}

const PROP_TO_DEFENSE_CATEGORY: Record<string, string> = {
  player_points: "points", player_rebounds: "rebounds",
  player_assists: "assists", player_threes: "threes",
  player_blocks: "overall", player_steals: "overall",
  player_turnovers: "overall", player_points_rebounds_assists: "overall",
  player_points_rebounds: "overall", player_points_assists: "overall",
  player_rebounds_assists: "overall", player_double_double: "overall",
  player_triple_double: "overall",
};

function getDefenseMultiplier(rank: number | null, signal: string): number {
  if (rank === null) return 1.0;
  const isOver = signal === "OVER";
  if (rank <= 5)  return isOver ? 0.94 : 1.04;
  if (rank <= 10) return isOver ? 0.97 : 1.02;
  if (rank <= 20) return 1.0;
  if (rank <= 25) return isOver ? 1.02 : 0.98;
  return isOver ? 1.04 : 0.96;
}

// BUG 2 FIX: cap helper applied after all adjustments
function capEdge(v: number): number {
  return Math.max(-75, Math.min(75, v));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    const fourteenDaysAgo = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000));

    console.log(`[Mispriced] Starting analysis for ${today}`);

    const mispricedResults: any[] = [];
    const correctPricedResults: any[] = [];
    const processedKeys = new Set<string>();

    // ── Load team total signals ───────────────────────────────────────────────
    const { data: teamTotalBets } = await supabase
      .from("game_bets")
      .select("home_team, away_team, recommended_side, composite_score, line, sport")
      .eq("bet_type", "total").eq("is_active", true)
      .in("sport", ["basketball_nba", "basketball_ncaab"])
      .gt("commence_time", now.toISOString());

    const teamTotalMap = new Map<string, { side: string; compositeScore: number; line: number; sport: string }>();
    for (const tb of teamTotalBets || []) {
      if (!tb.recommended_side || !tb.composite_score) continue;
      const entry = { side: tb.recommended_side.toUpperCase(), compositeScore: Number(tb.composite_score), line: Number(tb.line||0), sport: tb.sport||"" };
      if (tb.home_team) teamTotalMap.set(tb.home_team.toLowerCase(), entry);
      if (tb.away_team) teamTotalMap.set(tb.away_team.toLowerCase(), entry);
    }

    // ── Load NBA props ────────────────────────────────────────────────────────
    const { data: nbaProps, error: nbaPropsError } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, current_line, bookmaker, commence_time")
      .eq("sport", "basketball_nba")
      .gt("commence_time", now.toISOString())
      .not("player_name", "is", null)
      .not("current_line", "is", null);
    if (nbaPropsError) throw new Error(`NBA props: ${nbaPropsError.message}`);

    // ── Load defense data ─────────────────────────────────────────────────────
    const { data: todayGames } = await supabase
      .from("game_bets").select("home_team, away_team")
      .eq("sport", "basketball_nba").gt("commence_time", now.toISOString());

    const teamToOpponent: Record<string, string> = {};
    for (const g of todayGames || []) {
      if (g.home_team && g.away_team) {
        teamToOpponent[g.home_team.toLowerCase()] = g.away_team;
        teamToOpponent[g.away_team.toLowerCase()] = g.home_team;
      }
    }

    const { data: defenseStats } = await supabase
      .from("nba_opponent_defense_stats").select("team_name, stat_category, defense_rank");
    const defenseRankMap: Record<string, number> = {};
    for (const d of defenseStats || []) {
      defenseRankMap[`${d.team_name.toLowerCase()}_${d.stat_category}`] = d.defense_rank;
    }

    const { data: playerTeams } = await supabase
      .from("bdl_player_cache").select("player_name, team_name").not("team_name", "is", null);
    const playerTeamMap: Record<string, string> = {};
    for (const p of playerTeams || []) { if (p.team_name) playerTeamMap[p.player_name] = p.team_name; }

    // ── Load intelligence upgrade data ────────────────────────────────────────
    const [sweetSpotsRes, allPropsRes, feedbackRes] = await Promise.all([
      supabase.from("category_sweet_spots")
        .select("player_name, prop_type, l10_hit_rate, recommended_side")
        .eq("analysis_date", today).not("l10_hit_rate", "is", null),
      supabase.from("unified_props")
        .select("player_name, prop_type, current_line, bookmaker")
        .gt("commence_time", now.toISOString())
        .not("player_name", "is", null).not("current_line", "is", null),
      // BUG 5 FIX: read from fanduel_prediction_accuracy (actually settled)
      // instead of mispriced_lines.outcome (never written to)
      supabase.from("fanduel_prediction_accuracy")
        .select("prop_type, sport, was_correct")
        .gte("verified_at", `${fourteenDaysAgo}T00:00:00`)
        .not("was_correct", "is", null)
        .neq("actual_outcome", "informational_excluded"),
    ]);

    const sweetSpotHitRates = new Map<string, number>();
    for (const ss of sweetSpotsRes.data || []) {
      sweetSpotHitRates.set(`${(ss.player_name||"").toLowerCase()}|${ss.prop_type}`, ss.l10_hit_rate||0);
    }

    const linesByKey = new Map<string, number[]>();
    for (const p of allPropsRes.data || []) {
      const key = `${(p.player_name||"").toLowerCase()}|${p.prop_type}`;
      if (!linesByKey.has(key)) linesByKey.set(key, []);
      linesByKey.get(key)!.push(Number(p.current_line));
    }
    const consensusMap = new Map<string, number>();
    for (const [key, lines] of linesByKey) {
      if (lines.length < 2) continue;
      lines.sort((a,b) => a-b);
      const mid = Math.floor(lines.length/2);
      consensusMap.set(key, lines.length%2===0 ? (lines[mid-1]+lines[mid])/2 : lines[mid]);
    }

    // BUG 5 FIX: build feedback from actual settlement outcomes
    const feedbackMap = new Map<string, { hits: number; total: number }>();
    for (const f of feedbackRes.data || []) {
      const key = `${f.prop_type}|${f.sport||""}`;
      if (!feedbackMap.has(key)) feedbackMap.set(key, { hits: 0, total: 0 });
      const entry = feedbackMap.get(key)!;
      entry.total++;
      if (f.was_correct === true) entry.hits++;
    }
    const feedbackAccuracy = new Map<string, number>();
    for (const [key, val] of feedbackMap) {
      if (val.total >= 5) feedbackAccuracy.set(key, Math.round((val.hits/val.total)*100));
    }

    // ── NBA analysis ──────────────────────────────────────────────────────────
    let nbaCount = 0;
    if (nbaProps && nbaProps.length > 0) {
      const uniqueNbaPlayers = [...new Set(nbaProps.map(p => p.player_name).filter(Boolean))];
      const nbaPlayerLogs: Record<string, any[]> = {};
      for (let i = 0; i < uniqueNbaPlayers.length; i += 20) {
        const batch = uniqueNbaPlayers.slice(i, i+20);
        const { data: logs } = await supabase
          .from("nba_player_game_logs").select("*")
          .in("player_name", batch)
          .order("game_date", { ascending: false }).limit(400);
        for (const log of logs || []) {
          if (!nbaPlayerLogs[log.player_name]) nbaPlayerLogs[log.player_name] = [];
          if (nbaPlayerLogs[log.player_name].length < 20) nbaPlayerLogs[log.player_name].push(log);
        }
      }

      for (const prop of nbaProps) {
        if (!prop.player_name || !prop.current_line || !prop.prop_type) continue;
        const statKey = NBA_PROP_TO_STAT[prop.prop_type];
        if (!statKey) continue;
        const dedupKey = `nba_${prop.player_name}_${prop.prop_type}`;
        if (processedKeys.has(dedupKey)) continue;
        processedKeys.add(dedupKey);

        const logs = nbaPlayerLogs[prop.player_name];
        if (!logs || logs.length < 3) continue;

        const l10Logs = logs.slice(0, Math.min(10, logs.length));
        const l20Logs = logs.slice(0, Math.min(20, logs.length));
        const l5Logs  = logs.slice(0, Math.min(5,  logs.length));
        const l3Logs  = logs.slice(0, Math.min(3,  logs.length));

        const l10Values = l10Logs.map(l => getNbaStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l20Values = l20Logs.map(l => getNbaStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l5Values  = l5Logs.map(l => getNbaStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l3Values  = l3Logs.map(l => getNbaStatValue(l, statKey)).filter((v): v is number => v !== null);
        if (l10Values.length < 3) continue;

        const avgL10 = calcAvg(l10Values);
        const avgL20 = calcAvg(l20Values);
        const avgL5  = calcAvg(l5Values);
        const avgL3  = l3Values.length >= 3 ? calcAvg(l3Values) : null;
        const line = Number(prop.current_line);
        if (line === 0) continue;

        // Binary props (DD/TD)
        const isBinaryProp = statKey === "double_double" || statKey === "triple_double";
        if (isBinaryProp) {
          const frequency = avgL10;
          let edgePct = capEdge((frequency - 0.5) * 100);
          if (Math.abs(edgePct) < 3) continue;
          const signal = edgePct > 0 ? "OVER" : "UNDER";
          const confidenceTier = getConfidenceTier(edgePct, l10Values.length);
          const resultEntry = {
            player_name: prop.player_name, prop_type: prop.prop_type, book_line: line,
            player_avg_l10: Math.round(frequency*100)/100, player_avg_l20: Math.round(avgL20*100)/100,
            edge_pct: Math.round(edgePct*100)/100, signal,
            shooting_context: { frequency_l10: Math.round(frequency*1000)/10, frequency_l20: Math.round(avgL20*1000)/10, frequency_l5: Math.round(avgL5*1000)/10, games_analyzed: l20Values.length, is_binary: true },
            confidence_tier: confidenceTier, analysis_date: today, sport: "basketball_nba",
          };
          if (Math.abs(edgePct) >= 15) { mispricedResults.push(resultEntry); nbaCount++; }
          else correctPricedResults.push(resultEntry);
          continue;
        }

        // Continuous props
        const MIN_LINES: Record<string, number> = {
          player_points:5.5, player_rebounds:2.5, player_assists:1.5,
          player_threes:0.5, player_blocks:1.5, player_steals:1.5, player_turnovers:0.5,
          player_points_rebounds_assists:10.5, player_pra:10.5,
          player_points_rebounds:5.5, player_pr:5.5,
          player_points_assists:5.5, player_pa:5.5,
          player_rebounds_assists:3.5, player_ra:3.5,
        };
        const minLine = MIN_LINES[prop.prop_type?.toLowerCase()] ?? 0.5;
        if (line < minLine) continue;

        const rawEdgePct = ((avgL10 - line) / line) * 100;
        const rawSignal = rawEdgePct > 0 ? "OVER" : "UNDER";

        const playerTeam = playerTeamMap[prop.player_name];
        const opponentTeam = playerTeam ? teamToOpponent[playerTeam.toLowerCase()] : null;
        const defCategory = PROP_TO_DEFENSE_CATEGORY[prop.prop_type] || "overall";
        const opponentDefRank = opponentTeam ? (defenseRankMap[`${opponentTeam.toLowerCase()}_${defCategory}`] ?? null) : null;
        const defMultiplier = getDefenseMultiplier(opponentDefRank, rawSignal);
        const adjustedAvg = avgL10 * defMultiplier;

        let edgePct = capEdge(((adjustedAvg - line) / line) * 100);
        const trendEdge = ((avgL5 - avgL20) / (avgL20 || 1)) * 100;
        if (Math.abs(edgePct) < 3) continue;

        const signal = edgePct > 0 ? "OVER" : "UNDER";
        const shootingContext = calcShootingContext(l20Logs);
        const confidenceTier = getConfidenceTier(edgePct, l10Values.length);

        // Team total alignment
        let teamTotalSignal: string | null = null;
        let teamTotalAlignment: string | null = null;
        let alignedEdgePct = edgePct;
        let alignedTier = confidenceTier;
        const totalEntry = teamTotalMap.get(playerTeam?.toLowerCase() || "");
        if (totalEntry) {
          teamTotalSignal = totalEntry.side;
          const isAligned = signal === totalEntry.side;
          const isConflict = signal !== totalEntry.side;
          if (isAligned && totalEntry.compositeScore >= 75) {
            teamTotalAlignment = "aligned"; alignedEdgePct += 8;
          } else if (isConflict) {
            teamTotalAlignment = "conflict";
            if (totalEntry.compositeScore >= 80) alignedEdgePct -= (signal === "OVER" ? 12 : 10);
            else alignedEdgePct -= 8;
            if (signal === "OVER" && totalEntry.compositeScore >= 80) {
              if (alignedTier === "ELITE") alignedTier = "HIGH";
              else if (alignedTier === "HIGH") alignedTier = "MEDIUM";
            }
          } else {
            teamTotalAlignment = "neutral";
          }
        }

        // L3 recency gate
        let l3EdgePct: number | null = null;
        let l3Confirms: boolean | null = null;
        if (avgL3 !== null) {
          const adjustedAvgL3 = avgL3 * defMultiplier;
          l3EdgePct = capEdge(((adjustedAvgL3 - line) / line) * 100);
          l3Confirms = (signal === "OVER" && l3EdgePct > 0) || (signal === "UNDER" && l3EdgePct < 0);
          alignedEdgePct = l3Confirms
            ? alignedEdgePct * 0.6 + l3EdgePct * 0.4
            : alignedEdgePct * 0.5;
        }

        // Variance filter
        const varianceCV = calcCV(l10Values);
        const varianceDampener = getVarianceDampener(varianceCV);
        if (varianceDampener < 1.0) alignedEdgePct *= varianceDampener;

        // Historical hit-rate cross-ref
        const ssKey = `${prop.player_name.toLowerCase()}|${prop.prop_type}`;
        const historicalHitRate = sweetSpotHitRates.get(ssKey) ?? null;
        if (historicalHitRate !== null && historicalHitRate < 60) alignedEdgePct *= 0.70;

        // Minutes stability
        const l10Minutes = l10Logs.map(l => { const m = parseFloat(String(l.min||0)); return m > 0 ? m : null; }).filter((v): v is number => v !== null);
        const l3Minutes  = l3Logs.map(l => { const m = parseFloat(String(l.min||0)); return m > 0 ? m : null; }).filter((v): v is number => v !== null);
        let minutesStability: number | null = null;
        if (l10Minutes.length >= 5 && l3Minutes.length >= 3) {
          const avgL10Min = calcAvg(l10Minutes);
          minutesStability = avgL10Min > 0 ? calcAvg(l3Minutes) / avgL10Min : null;
          if (minutesStability !== null && minutesStability < 0.80) alignedEdgePct *= 0.75;
        }

        // Cross-book consensus
        const consensusLine = consensusMap.get(`${prop.player_name.toLowerCase()}|${prop.prop_type}`) ?? null;
        let consensusDeviation: number | null = null;
        if (consensusLine !== null && consensusLine > 0) {
          consensusDeviation = Math.abs(line - consensusLine) / consensusLine * 100;
          if (consensusDeviation > 5) alignedEdgePct *= 1.15;
        }

        // Outcome feedback (BUG 5 FIX: reads from fanduel_prediction_accuracy)
        const fbKey = `${prop.prop_type}|basketball_nba`;
        const propAccuracy = feedbackAccuracy.get(fbKey) ?? null;
        const feedbackMult = getFeedbackMultiplier(propAccuracy);
        if (feedbackMult !== 1.0) alignedEdgePct *= feedbackMult;

        // BUG 2 FIX: re-cap after all adjustments
        alignedEdgePct = capEdge(alignedEdgePct);

        alignedTier = getConfidenceTier(alignedEdgePct, l10Values.length);
        if (Math.abs(alignedEdgePct) < 3) continue;

        const resultEntry = {
          player_name: prop.player_name, prop_type: prop.prop_type, book_line: line,
          player_avg_l10: Math.round(avgL10*100)/100,
          player_avg_l20: Math.round(avgL20*100)/100,
          edge_pct: Math.round(alignedEdgePct*100)/100, signal,
          shooting_context: {
            ...shootingContext,
            l3_avg: avgL3 !== null ? Math.round(avgL3*10)/10 : undefined,
            l3_edge_pct: l3EdgePct !== null ? Math.round(l3EdgePct*10)/10 : undefined,
            l3_confirms: l3Confirms, l5_avg: Math.round(avgL5*10)/10,
            l10_avg: Math.round(avgL10*10)/10, l20_avg: Math.round(avgL20*10)/10,
            trend_pct: Math.round(trendEdge*10)/10, games_analyzed: l20Values.length,
            defense_multiplier: defMultiplier !== 1.0 ? defMultiplier : undefined,
            variance_cv: Math.round(varianceCV*1000)/1000, historical_hit_rate: historicalHitRate,
            minutes_stability: minutesStability !== null ? Math.round(minutesStability*100)/100 : undefined,
            consensus_line: consensusLine,
            consensus_deviation_pct: consensusDeviation !== null ? Math.round(consensusDeviation*10)/10 : undefined,
            feedback_accuracy: propAccuracy,
            feedback_multiplier: feedbackMult !== 1.0 ? feedbackMult : undefined,
          },
          confidence_tier: alignedTier, analysis_date: today, sport: "basketball_nba",
          defense_adjusted_avg: defMultiplier !== 1.0 ? Math.round(adjustedAvg*100)/100 : null,
          opponent_defense_rank: opponentDefRank, team_total_signal: teamTotalSignal,
          team_total_alignment: teamTotalAlignment,
        };

        if (Math.abs(alignedEdgePct) >= 15) { mispricedResults.push(resultEntry); nbaCount++; }
        else correctPricedResults.push(resultEntry);
      }
    }
    console.log(`[Mispriced] NBA: ${nbaCount} mispriced`);

    // ── MLB analysis ──────────────────────────────────────────────────────────
    let mlbCount = 0;
    const { data: mlbProps, error: mlbPropsError } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, current_line, bookmaker, commence_time")
      .eq("sport", "baseball_mlb")
      .gt("commence_time", now.toISOString())
      .not("player_name", "is", null).not("current_line", "is", null);
    if (mlbPropsError) throw new Error(`MLB props: ${mlbPropsError.message}`);

    if (mlbProps && mlbProps.length > 0) {
      const uniqueMlbPlayers = [...new Set(mlbProps.map(p => p.player_name).filter(Boolean))];
      const mlbPlayerLogs: Record<string, any[]> = {};
      for (let i = 0; i < uniqueMlbPlayers.length; i += 20) {
        const batch = uniqueMlbPlayers.slice(i, i+20);
        const { data: logs } = await supabase
          .from("mlb_player_game_logs").select("*")
          .in("player_name", batch)
          .order("game_date", { ascending: false }).limit(1000);
        for (const log of logs || []) {
          if (!mlbPlayerLogs[log.player_name]) mlbPlayerLogs[log.player_name] = [];
          mlbPlayerLogs[log.player_name].push(log);
        }
      }

      for (const prop of mlbProps) {
        if (!prop.player_name || !prop.current_line || !prop.prop_type) continue;
        const statKey = MLB_PROP_TO_STAT[prop.prop_type];
        if (!statKey) continue;
        const dedupKey = `mlb_${prop.player_name}_${prop.prop_type}`;
        if (processedKeys.has(dedupKey)) continue;
        processedKeys.add(dedupKey);

        const allLogs = mlbPlayerLogs[prop.player_name];
        if (!allLogs || allLogs.length < 10) continue;

        const l20Logs = allLogs.slice(0, Math.min(20, allLogs.length));
        const l3Logs  = allLogs.slice(0, Math.min(3, allLogs.length));
        const seasonLogs = allLogs;

        const seasonValues = seasonLogs.map(l => getMlbStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l20Values = l20Logs.map(l => getMlbStatValue(l, statKey)).filter((v): v is number => v !== null);
        const l3Values  = l3Logs.map(l => getMlbStatValue(l, statKey)).filter((v): v is number => v !== null);
        if (seasonValues.length < 10) continue;

        const avgSeason = calcAvg(seasonValues);
        const avgL20 = calcAvg(l20Values);
        const avgL3 = l3Values.length >= 3 ? calcAvg(l3Values) : null;
        const line = Number(prop.current_line);
        if (line === 0) continue;

        let edgePct = capEdge(((avgSeason - line) / line) * 100);
        const trendEdge = ((avgL20 - avgSeason) / (avgSeason || 1)) * 100;
        if (Math.abs(edgePct) < 3) continue;

        const signal = edgePct > 0 ? "OVER" : "UNDER";
        const baseballContext = calcBaseballContext(seasonLogs);
        const confidenceTier = getConfidenceTier(edgePct, seasonValues.length);

        // L3 recency gate
        let l3EdgePct: number | null = null;
        let l3Confirms: boolean | null = null;
        if (avgL3 !== null) {
          l3EdgePct = capEdge(((avgL3 - line) / line) * 100);
          l3Confirms = (signal === "OVER" && l3EdgePct > 0) || (signal === "UNDER" && l3EdgePct < 0);
          edgePct = l3Confirms ? edgePct*0.6 + l3EdgePct*0.4 : edgePct*0.5;
        }

        // Intelligence upgrades
        const mlbCV = calcCV(l20Values.length >= 10 ? l20Values : seasonValues.slice(0, 20));
        edgePct *= getVarianceDampener(mlbCV);

        const mlbHitRate = sweetSpotHitRates.get(`${prop.player_name.toLowerCase()}|${prop.prop_type}`) ?? null;
        if (mlbHitRate !== null && mlbHitRate < 60) edgePct *= 0.70;

        const mlbConsensus = consensusMap.get(`${prop.player_name.toLowerCase()}|${prop.prop_type}`) ?? null;
        let mlbConsDev: number | null = null;
        if (mlbConsensus !== null && mlbConsensus > 0) {
          mlbConsDev = Math.abs(line - mlbConsensus) / mlbConsensus * 100;
          if (mlbConsDev > 5) edgePct *= 1.15;
        }

        const mlbAccuracy = feedbackAccuracy.get(`${prop.prop_type}|baseball_mlb`) ?? null;
        const mlbFbMult = getFeedbackMultiplier(mlbAccuracy);
        if (mlbFbMult !== 1.0) edgePct *= mlbFbMult;

        // BUG 2 FIX: re-cap after all adjustments
        edgePct = capEdge(edgePct);

        const mlbFinalTier = getConfidenceTier(edgePct, seasonValues.length);
        if (Math.abs(edgePct) < 3) continue;

        const mlbEntry = {
          player_name: prop.player_name, prop_type: prop.prop_type, book_line: line,
          // BUG 1 FIX: correct field assignments (was swapped)
          player_avg_l10: Math.round(avgL20*100)/100,    // L20 avg = recent sample label
          player_avg_l20: Math.round(avgSeason*100)/100, // season avg = longer window label
          edge_pct: Math.round(edgePct*100)/100, signal,
          shooting_context: {
            ...baseballContext,
            l3_avg: avgL3 !== null ? Math.round(avgL3*10)/10 : undefined,
            l3_edge_pct: l3EdgePct !== null ? Math.round(l3EdgePct*10)/10 : undefined,
            l3_confirms: l3Confirms, l20_avg: Math.round(avgL20*10)/10,
            season_avg: Math.round(avgSeason*10)/10, trend_pct: Math.round(trendEdge*10)/10,
            games_analyzed: seasonValues.length, variance_cv: Math.round(mlbCV*1000)/1000,
            historical_hit_rate: mlbHitRate, consensus_line: mlbConsensus,
            consensus_deviation_pct: mlbConsDev !== null ? Math.round(mlbConsDev*10)/10 : undefined,
            feedback_accuracy: mlbAccuracy, feedback_multiplier: mlbFbMult !== 1.0 ? mlbFbMult : undefined,
          },
          confidence_tier: mlbFinalTier, analysis_date: today, sport: "baseball_mlb",
        };

        if (Math.abs(edgePct) >= 15) { mispricedResults.push(mlbEntry); mlbCount++; }
        else correctPricedResults.push(mlbEntry);
      }
    }
    console.log(`[Mispriced] MLB: ${mlbCount} mispriced`);

    // ── Persist correct-priced results ────────────────────────────────────────
    if (correctPricedResults.length > 0) {
      await supabase.from("correct_priced_lines").delete().eq("analysis_date", today);
      const chunkSize = 50;
      let cpInserted = 0;
      for (let i = 0; i < correctPricedResults.length; i += chunkSize) {
        const { error } = await supabase.from("correct_priced_lines")
          .upsert(correctPricedResults.slice(i, i+chunkSize), { onConflict: "player_name,prop_type,analysis_date,sport" });
        if (!error) cpInserted += Math.min(chunkSize, correctPricedResults.length - i);
      }
      console.log(`[CorrectPriced] Inserted ${cpInserted}`);
    }

    // ── Persist mispriced results ─────────────────────────────────────────────
    if (mispricedResults.length > 0) {
      await supabase.from("mispriced_lines").delete().eq("analysis_date", today);
      const chunkSize = 50;
      let inserted = 0;
      for (let i = 0; i < mispricedResults.length; i += chunkSize) {
        const { error } = await supabase.from("mispriced_lines")
          .upsert(mispricedResults.slice(i, i+chunkSize), { onConflict: "player_name,prop_type,analysis_date,sport" });
        if (!error) inserted += Math.min(chunkSize, mispricedResults.length - i);
      }
      console.log(`[Mispriced] Inserted ${inserted}`);
    }

    // ── BUG 3 FIX: snapshots run independently of mispricedResults count ─────
    const allResults = [...mispricedResults, ...correctPricedResults];
    if (allResults.length > 0) {
      const chunkSize = 50;
      const snapshotRows = allResults.map(r => ({
        player_name: r.player_name, prop_type: r.prop_type, sport: r.sport,
        book_line: r.book_line, edge_pct: r.edge_pct, signal: r.signal,
        confidence_tier: r.confidence_tier, shooting_context: r.shooting_context,
        scan_time: new Date().toISOString(), analysis_date: today,
      }));
      let snapshotInserted = 0;
      for (let i = 0; i < snapshotRows.length; i += chunkSize) {
        const { error } = await supabase.from("mispriced_line_snapshots").insert(snapshotRows.slice(i, i+chunkSize));
        if (!error) snapshotInserted += Math.min(chunkSize, snapshotRows.length - i);
      }
      console.log(`[Mispriced] Inserted ${snapshotInserted} snapshots`);
    }

    // ── Telegram report ───────────────────────────────────────────────────────
    if (mispricedResults.length > 0) {
      try {
        const topByTier: Record<string, any[]> = { ELITE: [], HIGH: [], MEDIUM: [] };
        for (const r of mispricedResults) {
          if (topByTier[r.confidence_tier]) topByTier[r.confidence_tier].push({ player_name: r.player_name, prop_type: r.prop_type, book_line: r.book_line, player_avg: r.player_avg_l10, edge_pct: r.edge_pct, signal: r.signal, sport: r.sport });
        }
        for (const tier of Object.keys(topByTier)) topByTier[tier].sort((a,b) => Math.abs(b.edge_pct) - Math.abs(a.edge_pct));

        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: "POST",
          headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "mispriced_lines_report",
            data: {
              nbaCount, mlbCount,
              overCount: mispricedResults.filter(r => r.signal === "OVER").length,
              underCount: mispricedResults.filter(r => r.signal === "UNDER").length,
              totalCount: mispricedResults.length, topByTier,
            },
          }),
        });

        // Trigger high conviction analyzer
        await fetch(`${supabaseUrl}/functions/v1/high-conviction-analyzer`, {
          method: "POST",
          headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).catch(e => console.error("[Mispriced] High conviction trigger failed:", e));
      } catch (teleErr) {
        console.error("[Mispriced] Telegram failed:", teleErr);
      }
    }

    const duration = Date.now() - startTime;
    await supabase.from("cron_job_history").insert({
      job_name: "detect-mispriced-lines", status: "completed",
      started_at: new Date(startTime).toISOString(), completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { props_analyzed: processedKeys.size, mispriced_found: mispricedResults.length, nba: { count: nbaCount }, mlb: { count: mlbCount }, by_signal: { OVER: mispricedResults.filter(r => r.signal==="OVER").length, UNDER: mispricedResults.filter(r => r.signal==="UNDER").length } },
    });

    return new Response(JSON.stringify({
      success: true, duration_ms: duration, props_analyzed: processedKeys.size,
      mispriced_found: mispricedResults.length, correct_priced_found: correctPricedResults.length,
      nba_count: nbaCount, mlb_count: mlbCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Mispriced] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

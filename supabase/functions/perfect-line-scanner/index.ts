import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── PLAYER PROP CONFIG ──
const PROP_MAP: Record<string, string> = {
  player_points: "player_points",
  player_threes: "player_threes",
  player_rebounds: "player_rebounds",
  player_assists: "player_assists",
};
const PROP_LABEL: Record<string, string> = {
  player_points: "Points",
  player_threes: "3-Pointers",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  moneyline: "Moneyline",
  totals: "Game Total",
  spreads: "Spread",
};
const GAME_LOG_STAT: Record<string, string> = {
  player_points: "points",
  player_threes: "threes_made",
  player_rebounds: "rebounds",
  player_assists: "assists",
};

// ── TEAM MARKET CONFIG ──
const TEAM_MARKET_TYPES = new Set(["moneyline", "totals", "spreads"]);
const SPORT_DB_MAP: Record<string, string> = {
  basketball_nba: "NBA",
  basketball_ncaab: "NCAAB",
  icehockey_nhl: "NHL",
  baseball_mlb: "MLB",
  NBA: "NBA",
  NCAAB: "NCAAB",
  NHL: "NHL",
  MLB: "MLB",
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
  recent_games: number[];
  recent_avg: number | null;
  recency_boost: boolean;
  market_type: "player_prop" | "team_market";
  // Team market extras
  team_record?: string;
  win_pct?: number;
  ppg?: number;
  oppg?: number;
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
    log("=== Starting Perfect Line Scan (All Sports + Team Markets) ===");

    // 1. Get latest FanDuel lines
    const { data: latestLines, error: linesErr } = await supabase
      .from("fanduel_line_timeline")
      .select("*")
      .gt("hours_to_tip", -0.5)
      .order("snapshot_time", { ascending: false })
      .limit(3000);

    if (linesErr) throw new Error(`Lines fetch: ${linesErr.message}`);
    if (!latestLines || latestLines.length === 0) {
      log("No active FanDuel lines found");
      return new Response(JSON.stringify({ success: true, signals: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate: most recent snapshot per player+prop+event
    const latestByKey = new Map<string, any>();
    for (const row of latestLines) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!latestByKey.has(key)) latestByKey.set(key, row);
    }

    const allLines = Array.from(latestByKey.values());
    const propLines = allLines.filter((r: any) => PROP_MAP[r.prop_type]);
    const teamLines = allLines.filter((r: any) => TEAM_MARKET_TYPES.has(r.prop_type));
    log(`Lines: ${propLines.length} player props, ${teamLines.length} team markets`);

    // ══════════════════════════════════════════════
    // PART A: PLAYER PROP SCANNING (existing logic)
    // ══════════════════════════════════════════════
    const playerNames = [...new Set(propLines.map((r: any) => r.player_name))];

    const [matchupsRes, recentLogsRes] = await Promise.all([
      supabase.from("matchup_history").select("*").in("player_name", playerNames).gte("games_played", 2),
      supabase.from("nba_player_game_logs")
        .select("player_name, opponent, game_date, points, rebounds, assists, threes_made, is_starter, is_home")
        .in("player_name", playerNames).order("game_date", { ascending: false }).limit(5000),
    ]);

    const matchups = matchupsRes.data || [];
    const recentLogs = recentLogsRes.data || [];

    const matchupLookup = new Map<string, any>();
    for (const m of matchups) {
      matchupLookup.set(`${m.player_name.toLowerCase()}|${m.opponent.toLowerCase()}|${m.prop_type}`, m);
    }

    const gameLogLookup = new Map<string, any[]>();
    for (const gl of recentLogs) {
      const key = `${gl.player_name.toLowerCase()}|${gl.opponent?.toLowerCase()}`;
      if (!gameLogLookup.has(key)) gameLogLookup.set(key, []);
      gameLogLookup.get(key)!.push(gl);
    }

    const signals: PerfectLineSignal[] = [];

    // Scan player props
    for (const line of propLines) {
      const propType = line.prop_type;
      const statField = GAME_LOG_STAT[propType];
      if (!statField) continue;

      const playerLower = line.player_name?.toLowerCase();
      if (!playerLower) continue;

      const matchingMatchups: any[] = [];
      for (const [key, m] of matchupLookup) {
        if (key.startsWith(`${playerLower}|`) && key.endsWith(`|${propType}`)) {
          matchingMatchups.push(m);
        }
      }

      const eventDesc = line.event_description?.toLowerCase() || "";

      for (const matchup of matchingMatchups) {
        const oppLower = matchup.opponent.toLowerCase();
        if (!eventDesc.includes(oppLower)) {
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
        const hitRate = isOverValue ? Number(matchup.hit_rate_over || 0) : Number(matchup.hit_rate_under || 0);

        const edgeScore = ((avgStat - currentLine) / currentLine) * 100;
        const absEdge = Math.abs(edgeScore);
        const floorGap = isOverValue ? minStat - currentLine : currentLine - maxStat;

        const glKey = `${playerLower}|${oppLower}`;
        const gameLogs = gameLogLookup.get(glKey) || [];
        const recentStats = gameLogs.slice(0, 3).map((gl: any) => Number(gl[statField]) || 0);
        const recentAvg = recentStats.length > 0
          ? recentStats.reduce((a: number, b: number) => a + b, 0) / recentStats.length : null;
        const recencyBoost = recentAvg !== null && isOverValue ? recentAvg > avgStat
          : recentAvg !== null && !isOverValue ? recentAvg < avgStat : false;

        let tier: "PERFECT" | "STRONG" | "LEAN" | null = null;
        if (absEdge >= 18 && floorGap >= 0 && hitRate >= 0.85 && gamesPlayed >= 3) tier = "PERFECT";
        else if (absEdge >= 12 && hitRate >= 0.70 && gamesPlayed >= 3) tier = "STRONG";
        else if (absEdge >= 7 && hitRate >= 0.60 && gamesPlayed >= 3) tier = "LEAN";
        if (!tier) continue;

        // Block Points and Assists from LEAN tier — historically underperform dramatically
        if (tier === "LEAN" && (propType === "player_points" || propType === "player_assists")) {
          log(`Blocking LEAN ${propType} for ${line.player_name} — prop type underperforms at LEAN tier`);
          continue;
        }

        signals.push({
          tier, player_name: line.player_name, prop_type: propType,
          line: currentLine, over_price: line.over_price, under_price: line.under_price,
          opponent: matchup.opponent, avg_stat: avgStat, min_stat: minStat, max_stat: maxStat,
          games_played: gamesPlayed, hit_rate: hitRate, edge_score: edgeScore, floor_gap: floorGap,
          side, sport: line.sport || "basketball_nba", event_id: line.event_id,
          event_description: line.event_description, hours_to_tip: line.hours_to_tip,
          recent_games: recentStats, recent_avg: recentAvg, recency_boost: recencyBoost,
          market_type: "player_prop",
        });
      }
    }

    // ══════════════════════════════════════════════
    // PART B: TEAM MARKET SCANNING (totals, ML, spreads)
    // ══════════════════════════════════════════════
    log(`--- Scanning ${teamLines.length} team market lines ---`);

    // Fetch all team reference data in parallel
    const [aliasesRes, standingsRes, ncaabRes, nhlRes] = await Promise.all([
      supabase.from("team_aliases").select("team_name, aliases, sport, team_abbreviation"),
      supabase.from("team_season_standings").select("team_name, sport, wins, losses, win_pct, points_for, points_against, home_record, away_record"),
      supabase.from("ncaab_team_stats").select("team_name, ppg, oppg, adj_offense, adj_defense, adj_tempo, over_under_record, home_record, away_record"),
      supabase.from("nhl_team_pace_stats").select("team_name, goals_for_per_game, goals_against_per_game, wins, losses, ot_losses"),
    ]);

    const aliases = aliasesRes.data || [];
    const standings = standingsRes.data || [];
    const ncaabTeams = ncaabRes.data || [];
    const nhlTeams = nhlRes.data || [];

    // Build team lookup: normalize team name → stats
    const teamStatsLookup = new Map<string, any>();

    for (const s of standings) {
      const ppg = s.points_for ? Number(s.points_for) : null;
      const oppg = s.points_against ? Number(s.points_against) : null;
      teamStatsLookup.set(s.team_name.toLowerCase(), {
        team_name: s.team_name, sport: s.sport, wins: s.wins, losses: s.losses,
        win_pct: Number(s.win_pct || 0), ppg, oppg, home_record: s.home_record, away_record: s.away_record,
      });
    }

    for (const t of ncaabTeams) {
      teamStatsLookup.set(t.team_name.toLowerCase(), {
        team_name: t.team_name, sport: "NCAAB", wins: null, losses: null,
        win_pct: null, ppg: Number(t.ppg || 0), oppg: Number(t.oppg || 0),
        home_record: t.home_record, away_record: t.away_record,
        adj_offense: t.adj_offense, adj_defense: t.adj_defense, ou_record: t.over_under_record,
      });
    }

    for (const t of nhlTeams) {
      const totalGames = (t.wins || 0) + (t.losses || 0) + (t.ot_losses || 0);
      teamStatsLookup.set(t.team_name.toLowerCase(), {
        team_name: t.team_name, sport: "NHL", wins: t.wins, losses: t.losses,
        win_pct: totalGames > 0 ? t.wins / totalGames : 0,
        ppg: Number(t.goals_for_per_game || 0), oppg: Number(t.goals_against_per_game || 0),
      });
    }

    // Build alias resolver: any alias → canonical team name
    const aliasToTeam = new Map<string, string>();
    for (const a of aliases) {
      aliasToTeam.set(a.team_name.toLowerCase(), a.team_name);
      if (a.team_abbreviation) aliasToTeam.set(a.team_abbreviation.toLowerCase(), a.team_name);
      if (a.aliases) {
        try {
          const aliasList = typeof a.aliases === "string" ? JSON.parse(a.aliases) : a.aliases;
          for (const al of aliasList) {
            if (typeof al === "string") aliasToTeam.set(al.toLowerCase(), a.team_name);
          }
        } catch {}
      }
    }

    // Resolve team name from FanDuel player_name field
    const resolveTeam = (fdName: string): string | null => {
      const lower = fdName.toLowerCase();
      if (aliasToTeam.has(lower)) return aliasToTeam.get(lower)!;
      // Try partial match
      for (const [alias, canonical] of aliasToTeam) {
        if (lower.includes(alias) || alias.includes(lower)) return canonical;
      }
      // Try word-level match
      const words = lower.split(/\s+/);
      for (const w of words) {
        if (w.length > 3 && aliasToTeam.has(w)) return aliasToTeam.get(w)!;
      }
      return null;
    };

    // Find the opponent for a team line from the event
    const findOpponent = (line: any, teamName: string): string | null => {
      const eventDesc = line.event_description || "";
      const parts = eventDesc.split(/\s+vs?\s+/i);
      if (parts.length !== 2) return null;
      const resolved0 = resolveTeam(parts[0].trim());
      const resolved1 = resolveTeam(parts[1].trim());
      if (resolved0?.toLowerCase() === teamName.toLowerCase() && resolved1) return resolved1;
      if (resolved1?.toLowerCase() === teamName.toLowerCase() && resolved0) return resolved0;
      return null;
    };

    // Process team market lines
    for (const line of teamLines) {
      const teamName = resolveTeam(line.player_name);
      if (!teamName) continue;

      const teamStats = teamStatsLookup.get(teamName.toLowerCase());
      if (!teamStats) continue;

      const opponent = findOpponent(line, teamName);
      const oppStats = opponent ? teamStatsLookup.get(opponent.toLowerCase()) : null;

      const currentLine = Number(line.line);
      const propType = line.prop_type;

      if (propType === "totals") {
        // ── GAME TOTALS: predicted total = teamPPG + oppPPG (or oppOPPG proxy)
        if (!teamStats.ppg || !oppStats?.ppg) continue;

        const predictedTotal = teamStats.ppg + oppStats.ppg;
        if (currentLine <= 0 || !predictedTotal) continue;

        const isOverValue = predictedTotal > currentLine;
        const side = isOverValue ? "OVER" : "UNDER";
        const edgeScore = ((predictedTotal - currentLine) / currentLine) * 100;
        const absEdge = Math.abs(edgeScore);

        // For totals, also check defensive matchup
        const offVsDef = teamStats.ppg + (oppStats.oppg || oppStats.ppg);
        const defVsOff = oppStats.ppg + (teamStats.oppg || teamStats.ppg);
        const avgProjected = (offVsDef + defVsOff) / 2;
        const refinedEdge = ((avgProjected - currentLine) / currentLine) * 100;

        // Use NCAAB O/U record if available
        let ouHitRate = 0.5;
        if (teamStats.ou_record) {
          const parts = String(teamStats.ou_record).split("-");
          if (parts.length >= 2) {
            const oWins = parseInt(parts[0]) || 0;
            const oLosses = parseInt(parts[1]) || 0;
            if (oWins + oLosses > 0) {
              ouHitRate = isOverValue ? oWins / (oWins + oLosses) : oLosses / (oWins + oLosses);
            }
          }
        }

        // Estimate hit rate from how far projection is from line
        const estimatedHitRate = Math.max(ouHitRate, Math.min(0.95, 0.50 + absEdge * 0.015));

        let tier: "PERFECT" | "STRONG" | "LEAN" | null = null;
        if (absEdge >= 10 && estimatedHitRate >= 0.75) tier = "PERFECT";
        else if (absEdge >= 7 && estimatedHitRate >= 0.65) tier = "STRONG";
        else if (absEdge >= 5 && estimatedHitRate >= 0.57) tier = "LEAN";
        if (!tier) continue;

        signals.push({
          tier, player_name: line.player_name, prop_type: propType,
          line: currentLine, over_price: line.over_price, under_price: line.under_price,
          opponent: opponent || "Unknown", avg_stat: avgProjected, min_stat: Math.min(offVsDef, defVsOff),
          max_stat: Math.max(offVsDef, defVsOff), games_played: 10,
          hit_rate: estimatedHitRate, edge_score: refinedEdge,
          floor_gap: isOverValue ? Math.min(offVsDef, defVsOff) - currentLine : currentLine - Math.max(offVsDef, defVsOff),
          side, sport: line.sport, event_id: line.event_id,
          event_description: line.event_description, hours_to_tip: line.hours_to_tip,
          recent_games: [], recent_avg: null, recency_boost: false,
          market_type: "team_market",
          team_record: teamStats.wins != null ? `${teamStats.wins}-${teamStats.losses}` : undefined,
          win_pct: teamStats.win_pct, ppg: teamStats.ppg, oppg: teamStats.oppg,
        });

      } else if (propType === "moneyline") {
        // ── MONEYLINE: use win% and implied probability from odds
        if (!teamStats.win_pct && teamStats.win_pct !== 0) continue;

        const winPct = Number(teamStats.win_pct);
        const oppWinPct = oppStats ? Number(oppStats.win_pct || 0.5) : 0.5;

        // Implied probability from American odds
        const odds = Number(line.over_price || line.line);
        let impliedProb: number;
        if (odds < 0) {
          impliedProb = Math.abs(odds) / (Math.abs(odds) + 100);
        } else if (odds > 0) {
          impliedProb = 100 / (odds + 100);
        } else {
          continue;
        }

        // Estimate true probability from win%
        // Adjusted for matchup: team win% vs opponent quality
        const matchupAdjWinPct = winPct * (1 - oppWinPct * 0.3);
        const edge = matchupAdjWinPct - impliedProb;
        const absEdge = Math.abs(edge);

        // Side: BACK if we think team wins more than implied, FADE otherwise
        const side = edge > 0 ? "BACK" : "FADE";
        if (absEdge < 0.05) continue; // need at least 5% edge

        let tier: "PERFECT" | "STRONG" | "LEAN" | null = null;
        if (absEdge >= 0.15 && winPct >= 0.65) tier = "PERFECT";
        else if (absEdge >= 0.10 && winPct >= 0.55) tier = "STRONG";
        else if (absEdge >= 0.05 && winPct >= 0.55) tier = "LEAN";
        if (!tier) continue;

        signals.push({
          tier, player_name: line.player_name, prop_type: propType,
          line: odds, over_price: line.over_price, under_price: line.under_price,
          opponent: opponent || "Unknown", avg_stat: winPct * 100,
          min_stat: impliedProb * 100, max_stat: matchupAdjWinPct * 100,
          games_played: (teamStats.wins || 0) + (teamStats.losses || 0),
          hit_rate: matchupAdjWinPct, edge_score: edge * 100,
          floor_gap: absEdge * 100, side, sport: line.sport,
          event_id: line.event_id, event_description: line.event_description,
          hours_to_tip: line.hours_to_tip,
          recent_games: [], recent_avg: null, recency_boost: false,
          market_type: "team_market",
          team_record: teamStats.wins != null ? `${teamStats.wins}-${teamStats.losses}` : undefined,
          win_pct: winPct, ppg: teamStats.ppg, oppg: teamStats.oppg,
        });

      } else if (propType === "spreads") {
        // ── SPREADS: use point differential vs spread line
        if (!teamStats.ppg || !teamStats.oppg) continue;

        const ptDiff = teamStats.ppg - teamStats.oppg;
        const oppPtDiff = oppStats ? (oppStats.ppg || 0) - (oppStats.oppg || 0) : 0;

        // Projected margin = (team diff - opp diff) / 2
        const projectedMargin = (ptDiff - oppPtDiff) / 2;
        const spreadLine = currentLine; // negative = team favored

        // Edge: how far our projected margin is from the spread
        const edge = projectedMargin - (-spreadLine); // negate spread since negative = favored
        const absEdge = Math.abs(edge);

        const side = edge > 0 ? "COVER" : "FADE";
        if (absEdge < 2) continue; // need 2+ point edge

        // ACCURACY FILTER: Suppress COVER on large spreads (>=10 pts) — historically 0% accuracy
        const absSpread = Math.abs(currentLine);
        if (side === "COVER" && absSpread >= 10) {
          log(`Blocking COVER on large spread ${currentLine} for ${line.player_name} — historically poor accuracy`);
          continue;
        }

        // ACCURACY FILTER: COVER requires higher edge threshold than FADE (FADE outperforms COVER)
        const minEdge = side === "COVER" ? 3 : 2;
        if (absEdge < minEdge) continue;

        const estimatedHitRate = Math.min(0.90, 0.50 + absEdge * 0.03);

        let tier: "PERFECT" | "STRONG" | "LEAN" | null = null;
        if (absEdge >= 8 && estimatedHitRate >= 0.71) tier = "PERFECT";
        else if (absEdge >= 6 && estimatedHitRate >= 0.65) tier = "STRONG";
        else if (absEdge >= (side === "COVER" ? 3 : 2) && estimatedHitRate >= 0.59) tier = "LEAN";
        if (!tier) continue;

        signals.push({
          tier, player_name: line.player_name, prop_type: propType,
          line: currentLine, over_price: line.over_price, under_price: line.under_price,
          opponent: opponent || "Unknown", avg_stat: projectedMargin,
          min_stat: Math.min(ptDiff, oppPtDiff), max_stat: Math.max(ptDiff, oppPtDiff),
          games_played: (teamStats.wins || 0) + (teamStats.losses || 0),
          hit_rate: estimatedHitRate, edge_score: edge,
          floor_gap: absEdge, side, sport: line.sport,
          event_id: line.event_id, event_description: line.event_description,
          hours_to_tip: line.hours_to_tip,
          recent_games: [], recent_avg: null, recency_boost: false,
          market_type: "team_market",
          team_record: teamStats.wins != null ? `${teamStats.wins}-${teamStats.losses}` : undefined,
          win_pct: teamStats.win_pct, ppg: teamStats.ppg, oppg: teamStats.oppg,
        });
      }
    }

    // ══════════════════════════════════════════════
    // PART C: SCALE-IN STAKING LOGIC
    // ══════════════════════════════════════════════
    log("--- Scale-In Tracker: checking active positions ---");

    // Fetch active scale-in positions
    const { data: activePositions } = await supabase
      .from("scale_in_tracker")
      .select("*")
      .eq("is_active", true);

    const scaleInAlerts: string[] = [];
    const existingPositionKeys = new Set(
      (activePositions || []).map((p: any) => `${p.player_name}|${p.prop_type}|${p.event_id}`)
    );

    // Check existing positions for line adjustments (Phase 2/3)
    for (const pos of activePositions || []) {
      const posKey = `${pos.event_id}|${pos.player_name}|${pos.prop_type}`;
      const currentLineData = latestByKey.get(posKey);
      if (!currentLineData) continue;

      const currentLine = Number(currentLineData.line);
      const initialLine = Number(pos.initial_line);
      const side = pos.side;

      // Check if line moved in our favor
      const lineMovedFavorably = side === "OVER" ? currentLine < initialLine : currentLine > initialLine;
      const totalDrop = Math.abs(currentLine - initialLine);

      if (!lineMovedFavorably || totalDrop < 0.5) {
        // Check if line moved AGAINST us
        const lineMovedAgainst = side === "OVER" ? currentLine > initialLine : currentLine < initialLine;
        const adverseDrop = Math.abs(currentLine - initialLine);
        if (lineMovedAgainst && adverseDrop >= 0.5 && pos.phase < 4) {
          // Send hold message
          const holdAlert = [
            `🛑 *HOLD — Line Moving Against You*`,
            `${pos.player_name} ${pos.prop_type.replace("player_", "").toUpperCase()}`,
            `Initial: ${initialLine} → Now: ${currentLine}`,
            `📊 Line moved ${adverseDrop.toFixed(1)} pts against your ${side} position`,
            `⚠️ DO NOT add more — hold current ${(pos.total_units_deployed * 100).toFixed(0)}% unit`,
          ].join("\n");
          scaleInAlerts.push(holdAlert);
        }
        continue;
      }

      // Determine new phase
      let newPhase = pos.phase;
      let stakeAction = "";
      let stakePct = 0;

      if (totalDrop >= 1.0 && pos.phase < 3) {
        newPhase = 3;
        stakePct = 25;
        stakeAction = "FULL UNIT";
      } else if (totalDrop >= 0.5 && pos.phase < 2) {
        newPhase = 2;
        stakePct = 50;
        stakeAction = "SCALE UP";
      }

      if (newPhase <= pos.phase) continue; // No phase change

      const newTotalUnits = Number(pos.total_units_deployed) + (stakePct / 100);
      const entries = [...(pos.entries || []), { line: currentLine, phase: newPhase, stake_pct: stakePct, timestamp: now.toISOString() }];
      const avgEntry = entries.reduce((sum: number, e: any) => sum + Number(e.line) * (e.stake_pct / 100), 0) / newTotalUnits;

      // Update tracker
      await supabase.from("scale_in_tracker").update({
        phase: newPhase,
        current_line: currentLine,
        best_line: side === "OVER" ? Math.min(Number(pos.best_line || initialLine), currentLine) : Math.max(Number(pos.best_line || initialLine), currentLine),
        entries,
        total_units_deployed: newTotalUnits,
        avg_entry_line: avgEntry,
        updated_at: now.toISOString(),
      }).eq("id", pos.id);

      const edgeImproved = pos.matchup_edge_pct ? `Edge improved: ${Number(pos.matchup_edge_pct).toFixed(1)}%` : "";
      const propLabel = PROP_LABEL[pos.prop_type] || pos.prop_type;

      const tierEmoji = newPhase === 3 ? "🔥" : "🔄";
      const tierLabel = newPhase === 3 ? "PERFECT ENTRY" : "LINE ADJUSTED";

      const alert = [
        `${tierEmoji} *${tierLabel}*: ${pos.player_name} ${propLabel}`,
        `${pos.side} ${initialLine} → ${currentLine} (dropped ${totalDrop.toFixed(1)})`,
        edgeImproved ? `📊 ${edgeImproved}` : null,
        `💰 *${stakeAction}*: Bet ${stakePct}% unit. Total invested: ${(newTotalUnits * 100).toFixed(0)}% across ${entries.length} entries`,
        `📊 Avg entry: ${avgEntry.toFixed(1)}`,
        newPhase === 2 ? `🛡️ If it drops again → full unit` : `✅ Max value reached — position complete`,
      ].filter(Boolean).join("\n");

      scaleInAlerts.push(alert);

      // Store as prediction record
      signals.push({
        tier: newPhase === 3 ? "PERFECT" : "STRONG",
        player_name: pos.player_name,
        prop_type: pos.prop_type,
        line: currentLine,
        over_price: currentLineData.over_price,
        under_price: currentLineData.under_price,
        opponent: pos.opponent || "Unknown",
        avg_stat: 0, min_stat: 0, max_stat: 0,
        games_played: 0, hit_rate: Number(pos.hit_rate || 0),
        edge_score: Number(pos.matchup_edge_pct || 0),
        floor_gap: totalDrop, side: pos.side,
        sport: pos.sport || "basketball_nba",
        event_id: pos.event_id,
        event_description: pos.event_description || null,
        hours_to_tip: currentLineData.hours_to_tip,
        recent_games: [], recent_avg: null, recency_boost: false,
        market_type: "player_prop",
      } as PerfectLineSignal);
    }

    // For NEW Perfect/Strong signals on combo/PRA props: create scale-in entries (Phase 1)
    const COMBO_SCALE_PROPS = new Set([
      "player_points_rebounds_assists", "player_rebounds_assists",
      "player_points_assists", "player_points_rebounds",
    ]);

    for (const s of signals) {
      if (s.market_type !== "player_prop") continue;
      if (!COMBO_SCALE_PROPS.has(s.prop_type) && s.prop_type !== "player_points") continue;
      if (s.tier === "LEAN") continue;

      const posKey = `${s.player_name}|${s.prop_type}|${s.event_id}`;
      if (existingPositionKeys.has(posKey)) continue; // Already tracked

      // Insert new scale-in position at Phase 1
      const { error: insertErr } = await supabase.from("scale_in_tracker").upsert({
        player_name: s.player_name,
        prop_type: s.prop_type,
        event_id: s.event_id,
        event_description: s.event_description,
        sport: s.sport,
        side: s.side,
        initial_line: s.line,
        current_line: s.line,
        best_line: s.line,
        entries: [{ line: s.line, phase: 1, stake_pct: 25, timestamp: now.toISOString() }],
        phase: 1,
        total_units_deployed: 0.25,
        avg_entry_line: s.line,
        opponent: s.opponent,
        matchup_edge_pct: Math.abs(s.edge_score),
        hit_rate: s.hit_rate,
        is_active: true,
        outcome: "pending",
      }, { onConflict: "player_name,prop_type,event_id" });

      if (insertErr) log(`⚠ Scale-in insert error: ${insertErr.message}`);
      existingPositionKeys.add(posKey);
    }

    // ══════════════════════════════════════════════
    // SORT & ALERT
    // ══════════════════════════════════════════════
    const tierOrder = { PERFECT: 0, STRONG: 1, LEAN: 2 };
    signals.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || Math.abs(b.edge_score) - Math.abs(a.edge_score));

    const playerPropCount = signals.filter(s => s.market_type === "player_prop").length;
    const teamMarketCount = signals.filter(s => s.market_type === "team_market").length;
    log(`Found ${signals.length} total signals: ${playerPropCount} player props, ${teamMarketCount} team markets`);
    log(`  PERFECT: ${signals.filter(s => s.tier === "PERFECT").length}, STRONG: ${signals.filter(s => s.tier === "STRONG").length}, LEAN: ${signals.filter(s => s.tier === "LEAN").length}`);

    // Alert PERFECT and STRONG only
    const alertSignals = signals.filter(s => s.tier === "PERFECT" || s.tier === "STRONG");

    if (alertSignals.length > 0 || scaleInAlerts.length > 0) {
      const alerts: string[] = [...scaleInAlerts]; // Scale-in alerts go first

      for (const s of alertSignals) {
        const tierEmoji = s.tier === "PERFECT" ? "🎯" : "🔵";
        const tierLabel = s.tier === "PERFECT" ? "PERFECT LINE" : "STRONG EDGE";
        const propLabel = PROP_LABEL[s.prop_type] || s.prop_type;
        const sportLabel = (SPORT_DB_MAP[s.sport] || s.sport || "").toUpperCase();

        // Check if this is a scale-in initial (combo prop with tracked position)
        const isScaleIn = existingPositionKeys.has(`${s.player_name}|${s.prop_type}|${s.event_id}`)
          && (COMBO_SCALE_PROPS.has(s.prop_type) || s.prop_type === "player_points");

        if (s.market_type === "team_market") {
          // Team market alert format
          if (s.prop_type === "totals") {
            const actionOdds = s.side === "OVER" ? s.over_price : s.under_price;
            const oddsStr = actionOdds ? ` (${fmtOdds(actionOdds)})` : "";
            const alert = [
              `${tierEmoji} *${tierLabel}* — ${sportLabel} ${propLabel}`,
              s.event_description ? `🏟 ${s.event_description}` : null,
              `📗 *FanDuel Total: ${s.line}${oddsStr}*`,
              `📊 Projected: ${s.avg_stat.toFixed(1)} (${s.player_name} ${s.ppg?.toFixed(1)} PPG + ${s.opponent} ${s.oppg?.toFixed(1)} PPG allowed)`,
              `🔥 Edge: ${Math.abs(s.edge_score).toFixed(1)}% ${s.side === "OVER" ? "above" : "below"} line`,
              s.team_record ? `📋 Record: ${s.team_record}` : null,
              `✅ *Action: ${s.side} ${s.line}${oddsStr}*`,
            ].filter(Boolean).join("\n");
            alerts.push(alert);

          } else if (s.prop_type === "moneyline") {
            const oddsStr = s.line ? ` (${fmtOdds(s.line)})` : "";
            const alert = [
              `${tierEmoji} *${tierLabel}* — ${sportLabel} Moneyline`,
              s.event_description ? `🏟 ${s.event_description}` : null,
              `📗 *FanDuel: ${s.player_name}${oddsStr}*`,
              `📊 Win Rate: ${(s.win_pct! * 100).toFixed(1)}% | Implied: ${s.min_stat.toFixed(1)}%`,
              `🔥 Edge: ${Math.abs(s.edge_score).toFixed(1)}% over implied probability`,
              s.team_record ? `📋 Record: ${s.team_record} | ${s.ppg?.toFixed(1)} PPG` : null,
              `✅ *Action: ${s.side} ${s.player_name}${oddsStr}*`,
            ].filter(Boolean).join("\n");
            alerts.push(alert);

          } else if (s.prop_type === "spreads") {
            const actionOdds = s.side === "COVER" ? s.over_price : s.under_price;
            const oddsStr = actionOdds ? ` (${fmtOdds(actionOdds)})` : "";
            const alert = [
              `${tierEmoji} *${tierLabel}* — ${sportLabel} Spread`,
              s.event_description ? `🏟 ${s.event_description}` : null,
              `📗 *FanDuel: ${s.player_name} ${s.line > 0 ? "+" : ""}${s.line}${oddsStr}*`,
              `📊 Projected Margin: ${s.avg_stat > 0 ? "+" : ""}${s.avg_stat.toFixed(1)} | Edge: ${Math.abs(s.floor_gap).toFixed(1)} pts`,
              s.team_record ? `📋 Record: ${s.team_record} | Diff: ${s.ppg && s.oppg ? (s.ppg - s.oppg).toFixed(1) : "N/A"}` : null,
              `✅ *Action: ${s.side} ${s.player_name} ${s.line > 0 ? "+" : ""}${s.line}${oddsStr}*`,
            ].filter(Boolean).join("\n");
            alerts.push(alert);
          }

        } else {
          // Player prop alert format
          const actionOdds = s.side === "OVER" ? s.over_price : s.under_price;
          const oddsStr = actionOdds ? ` (${fmtOdds(actionOdds)})` : "";
          const hitPct = (s.hit_rate * 100).toFixed(0);
          const hitFraction = `${Math.round(s.hit_rate * s.games_played)}/${s.games_played}`;
          const floorStr = s.side === "OVER" && s.floor_gap >= 0
            ? `✅ Floor: ${s.min_stat} (ALWAYS clears)` : s.side === "OVER"
            ? `⚡ Floor: ${s.min_stat}` : `⚡ Ceiling: ${s.max_stat}`;
          const recencyLine = s.recent_games.length > 0
            ? `📅 Last ${s.recent_games.length} vs ${s.opponent}: ${s.recent_games.join(", ")}${s.recency_boost ? " 🔥 TRENDING" : ""}` : null;

          // Scale-in staking guidance
          const scaleInLine = isScaleIn
            ? `⚠️ *SCALE-IN*: Bet 25% unit. Line may adjust — hold reserves.`
            : null;

          const alert = [
            `${tierEmoji} *${tierLabel} DETECTED*`,
            `${s.player_name} ${s.side} ${s.line} ${propLabel}${oddsStr}`,
            `📗 *FanDuel Line: ${s.line}${oddsStr}*`,
            `📊 vs ${s.opponent}: ${s.avg_stat} avg | ${hitFraction} ${s.side.toLowerCase()} | ${floorStr}`,
            `🔥 Historical: ${hitPct}% hit rate (${hitFraction} games)`,
            `✅ Gap: ${Math.abs(s.edge_score).toFixed(1)}% ${s.edge_score > 0 ? "above" : "below"} line`,
            recencyLine,
            scaleInLine,
            `✅ *Action: ${s.side} ${s.line}${oddsStr}*`,
          ].filter(Boolean).join("\n");
          alerts.push(alert);
        }
      }

      // Send via Telegram — paginated
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
          ? [`🎯 *Perfect Line Alerts*${pageLabel}`, `${alerts.length} signal(s) — props + team markets`, ""]
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

    // Store prediction records
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
        current_line: s.line,
        over_price: s.over_price,
        under_price: s.under_price,
        market_type: s.market_type,
        opponent: s.opponent,
        avg_stat: s.avg_stat,
        min_stat: s.min_stat,
        max_stat: s.max_stat,
        games_played: s.games_played,
        hit_rate: s.hit_rate,
        floor_gap: s.floor_gap,
        team_record: s.team_record,
        win_pct: s.win_pct,
        ppg: s.ppg,
        oppg: s.oppg,
        recent_games: s.recent_games,
        recency_boost: s.recency_boost,
      },
    }));

    if (predictionRecords.length > 0) {
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(predictionRecords);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    // Deactivate stale scale-in positions (games started)
    const { data: stalePositions } = await supabase
      .from("scale_in_tracker")
      .select("id, event_id")
      .eq("is_active", true);

    if (stalePositions && stalePositions.length > 0) {
      const finishedEventIds = new Set(
        allLines.filter((l: any) => typeof l.hours_to_tip === "number" && l.hours_to_tip <= -3)
          .map((l: any) => l.event_id)
      );
      const staleIds = stalePositions.filter((p: any) => finishedEventIds.has(p.event_id)).map((p: any) => p.id);
      if (staleIds.length > 0) {
        await supabase.from("scale_in_tracker").update({ is_active: false, updated_at: now.toISOString() }).in("id", staleIds);
        log(`Deactivated ${staleIds.length} stale scale-in positions`);
      }
    }

    // Log to cron history
    await supabase.from("cron_job_history").insert({
      job_name: "perfect-line-scanner",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: {
        lines_scanned: allLines.length,
        player_props: playerPropCount,
        team_markets: teamMarketCount,
        perfect: signals.filter(s => s.tier === "PERFECT").length,
        strong: signals.filter(s => s.tier === "STRONG").length,
        lean: signals.filter(s => s.tier === "LEAN").length,
        alerts_sent: alertSignals.length,
        scale_in_alerts: scaleInAlerts.length,
        active_positions: existingPositionKeys.size,
      },
    });

    log(`=== SCAN COMPLETE: ${signals.length} signals, ${alertSignals.length} alerts, ${scaleInAlerts.length} scale-in alerts ===`);

    return new Response(
      JSON.stringify({
        success: true,
        signals: signals.length,
        alerts_sent: alertSignals.length,
        scale_in_alerts: scaleInAlerts.length,
        breakdown: {
          player_props: playerPropCount,
          team_markets: teamMarketCount,
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

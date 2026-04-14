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

  const log = (msg: string) => console.log(`[Behavior Analyzer] ${msg}`);
  const now = new Date();

  // ====== OWNER RULES ENGINE — load rules that apply to this function ======
  let ownerRules: Array<{ rule_key: string; rule_logic: Record<string, unknown>; enforcement: string }> = [];
  try {
    const { data: rulesData } = await supabase
      .from("bot_owner_rules")
      .select("rule_key, rule_logic, enforcement")
      .eq("is_active", true)
      .contains("applies_to", ["fanduel-behavior-analyzer"]);
    ownerRules = (rulesData || []) as any;
    if (ownerRules.length > 0) log(`Loaded ${ownerRules.length} owner rules`);
  } catch (_) { /* rules are advisory, don't block on failure */ }

  // Helper: check if an alert violates any owner rule
  function checkOwnerRules(alert: any): { blocked: boolean; rule?: string; reason?: string } {
    for (const rule of ownerRules) {
      // Rule: pitcher K must follow market
      if (rule.rule_key === "pitcher_k_follow_market") {
        const pt = ((alert.prop_type || "").toLowerCase());
        const kTypes = ((rule.rule_logic as any).prop_types || []) as string[];
        if (kTypes.some((k: string) => pt.includes(k))) {
          const direction = (alert.direction || alert.dominant_direction || "").toLowerCase();
          const side = ((alert.action || "").toLowerCase());
          if (direction.includes("ris") && side.includes("under")) {
            return { blocked: rule.enforcement === "hard_block", rule: rule.rule_key, reason: "Pitcher K rising → should be OVER, not UNDER" };
          }
          if (direction.includes("drop") && side.includes("over")) {
            return { blocked: rule.enforcement === "hard_block", rule: rule.rule_key, reason: "Pitcher K dropping → should be UNDER, not OVER" };
          }
        }
      }
      // Rule: cascade needs direction
      if (rule.rule_key === "cascade_needs_direction" && alert.type === "cascade") {
        if (!alert.dominant_direction) {
          return { blocked: false, rule: rule.rule_key, reason: "Cascade missing dominant direction" };
        }
      }
    }
    return { blocked: false };
  }

  // ====== REAL ALT LINE FETCHER (FanDuel via The Odds API) ======
  const SPORT_KEY_MAP: Record<string, string> = {
    NBA: "basketball_nba", NCAAB: "basketball_ncaab",
    MLB: "baseball_mlb", NHL: "icehockey_nhl", NFL: "americanfootball_nfl",
  };
  const PROP_TO_ALT_KEY: Record<string, string> = {
    player_points: "points", player_rebounds: "rebounds", player_assists: "assists",
    player_threes: "threes", player_points_rebounds_assists: "pra",
    player_points_rebounds: "pts_rebs", player_points_assists: "pts_asts",
    player_rebounds_assists: "rebs_asts", player_steals: "steals",
    player_blocks: "blocks", player_turnovers: "turnovers",
    spreads: "spreads", totals: "totals", points: "points", rebounds: "rebounds",
    assists: "assists", threes: "threes", pra: "pra",
  };

  const altLineCache = new Map<string, { line: number; odds: number } | null>();

  async function fetchRealAltLine(
    eventId: string, playerName: string, propType: string,
    side: string, currentLine: number, sport: string
  ): Promise<{ line: number; odds: number } | null> {
    const pt = (propType || "").toLowerCase();
    if (["h2h", "moneyline"].some(s => pt.includes(s))) return null;

    const cacheKey = `${eventId}|${playerName}|${propType}`;
    if (altLineCache.has(cacheKey)) return altLineCache.get(cacheKey)!;

    // Map prop type to alt key
    let altPropKey = PROP_TO_ALT_KEY[pt];
    if (!altPropKey) {
      const stripped = pt.replace("player_", "").replace(/ /g, "_");
      altPropKey = PROP_TO_ALT_KEY[stripped];
    }
    if (!altPropKey) { altLineCache.set(cacheKey, null); return null; }

    const sportKey = SPORT_KEY_MAP[sport?.toUpperCase()] || SPORT_KEY_MAP[sport] || "basketball_nba";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/fetch-alternate-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ eventId, playerName, propType: altPropKey, sport: sportKey }),
      });
      if (!resp.ok) { altLineCache.set(cacheKey, null); return null; }
      const data = await resp.json();
      const lines: { line: number; overOdds: number; underOdds: number }[] = data.lines || [];
      if (lines.length === 0) { altLineCache.set(cacheKey, null); return null; }

      const picked = pickBestAltLine(lines, side, currentLine);
      altLineCache.set(cacheKey, picked);
      return picked;
    } catch (e) {
      log(`[AltLine] fetch error for ${playerName}: ${e}`);
      altLineCache.set(cacheKey, null);
      return null;
    }
  }

  function pickBestAltLine(
    lines: { line: number; overOdds: number; underOdds: number }[],
    side: string, currentLine: number
  ): { line: number; odds: number } | null {
    const s = side.toUpperCase();
    if (s === "OVER") {
      const candidates = lines.filter(l => l.line < currentLine).sort((a, b) => b.line - a.line);
      if (candidates.length > 0) return { line: candidates[0].line, odds: candidates[0].overOdds };
    } else if (s === "UNDER") {
      const candidates = lines.filter(l => l.line > currentLine).sort((a, b) => a.line - b.line);
      if (candidates.length > 0) return { line: candidates[0].line, odds: candidates[0].underOdds };
    }
    return null;
  }

  function fmtAltOdds(odds: number): string {
    return odds > 0 ? `+${odds}` : `${odds}`;
  }

  try {
    log("=== Starting FanDuel behavior analysis ===");

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    // Query per-sport to avoid 1000-row default limit drowning out smaller sports
    const SPORTS = ["NBA", "NCAAB", "NHL", "MLB"];
    let activeTimeline: any[] = [];

    for (const sport of SPORTS) {
      const { data, error } = await supabase
        .from("fanduel_line_timeline")
        .select("*")
        .eq("sport", sport)
        .gte("snapshot_time", twoHoursAgo)
        .gt("hours_to_tip", -3) // Exclude finished games at DB level
        .order("snapshot_time", { ascending: true })
        .limit(1000);

      if (error) {
        log(`⚠ ${sport} fetch error: ${error.message}`);
        continue;
      }
      if (data && data.length > 0) {
        activeTimeline = activeTimeline.concat(data);
        log(`${sport}: ${data.length} active records`);
      }
    }

    log(`Total active records: ${activeTimeline.length}`);

    if (activeTimeline.length === 0) {
      log("No active data to analyze");
      return new Response(JSON.stringify({ success: true, patterns: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by event+player+prop for sequential analysis
    const groups = new Map<string, any[]>();
    for (const row of activeTimeline) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // Also group by event+player (all props) for cascade detection
    const playerGroups = new Map<string, any[]>();
    for (const row of activeTimeline) {
      const key = `${row.event_id}|${row.player_name}`;
      if (!playerGroups.has(key)) playerGroups.set(key, []);
      playerGroups.get(key)!.push(row);
    }

    const patterns: any[] = [];
    // Track best alert per player (dedup)
    const bestAlertPerPlayer = new Map<string, { confidence: number; alert: any }>();
    const addAlert = (playerKey: string, confidence: number, alert: any) => {
      const existing = bestAlertPerPlayer.get(playerKey);
      if (!existing || confidence > existing.confidence) {
        bestAlertPerPlayer.set(playerKey, { confidence, alert });
      }
    };

    // ══════════════════════════════════════════════════════════════
    // TIME-DECAY WEIGHTING: recent snapshots matter exponentially more
    // ══════════════════════════════════════════════════════════════
    const DECAY_HALF_LIFE_MIN = 15; // weight halves every 15 min
    function timeDecayWeight(snapshotTime: string): number {
      const ageMin = (now.getTime() - new Date(snapshotTime).getTime()) / 60000;
      return Math.pow(0.5, ageMin / DECAY_HALF_LIFE_MIN);
    }

    /** Weighted velocity: recent moves count more than old ones */
    function weightedVelocity(snapshots: any[]): { velocity: number; recentBias: number } {
      if (snapshots.length < 2) return { velocity: 0, recentBias: 0 };
      let weightedMove = 0;
      let totalWeight = 0;
      let recentWeight = 0;
      let oldWeight = 0;

      for (let i = 1; i < snapshots.length; i++) {
        const move = Math.abs(snapshots[i].line - snapshots[i - 1].line);
        const w = timeDecayWeight(snapshots[i].snapshot_time);
        weightedMove += move * w;
        totalWeight += w;
        // Track if movement is accelerating (recent half vs old half)
        if (i >= snapshots.length / 2) recentWeight += move;
        else oldWeight += move;
      }

      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      // BUG G FIX: removed snapshots.length multiplier — velocity is weighted avg move per hour
      const rawVelocity = timeDiffMin > 0 ? (weightedMove / totalWeight) * (60 / timeDiffMin) : 0;

      // recentBias > 1 means accelerating, < 1 means decelerating
      const recentBias = oldWeight > 0 ? recentWeight / oldWeight : 1;

      return { velocity: rawVelocity, recentBias };
    }

    // ══════════════════════════════════════════════════════════════
    // ADAPTIVE PATTERN LEARNING: load outcome-based thresholds
    // ══════════════════════════════════════════════════════════════
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: outcomeRows } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("signal_type, prop_type, sport, was_correct, velocity_at_signal, confidence_at_signal")
      .not("was_correct", "is", null)
      .gte("created_at", thirtyDaysAgo)
      .neq("actual_outcome", "informational_excluded") // BUG J FIX: exclude trap_warnings
      .eq("is_gated", false);                          // BUG E companion: exclude gated records

    // Build learned thresholds per signal_type+prop_type
    interface LearnedThreshold {
      winRate: number;
      avgWinVelocity: number;
      avgLossVelocity: number;
      avgWinConfidence: number;
      optimalMinVelocity: number;
      samples: number;
    }
    const learnedThresholds = new Map<string, LearnedThreshold>();
    const outcomeGroups = new Map<string, { wins: any[]; losses: any[] }>();

    for (const r of outcomeRows || []) {
      const key = `${r.signal_type}|${r.prop_type}`;
      if (!outcomeGroups.has(key)) outcomeGroups.set(key, { wins: [], losses: [] });
      const g = outcomeGroups.get(key)!;
      if (r.was_correct) g.wins.push(r);
      else g.losses.push(r);
    }

    for (const [key, g] of outcomeGroups) {
      const total = g.wins.length + g.losses.length;
      if (total < 5) continue;

      const avgV = (arr: any[]) => {
        const vals = arr.map(r => r.velocity_at_signal).filter(v => v != null && v > 0);
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      };
      const avgC = (arr: any[]) => {
        const vals = arr.map(r => r.confidence_at_signal).filter(v => v != null);
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 50;
      };

      const avgWinV = avgV(g.wins);
      const avgLossV = avgV(g.losses);
      // Optimal minimum = midpoint between avg loss velocity and avg win velocity
      const optimalMin = avgLossV > 0 && avgWinV > avgLossV
        ? (avgWinV + avgLossV) / 2
        : avgWinV * 0.7;

      learnedThresholds.set(key, {
        winRate: g.wins.length / total,
        avgWinVelocity: avgWinV,
        avgLossVelocity: avgLossV,
        avgWinConfidence: avgC(g.wins),
        optimalMinVelocity: optimalMin,
        samples: total,
      });
    }

    log(`Adaptive thresholds loaded: ${learnedThresholds.size} signal+prop combos from ${outcomeRows?.length || 0} outcomes`);

    /** Get learned velocity floor for a signal type — falls back to static default */
    function getAdaptiveVelocityMin(signalType: string, propType: string, staticDefault: number): number {
      const learned = learnedThresholds.get(`${signalType}|${propType}`);
      if (learned && learned.samples >= 10 && learned.optimalMinVelocity > 0) {
        return learned.optimalMinVelocity;
      }
      return staticDefault;
    }

    /** Get learned confidence floor */
    function getAdaptiveConfidenceMin(signalType: string, propType: string, staticDefault: number): number {
      const learned = learnedThresholds.get(`${signalType}|${propType}`);
      if (learned && learned.samples >= 10 && learned.winRate < 0.5) {
        // If this combo loses more than wins, raise the confidence bar
        return Math.max(staticDefault, learned.avgWinConfidence * 0.9);
      }
      return staticDefault;
    }

    // ══════════════════════════════════════════════════════════════
    // CORRELATION DETECTION: same-game multi-player shifts
    // ══════════════════════════════════════════════════════════════
    // Group ONLY pre-game snapshots with real opening lines by event for correlation
    const eventGroups = new Map<string, Map<string, any[]>>();
    for (const row of activeTimeline) {
      // STRICT FILTER: pre-game only, must have opening_line, must have valid event_id
      if (!row.opening_line) continue;
      if (typeof row.hours_to_tip !== "number" || row.hours_to_tip <= 0) continue;
      if (!row.event_id) continue;
      if (!eventGroups.has(row.event_id)) eventGroups.set(row.event_id, new Map());
      const eg = eventGroups.get(row.event_id)!;
      const pk = `${row.player_name}|${row.prop_type}`;
      if (!eg.has(pk)) eg.set(pk, []);
      eg.get(pk)!.push(row);
    }

    // Detect correlated shifts: 3+ players in same game moving same direction on same prop
    for (const [eventId, playerProps] of eventGroups) {
      const propTypeShifts = new Map<string, { player: string; direction: string; magnitude: number; sport: string; eventDesc: string; current_line: number }[]>();

      for (const [pk, snaps] of playerProps) {
        if (snaps.length < 2) continue;
        const first = snaps[0];
        const last = snaps[snaps.length - 1];
        // Compare against opening_line for real movement (not snapshot-to-snapshot noise)
        const diff = last.line - last.opening_line;
        if (Math.abs(diff) < 0.3) continue; // Lowered threshold — captures earlier correlation signals (0.3+ from open)

        const propType = first.prop_type;
        if (!propTypeShifts.has(propType)) propTypeShifts.set(propType, []);
        propTypeShifts.get(propType)!.push({
          player: first.player_name,
          direction: diff > 0 ? "rising" : "dropping",
          magnitude: Math.abs(diff),
          sport: first.sport,
          eventDesc: first.event_description,
          current_line: last.line,
        });
      }

      for (const [propType, shifts] of propTypeShifts) {
        if (shifts.length < 2) continue; // Need 2+ players shifting (lowered from 3 to capture pair correlations)

        // Count directions
        const rising = shifts.filter(s => s.direction === "rising").length;
        const dropping = shifts.filter(s => s.direction === "dropping").length;
        const dominant = rising >= dropping ? "rising" : "dropping";
        const dominantCount = Math.max(rising, dropping);
        const correlationRate = dominantCount / shifts.length;

        if (correlationRate >= 0.65) {
          // Strong correlation — likely team news/injury, not sharp action on individuals
          const avgMag = shifts.reduce((a, s) => a + s.magnitude, 0) / shifts.length;
          const conf = Math.min(90, 60 + correlationRate * 15 + Math.min(shifts.length, 6) * 3);
          const sampleShift = shifts[0];

          // Determine signal type: correlated = team-level event
          const isTeamWide = correlationRate >= 0.85;
          const signalLabel = isTeamWide ? "team_news_shift" : "correlated_movement";

          patterns.push({
            sport: sampleShift.sport, prop_type: propType, pattern_type: signalLabel,
            avg_reaction_time_minutes: 0, avg_move_size: avgMag,
            confidence: conf, sample_size: shifts.length,
            cascade_sequence: { players: shifts.map(s => s.player), dominant_direction: dominant, correlation: correlationRate },
            velocity_threshold: null, snapback_pct: null, timing_window: null,
          });

          const alertKey = `${eventId}|CORRELATED|${propType}`;
          addAlert(alertKey, conf + 5, {
            type: signalLabel,
            live: false,
            sport: sampleShift.sport,
            player_name: `${shifts.length} players`,
            prop_type: propType,
            event_description: sampleShift.eventDesc,
            event_id: eventId,
            players_moving: shifts.map(s => ({ name: s.player, direction: s.direction, magnitude: s.magnitude, current_line: s.current_line })),
            dominant_direction: dominant,
            correlation_rate: Math.round(correlationRate * 100),
            avg_magnitude: Math.round(avgMag * 100) / 100,
            confidence: conf,
            hours_to_tip: null,
            avg_current_line: shifts.reduce((a, s) => a + s.current_line, 0) / shifts.length,
          });

          log(`🔗 CORRELATION: ${shifts.length} players ${dominant} on ${propType} in ${sampleShift.eventDesc} (${Math.round(correlationRate * 100)}% aligned)`);

          // ── AUTO-GENERATE TOTALS & MONEYLINE SIGNALS from team_news_shift ──
          // When 3+ player props shift together (85%+ correlation), infer team-level signals
          if (isTeamWide) {
            // ── Look up actual game total line + ML odds from game_market_snapshots ──
            let gameTotal: number | null = null;
            let gameTotalOverOdds: number | null = null;
            let gameTotalUnderOdds: number | null = null;
            let homeTeam: string | null = null;
            let awayTeam: string | null = null;
            let homeOdds: number | null = null;
            let awayOdds: number | null = null;

            // Parse event description to find teams (format: "Away Team @ Home Team")
            const eventDesc = sampleShift.eventDesc || "";
            const atMatch = eventDesc.match(/^(.+?)\s*@\s*(.+)$/);
            const parsedAway = atMatch ? atMatch[1].trim() : null;
            const parsedHome = atMatch ? atMatch[2].trim() : null;

            if (parsedHome && parsedAway) {
              try {
                // Get totals line
                const { data: totalsSnap } = await supabase
                  .from("game_market_snapshots")
                  .select("fanduel_line, fanduel_over_odds, fanduel_under_odds")
                  .eq("bet_type", "totals")
                  .ilike("home_team", `%${parsedHome}%`)
                  .ilike("away_team", `%${parsedAway}%`)
                  .order("scan_time", { ascending: false })
                  .limit(1);

                if (totalsSnap && totalsSnap.length > 0) {
                  gameTotal = Number(totalsSnap[0].fanduel_line);
                  gameTotalOverOdds = totalsSnap[0].fanduel_over_odds;
                  gameTotalUnderOdds = totalsSnap[0].fanduel_under_odds;
                }

                // Fallback: if game_market_snapshots had no totals, try unified_props
                if (gameTotal == null) {
                  const { data: upTotals } = await supabase
                    .from("unified_props")
                    .select("current_line, over_price, under_price")
                    .eq("prop_type", "totals")
                    .eq("is_active", true)
                    .or(`player_name.ilike.%${parsedHome}%,player_name.ilike.%${parsedAway}%,event_description.ilike.%${parsedHome}%`)
                    .order("last_updated", { ascending: false })
                    .limit(1);
                  if (upTotals && upTotals.length > 0) {
                    gameTotal = Number(upTotals[0].current_line);
                    gameTotalOverOdds = upTotals[0].over_price ?? null;
                    gameTotalUnderOdds = upTotals[0].under_price ?? null;
                    log(`📊 Totals fallback from unified_props: ${gameTotal} for ${parsedAway} @ ${parsedHome}`);
                  }
                }

                // Get ML odds
                const { data: mlSnap } = await supabase
                  .from("game_market_snapshots")
                  .select("home_team, away_team, fanduel_home_odds, fanduel_away_odds")
                  .ilike("bet_type", "%moneyline%")
                  .ilike("home_team", `%${parsedHome}%`)
                  .ilike("away_team", `%${parsedAway}%`)
                  .order("scan_time", { ascending: false })
                  .limit(1);

                if (mlSnap && mlSnap.length > 0) {
                  homeTeam = mlSnap[0].home_team;
                  awayTeam = mlSnap[0].away_team;
                  homeOdds = mlSnap[0].fanduel_home_odds;
                  awayOdds = mlSnap[0].fanduel_away_odds;
                }
              } catch (e) {
                log(`⚠️ game_market_snapshots lookup failed: ${e}`);
              }
            }

            // Determine which team the shifting players belong to
            // If players are rising → back that team; if dropping → fade that team
            let teamToBack: string | null = null;
            let teamToBackOdds: number | null = null;
            if (homeTeam && awayTeam) {
              // Default to home team; the players in shifts likely belong to one side
              // Use event description positioning: players listed under "@ Home" = home team
              const isHomeTeamShifting = parsedHome && eventDesc.includes(parsedHome);
              if (dominant === "rising") {
                // Rising props → back that team
                teamToBack = isHomeTeamShifting ? homeTeam : awayTeam;
                teamToBackOdds = isHomeTeamShifting ? homeOdds : awayOdds;
              } else {
                // Dropping props → fade that team = back the other
                teamToBack = isHomeTeamShifting ? awayTeam : homeTeam;
                teamToBackOdds = isHomeTeamShifting ? awayOdds : homeOdds;
              }
            }

            // TOTALS signal — with Run Production Validation Gate
            const totalsAlertKey = `${eventId}|CORR_TOTALS|${propType}`;
            let totalsDirection = dominant === "dropping" ? "UNDER" : "OVER";
            let totalsConf = Math.min(85, conf - 5);

            // === RUN PRODUCTION VALIDATION GATE (MLB ONLY) ===
            const isMLB = (sampleShift.sport || '').toLowerCase().includes('baseball') 
                       || (sampleShift.sport || '').toLowerCase().includes('mlb');

            let batterValidation = { dropping: 0, rising: 0, total: 0, summary: '' };
            let pitcherValidation = { kLineDirection: 'unknown' as string, summary: '' };
            let validationBlocked = false;

            if (isMLB) {
              try {
                // 1. Check batter hitting props (Hits, HR, RBIs, Total Bases) for this game
                const runPropTypes = ['batter_hits', 'batter_home_runs', 'batter_rbis', 'batter_total_bases',
                                      'Hits', 'Home Runs', 'RBIs', 'Total Bases', 'player_hits', 'player_home_runs',
                                      'player_rbis', 'player_total_bases'];
                const { data: batterProps } = await supabase
                  .from('unified_props')
                  .select('player_name, prop_type, current_line, previous_line')
                  .eq('event_id', eventId)
                  .in('prop_type', runPropTypes)
                  .not('current_line', 'is', null);

                if (batterProps && batterProps.length > 0) {
                  for (const bp of batterProps) {
                    if (bp.previous_line != null && bp.current_line != null) {
                      batterValidation.total++;
                      if (bp.current_line < bp.previous_line) batterValidation.dropping++;
                      else if (bp.current_line > bp.previous_line) batterValidation.rising++;
                    }
                  }
                  if (batterValidation.total > 0) {
                    const dropRate = batterValidation.dropping / batterValidation.total;
                    const riseRate = batterValidation.rising / batterValidation.total;
                    if (totalsDirection === 'UNDER') {
                      if (dropRate >= 0.5) { totalsConf += 10; batterValidation.summary = `${batterValidation.dropping}/${batterValidation.total} hitting lines dropping ✅`; }
                      else if (riseRate >= 0.5) { totalsConf -= 15; batterValidation.summary = `${batterValidation.rising}/${batterValidation.total} hitting lines RISING ⚠️`; }
                      else { batterValidation.summary = `${batterValidation.dropping}/${batterValidation.total} hitting lines dropping (mixed)`; }
                    } else {
                      if (riseRate >= 0.5) { totalsConf += 10; batterValidation.summary = `${batterValidation.rising}/${batterValidation.total} hitting lines rising ✅`; }
                      else if (dropRate >= 0.5) { totalsConf -= 15; batterValidation.summary = `${batterValidation.dropping}/${batterValidation.total} hitting lines DROPPING ⚠️`; }
                      else { batterValidation.summary = `${batterValidation.rising}/${batterValidation.total} hitting lines rising (mixed)`; }
                    }
                  } else {
                    batterValidation.summary = 'no hitting line movement data';
                  }
                } else {
                  batterValidation.summary = 'no hitting props found';
                }

                // 2. Check pitcher strikeout lines
                const kPropTypes = ['pitcher_strikeouts', 'Pitcher Strikeouts', 'pitcher_ks', 'strikeouts'];
                const { data: pitcherProps } = await supabase
                  .from('unified_props')
                  .select('player_name, prop_type, current_line, previous_line')
                  .eq('event_id', eventId)
                  .in('prop_type', kPropTypes)
                  .not('current_line', 'is', null);

                if (pitcherProps && pitcherProps.length > 0) {
                  let kRising = 0, kDropping = 0, kTotal = 0;
                  for (const pp of pitcherProps) {
                    if (pp.previous_line != null && pp.current_line != null) {
                      kTotal++;
                      if (pp.current_line > pp.previous_line) kRising++;
                      else if (pp.current_line < pp.previous_line) kDropping++;
                    }
                  }
                  if (kTotal > 0) {
                    if (kRising > kDropping) {
                      pitcherValidation.kLineDirection = 'rising';
                      pitcherValidation.summary = 'K line rising (dominant arm)';
                      if (totalsDirection === 'UNDER') totalsConf += 5;
                      else totalsConf -= 5;
                    } else if (kDropping > kRising) {
                      pitcherValidation.kLineDirection = 'dropping';
                      pitcherValidation.summary = 'K line dropping (weaker arm)';
                      if (totalsDirection === 'UNDER') totalsConf -= 10;
                      else totalsConf += 5;
                    } else {
                      pitcherValidation.kLineDirection = 'stable';
                      pitcherValidation.summary = 'K line stable';
                    }
                  } else {
                    pitcherValidation.summary = 'no K line movement';
                  }
                } else {
                  pitcherValidation.summary = 'no pitcher K props found';
                }

                // 3. Block if confidence drops below 55
                if (totalsConf < 55) {
                  validationBlocked = true;
                  log(`🚫 AUTO-TOTALS BLOCKED: ${sampleShift.eventDesc} → ${totalsDirection} blocked (conf ${totalsConf} < 55). Batters: ${batterValidation.summary} | Pitcher: ${pitcherValidation.summary}`);
                }
              } catch (valErr) {
                log(`⚠️ Run production validation error (proceeding anyway): ${valErr}`);
              }
            }

            if (!validationBlocked) {
              addAlert(totalsAlertKey, totalsConf + 3, {
                type: "team_news_shift",
                live: false,
                sport: sampleShift.sport,
                player_name: sampleShift.eventDesc || `${shifts.length} players`,
                prop_type: "totals",
                event_description: sampleShift.eventDesc,
                event_id: eventId,
                players_moving: shifts.map(s => ({ name: s.player, direction: s.direction, magnitude: s.magnitude, current_line: s.current_line })),
                dominant_direction: dominant,
                correlation_rate: Math.round(correlationRate * 100),
                avg_magnitude: Math.round(avgMag * 100) / 100,
                confidence: totalsConf,
                hours_to_tip: null,
                derived_from: `player_props_${propType}`,
                derived_action: totalsDirection,
                game_total_line: gameTotal,
                game_total_over_odds: gameTotalOverOdds,
                game_total_under_odds: gameTotalUnderOdds,
                ...(isMLB && batterValidation.summary ? { batter_validation: batterValidation.summary } : {}),
                ...(isMLB && pitcherValidation.summary ? { pitcher_validation: pitcherValidation.summary } : {}),
              });
              log(`📰 AUTO-TOTALS: ${sampleShift.eventDesc} → ${totalsDirection}${gameTotal ? ` ${gameTotal}` : ''} (derived from ${shifts.length} player ${propType} shifts)${isMLB ? ` | Batters: ${batterValidation.summary} | Pitcher: ${pitcherValidation.summary}` : ''}`);
            }

            // MONEYLINE signal
            if (shifts.length >= 5 || correlationRate >= 0.9) {
              const mlAlertKey = `${eventId}|CORR_ML|${propType}`;
              const mlAction = dominant === "dropping" ? "FADE" : "BACK";
              const mlConf = Math.min(80, conf - 10);
              addAlert(mlAlertKey, mlConf + 2, {
                type: "team_news_shift",
                live: false,
                sport: sampleShift.sport,
                player_name: sampleShift.eventDesc || `${shifts.length} players`,
                prop_type: "moneyline",
                event_description: sampleShift.eventDesc,
                event_id: eventId,
                players_moving: shifts.map(s => ({ name: s.player, direction: s.direction, magnitude: s.magnitude })),
                dominant_direction: dominant,
                correlation_rate: Math.round(correlationRate * 100),
                avg_magnitude: Math.round(avgMag * 100) / 100,
                confidence: mlConf,
                hours_to_tip: null,
                derived_from: `player_props_${propType}`,
                derived_action: mlAction,
                team_to_back: teamToBack,
                team_to_back_odds: teamToBackOdds,
              });
              log(`📰 AUTO-ML: ${sampleShift.eventDesc} → ${mlAction}${teamToBack ? ` ${teamToBack} (${teamToBackOdds})` : ''} (derived from ${shifts.length} player ${propType} shifts)`);
            }
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // TEAM MARKET CORRELATION: Totals/Spreads moving across multiple games
    // ══════════════════════════════════════════════════════════════
    const teamMarketByType = new Map<string, { event_id: string; direction: string; magnitude: number; sport: string; eventDesc: string; current_line: number; opening_line: number }[]>();
    for (const row of activeTimeline) {
      if (!row.opening_line) continue;
      if (typeof row.hours_to_tip !== "number" || row.hours_to_tip <= 0) continue;
      if (!row.event_id) continue;
      const pt = row.prop_type;
      if (pt !== "totals" && pt !== "spreads") continue;

      const diff = row.line - row.opening_line;
      if (Math.abs(diff) < 0.5) continue;

      const key = `${row.sport}|${pt}`;
      if (!teamMarketByType.has(key)) teamMarketByType.set(key, []);

      // Deduplicate by event — keep latest snapshot per event
      const existing = teamMarketByType.get(key)!;
      const existingIdx = existing.findIndex(e => e.event_id === row.event_id);
      const entry = {
        event_id: row.event_id,
        direction: diff > 0 ? "rising" : "dropping",
        magnitude: Math.abs(diff),
        sport: row.sport,
        eventDesc: row.event_description,
        current_line: row.line,
        opening_line: row.opening_line,
      };
      if (existingIdx >= 0) {
        existing[existingIdx] = entry; // update with latest
      } else {
        existing.push(entry);
      }
    }

    for (const [key, shifts] of teamMarketByType) {
      if (shifts.length < 3) continue; // Need 3+ games shifting same direction
      const [sport, propType] = key.split("|");

      const rising = shifts.filter(s => s.direction === "rising").length;
      const dropping = shifts.filter(s => s.direction === "dropping").length;
      const dominant = rising >= dropping ? "rising" : "dropping";
      const dominantCount = Math.max(rising, dropping);
      const correlationRate = dominantCount / shifts.length;

      if (correlationRate >= 0.75) {
        const avgMag = shifts.reduce((a, s) => a + s.magnitude, 0) / shifts.length;
        const conf = Math.min(85, 55 + correlationRate * 15 + Math.min(shifts.length, 5) * 3);

        const alertKey = `TEAM_MKT_CORR|${sport}|${propType}|${dominant}`;
        const topGames = shifts.filter(s => s.direction === dominant).slice(0, 5);

        addAlert(alertKey, conf + 3, {
          type: "team_news_shift",
          live: false,
          sport,
          player_name: `${shifts.length} games`,
          prop_type: propType,
          event_description: `${sport} ${propType} — ${shifts.length} games moving ${dominant}`,
          event_id: topGames[0]?.event_id || "multi_game",
          players_moving: topGames.map(s => ({ name: s.eventDesc, direction: s.direction, magnitude: s.magnitude, current_line: s.current_line, opening_line: s.opening_line })),
          dominant_direction: dominant,
          correlation_rate: Math.round(correlationRate * 100),
          avg_magnitude: Math.round(avgMag * 100) / 100,
          confidence: conf,
          hours_to_tip: null,
          derived_from: `team_market_cross_game`,
        });

        log(`🔗 TEAM-MARKET CORRELATION: ${shifts.length} ${sport} ${propType} games ${dominant} (${Math.round(correlationRate * 100)}% aligned)`);
      }
    }

    const esc = (s: string) => (s || "").replace(/_/g, " ").replace(/\*/g, "").replace(/\[/g, "(").replace(/\]/g, ")");

    // Pre-declare EDGE_MINIMUMS (used by velocity spike and take_it_now)
    const EDGE_MINIMUMS: Record<string, number> = {
      player_points: 1.5, player_rebounds: 1.0, player_assists: 1.0,
      player_threes: 0.5, player_points_rebounds_assists: 1.0,
      player_points_rebounds: 1.0, player_points_assists: 1.0,
      player_rebounds_assists: 0.5, player_shots_on_goal: 0.5,
      player_steals: 0.5, player_blocks: 0.5, player_turnovers: 0.5,
      spreads: 1.0, totals: 1.0, moneyline: 15, h2h: 15,
    };

    // Helper: is this row from a live game?
    const isLive = (r: any) => r.snapshot_phase === "live" || (typeof r.hours_to_tip === "number" && r.hours_to_tip <= 0);

    // ══════════════════════════════════════════════════════════════
    // LIVE GAME NOISE SUPPRESSION
    // Moneyline/spreads/totals during live games are game-score noise,
    // NOT market signals. Suppress them from all pattern detectors.
    // ══════════════════════════════════════════════════════════════
    const TEAM_MARKET_TYPES = new Set(["moneyline", "h2h", "spreads", "totals"]);
    const isLiveTeamMarketNoise = (row: any) => isLive(row) && TEAM_MARKET_TYPES.has(row.prop_type);

    // Max sane velocity caps — anything above = in-game noise leaking through
    const MAX_VELOCITY: Record<string, number> = {
      player_points: 20, player_rebounds: 10, player_assists: 10,
      player_threes: 8, player_points_rebounds_assists: 15,
      player_points_rebounds: 12, player_points_assists: 12,
      player_rebounds_assists: 8, player_shots_on_goal: 8,
      player_steals: 6, player_blocks: 6, player_turnovers: 6,
      spreads: 15, totals: 15, moneyline: 100, h2h: 100,
    };

    // ====== PATTERN 0 (PRIMARY): LINE ABOUT TO MOVE ======
    // Best performing signal (57.5% win rate). Detects steady, sustained
    // directional movement that isn't a sudden spike — the line has been
    // consistently drifting in one direction across 3+ snapshots.
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 3) continue;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];

      // SUPPRESS: live team markets are game-score noise, not signals
      if (isLiveTeamMarketNoise(last)) continue;
      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      if (timeDiffMin < 10) continue;

      const lineDiff = last.line - first.line;
      const absLineDiff = Math.abs(lineDiff);
      
      // Time-decay weighted velocity (recent moves count more)
      const { velocity: wVelocity, recentBias } = weightedVelocity(snapshots);
      const velocityPerHour = (absLineDiff / timeDiffMin) * 60;

      let consistentMoves = 0;
      for (let i = 1; i < snapshots.length; i++) {
        const move = snapshots[i].line - snapshots[i - 1].line;
        if ((lineDiff > 0 && move > 0) || (lineDiff < 0 && move < 0)) {
          consistentMoves++;
        }
      }
      const consistencyRate = consistentMoves / (snapshots.length - 1);

      // Adaptive velocity floor from outcomes (learned)
      const adaptiveMinV = getAdaptiveVelocityMin("line_about_to_move", first.prop_type, 0.3);
      const adaptiveMaxV = MAX_VELOCITY[first.prop_type] || 20;

      if (absLineDiff >= 0.5 && velocityPerHour >= adaptiveMinV && velocityPerHour <= adaptiveMaxV && consistencyRate >= 0.6) {
        const direction = lineDiff < 0 ? "dropping" : "rising";
        const live = isLive(last);
        // Boost confidence when movement is accelerating (recentBias > 1)
        const accelBonus = recentBias > 1.3 ? 5 : recentBias > 1.0 ? 2 : 0;
        const confFloor = getAdaptiveConfidenceMin("line_about_to_move", first.prop_type, 55);
        const conf = Math.min(92, confFloor + consistencyRate * 20 + Math.min(snapshots.length, 8) * 2 + accelBonus);

        patterns.push({
          sport: first.sport, prop_type: first.prop_type, pattern_type: "line_about_to_move",
          avg_reaction_time_minutes: timeDiffMin, avg_move_size: absLineDiff,
          confidence: conf, sample_size: snapshots.length,
          cascade_sequence: null, velocity_threshold: velocityPerHour,
          snapback_pct: null, timing_window: `${Math.round(timeDiffMin)}min`,
        });

        const playerKey = `${first.event_id}|${first.player_name}`;
        addAlert(playerKey, conf + 10, {
          type: "line_about_to_move", live, sport: first.sport,
          player_name: first.player_name, prop_type: first.prop_type,
          event_description: first.event_description, event_id: first.event_id,
          direction, velocity: Math.round(velocityPerHour * 100) / 100,
          weighted_velocity: Math.round(wVelocity * 100) / 100,
          recent_bias: Math.round(recentBias * 100) / 100,
          line_from: first.line, line_to: last.line,
          lineDiff: Math.round(lineDiff * 100) / 100,
          consistencyRate: Math.round(consistencyRate * 100),
          time_span_min: Math.round(timeDiffMin), confidence: conf,
          hours_to_tip: last.hours_to_tip,
          learnedAvgVelocity: velocityPerHour,
          adaptive_threshold: adaptiveMinV,
        });
      }
    }

    // ====== PATTERN 1: VELOCITY SPIKES (adaptive + time-decay weighted) ======
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 3) continue;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];

      // SUPPRESS: live team markets are game-score noise
      if (isLiveTeamMarketNoise(last)) continue;

      const timeDiffMin = (new Date(last.snapshot_time).getTime() - new Date(first.snapshot_time).getTime()) / 60000;
      if (timeDiffMin < 10) continue;

      const signedDiff = last.line - first.line;
      const lineDiff = Math.abs(signedDiff);
      const velocityPerHour = (lineDiff / timeDiffMin) * 60;

      // Cap velocity at sane maximum — anything above is in-game noise
      const maxV = MAX_VELOCITY[first.prop_type] || 20;
      if (velocityPerHour > maxV) continue;

      const edgeMin = EDGE_MINIMUMS[first.prop_type] || 0.5;
      if (lineDiff < edgeMin) continue;

      // Time-decay weighted velocity
      const { velocity: wVelocity, recentBias } = weightedVelocity(snapshots);

      let consistentMoves = 0;
      for (let i = 1; i < snapshots.length; i++) {
        const move = snapshots[i].line - snapshots[i - 1].line;
        if ((signedDiff > 0 && move > 0) || (signedDiff < 0 && move < 0)) consistentMoves++;
      }
      const dirConsistency = consistentMoves / (snapshots.length - 1);
      if (dirConsistency < 0.5) continue;

      // Adaptive velocity floor from settled outcomes
      const adaptiveVMin = getAdaptiveVelocityMin("velocity_spike", first.prop_type, 4.0);

      if (velocityPerHour >= adaptiveVMin) {
        const direction = last.line < first.line ? "dropping" : "rising";
        const live = isLive(last);
        const accelBonus = recentBias > 1.5 ? 8 : recentBias > 1.2 ? 4 : 0;
        const confFloor = getAdaptiveConfidenceMin("velocity_spike", first.prop_type, 50);
        const conf = Math.min(95, confFloor + velocityPerHour * 8 + dirConsistency * 10 + accelBonus);

        patterns.push({
          sport: first.sport, prop_type: first.prop_type, pattern_type: "velocity_spike",
          avg_reaction_time_minutes: timeDiffMin, avg_move_size: lineDiff,
          confidence: conf, sample_size: snapshots.length,
          cascade_sequence: null, velocity_threshold: velocityPerHour,
          snapback_pct: null, timing_window: `${Math.round(timeDiffMin)}min`,
        });

        const playerKey = `${first.event_id}|${first.player_name}`;
        addAlert(playerKey, conf, {
          type: "velocity_spike", live, sport: first.sport,
          player_name: first.player_name, prop_type: first.prop_type,
          event_description: first.event_description, event_id: first.event_id,
          direction, velocity: Math.round(velocityPerHour * 100) / 100,
          weighted_velocity: Math.round(wVelocity * 100) / 100,
          recent_bias: Math.round(recentBias * 100) / 100,
          line_from: first.line, line_to: last.line,
          dir_consistency: Math.round(dirConsistency * 100),
          time_span_min: Math.round(timeDiffMin), confidence: conf,
          hours_to_tip: last.hours_to_tip,
          adaptive_threshold: adaptiveVMin,
        });
      }
    }

    // ====== PATTERN 2: CASCADE DETECTION ======
    // PRE-GAME ONLY: Cascades during live games are noise (19% win rate).
    // Require opening_line comparison to detect real market-driven multi-prop shifts.
    const preGamePlayerGroups = new Map<string, any[]>();
    for (const row of activeTimeline) {
      // STRICT: pre-game only, must have opening_line
      if (!row.opening_line) continue;
      if (typeof row.hours_to_tip !== "number" || row.hours_to_tip <= 0) continue;
      if (!row.event_id) continue;
      const key = `${row.event_id}|${row.player_name}`;
      if (!preGamePlayerGroups.has(key)) preGamePlayerGroups.set(key, []);
      preGamePlayerGroups.get(key)!.push(row);
    }

    for (const [playerKey, allProps] of preGamePlayerGroups) {
      const propMap = new Map<string, any[]>();
      for (const row of allProps) {
        if (!propMap.has(row.prop_type)) propMap.set(row.prop_type, []);
        propMap.get(row.prop_type)!.push(row);
      }
      if (propMap.size < 2) continue;

      const movedProps: string[] = [];
      const staleProps: string[] = [];
      for (const [propType, snapshots] of propMap) {
        if (snapshots.length < 2) { staleProps.push(propType); continue; }
        const last = snapshots[snapshots.length - 1];
        // Compare against opening_line — NOT first snapshot
        const drift = Math.abs(last.line - last.opening_line);
        drift >= 0.5 ? movedProps.push(propType) : staleProps.push(propType);
      }

      // Cascade deprioritized (19% win rate) — require 2+ moved props AND pending props
      if (movedProps.length >= 2 && staleProps.length > 0) {
        const sampleRow = allProps[0];
        const conf = Math.min(85, 40 + movedProps.length * 15);
        patterns.push({
          sport: sampleRow.sport, prop_type: movedProps[0], pattern_type: "cascade",
          avg_reaction_time_minutes: 0, avg_move_size: 0, confidence: conf,
          sample_size: allProps.length, cascade_sequence: { moved: movedProps, pending: staleProps },
          velocity_threshold: null, snapback_pct: null, timing_window: null,
        });
        const dedupKey = `${sampleRow.event_id}|${sampleRow.player_name}`;
        addAlert(dedupKey, conf, {
          type: "cascade", live: false, sport: sampleRow.sport,
          player_name: sampleRow.player_name, event_description: sampleRow.event_description,
          event_id: sampleRow.event_id, moved_props: movedProps, pending_props: staleProps,
          confidence: conf, hours_to_tip: sampleRow.hours_to_tip,
        });
      }
    }

    // ====== PATTERN 3: SNAPBACK DETECTION ======
    for (const [key, snapshots] of groups) {
      if (snapshots.length < 3) continue;
      const last = snapshots[snapshots.length - 1];
      // SUPPRESS: live team markets are game-score noise
      if (isLiveTeamMarketNoise(last)) continue;
      const openingLine = last.opening_line;
      if (!openingLine) continue;
      const drift = Math.abs(last.line - openingLine);
      const driftPct = (drift / openingLine) * 100;

      if (driftPct >= 8) {
        const live = isLive(last);
        const conf = Math.min(80, 35 + driftPct * 2);
        // Keep pattern detection for analytics only
        patterns.push({
          sport: last.sport, prop_type: last.prop_type, pattern_type: "snapback_candidate",
          avg_reaction_time_minutes: 0, avg_move_size: drift, confidence: conf,
          sample_size: snapshots.length, cascade_sequence: null,
          velocity_threshold: null, snapback_pct: driftPct, timing_window: null,
        });
        // BLOCKED: snapback is a poison signal (0-17% win rate) — do NOT create alerts or Telegram messages
        log(`🚫 Snapback blocked (poison signal): ${last.player_name} ${last.prop_type} drift ${driftPct.toFixed(1)}%`);
      }
    }

    // ====== PATTERN 4: TAKE IT NOW — OPTIMAL ENTRY POINT ======
    // Uses historical drift ranges + Sweet Spot edge thresholds to detect
    // when a line has moved far enough to be actionable NOW.
    // Sweet Spot edge minimums: Points 5.5, Rebounds 3.0, Assists 2.5, Threes 1.2
    const TYPICAL_DRIFT: Record<string, number> = {
      player_points: 4.35,
      player_rebounds: 2.21,
      player_assists: 1.82,
      player_threes: 1.30,
      player_points_rebounds_assists: 1.13,
      player_points_rebounds: 1.04,
      player_points_assists: 1.03,
      player_rebounds_assists: 1.00,
      player_shots_on_goal: 1.00,
      player_steals: 0.75,
      player_blocks: 0.75,
      player_turnovers: 0.75,
      spreads: 2.53,
      totals: 2.31,
      moneyline: 50,
      h2h: 50,
    };

    // EDGE_MINIMUMS already declared above

    // Tightened entry: 55-80% of typical drift range
    const ENTRY_MIN_PCT = 0.55;
    const ENTRY_MAX_PCT = 0.80;
    const MIN_SNAPSHOTS = 5; // Need 5+ timeline entries to confirm drift is real

    // Query recent historical drift for this session to refine defaults
    const { data: recentDrifts } = await supabase
      .from("fanduel_line_timeline")
      .select("prop_type, event_id, player_name, line")
      .gte("created_at", new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1000);

    // Build learned drift map from recent data
    const learnedDrift = new Map<string, number[]>();
    if (recentDrifts && recentDrifts.length > 0) {
      const driftGroups = new Map<string, { min: number; max: number }>();
      for (const r of recentDrifts) {
        const k = `${r.event_id}|${r.player_name}|${r.prop_type}`;
        const existing = driftGroups.get(k);
        if (!existing) {
          driftGroups.set(k, { min: r.line, max: r.line });
        } else {
          existing.min = Math.min(existing.min, r.line);
          existing.max = Math.max(existing.max, r.line);
        }
      }
      for (const [k, v] of driftGroups) {
        const drift = v.max - v.min;
        if (drift > 0) {
          const propType = k.split("|")[2];
          if (!learnedDrift.has(propType)) learnedDrift.set(propType, []);
          learnedDrift.get(propType)!.push(drift);
        }
      }
    }

    // Compute learned averages
    const learnedAvgDrift = new Map<string, number>();
    for (const [propType, drifts] of learnedDrift) {
      const avg = drifts.reduce((a, b) => a + b, 0) / drifts.length;
      learnedAvgDrift.set(propType, avg);
    }

    for (const [key, snapshots] of groups) {
      if (snapshots.length < MIN_SNAPSHOTS) continue; // Need 5+ data points
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      // SUPPRESS: live team markets are game-score noise
      if (isLiveTeamMarketNoise(last)) continue;
      const openingLine = last.opening_line || first.line;
      const currentDrift = Math.abs(last.line - openingLine);

      // Must exceed edge minimum for this prop type
      const edgeMin = EDGE_MINIMUMS[first.prop_type] || 0.5;
      if (currentDrift < edgeMin) continue;

      // Use learned drift if available, fall back to static defaults
      const expectedDrift = learnedAvgDrift.get(first.prop_type) || TYPICAL_DRIFT[first.prop_type] || 1.5;
      const driftRatio = currentDrift / expectedDrift;

      // Sweet spot: moved 55-80% of typical range (tightened)
      if (driftRatio >= ENTRY_MIN_PCT && driftRatio <= ENTRY_MAX_PCT) {
        const live = isLive(last);
        const direction = last.line < openingLine ? "dropping" : "rising";

        // Check directional consistency (at least 50% of moves in same direction)
        let consistentMoves = 0;
        const lineDiff = last.line - openingLine;
        for (let i = 1; i < snapshots.length; i++) {
          const move = snapshots[i].line - snapshots[i - 1].line;
          if ((lineDiff > 0 && move > 0) || (lineDiff < 0 && move < 0)) consistentMoves++;
        }
        const dirConsistency = consistentMoves / (snapshots.length - 1);
        if (dirConsistency < 0.4) continue; // Skip noisy/choppy lines

        // Confidence: scales with drift ratio position + consistency + snapshot count
        const sweetSpotCenter = 0.67;
        const distFromCenter = Math.abs(driftRatio - sweetSpotCenter);
        const conf = Math.min(92, 68 + (1 - distFromCenter * 5) * 12 + Math.min(dirConsistency * 10, 5));

        // Don't duplicate if we already have a stronger signal for this player
        const playerKey = `${first.event_id}|${first.player_name}`;
        const existing = bestAlertPerPlayer.get(playerKey);
        if (existing && existing.confidence > conf + 5) continue;

        patterns.push({
          sport: first.sport, prop_type: first.prop_type, pattern_type: "take_it_now",
          avg_reaction_time_minutes: 0, avg_move_size: currentDrift,
          confidence: conf, sample_size: snapshots.length,
          cascade_sequence: null, velocity_threshold: null,
          snapback_pct: null, timing_window: `${Math.round(driftRatio * 100)}% of range`,
        });

        addAlert(playerKey, conf + 15, { // High priority — actionable NOW
          type: "take_it_now", live, sport: first.sport,
          player_name: first.player_name, prop_type: first.prop_type,
          event_description: first.event_description, event_id: first.event_id,
          direction,
          opening_line: openingLine, current_line: last.line,
          drift_amount: Math.round(currentDrift * 100) / 100,
          drift_pct_of_range: Math.round(driftRatio * 100),
          expected_drift: Math.round(expectedDrift * 100) / 100,
          remaining_move: Math.round((expectedDrift - currentDrift) * 100) / 100,
          edge_minimum: edgeMin,
          dir_consistency: Math.round(dirConsistency * 100),
          confidence: conf,
          hours_to_tip: last.hours_to_tip,
        });
      }
    }

    let patternsUpserted = 0;
    for (const p of patterns) {
      const { error } = await supabase
        .from("fanduel_behavior_patterns")
        .upsert(p, { onConflict: "sport,prop_type,pattern_type" });
      if (!error) patternsUpserted++;
    }

    // Collect deduped alerts (one per player)
    let alerts = Array.from(bestAlertPerPlayer.values()).map((v) => v.alert);

    // ====== CONFLICT FILTER: Same event + same prop_type = opposing sides ======
    // For team markets (h2h, spreads, totals), two teams in same game can't both be picks
    const TEAM_PROP_TYPES = ["h2h", "spreads", "totals", "moneyline"];
    const eventPropGroups = new Map<string, typeof alerts>();
    for (const a of alerts) {
      if (TEAM_PROP_TYPES.includes(a.prop_type)) {
        const conflictKey = `${a.event_id}|${a.prop_type}`;
        if (!eventPropGroups.has(conflictKey)) eventPropGroups.set(conflictKey, []);
        eventPropGroups.get(conflictKey)!.push(a);
      }
    }
    // For each conflict group, keep only the strongest signal
    const droppedPlayers = new Set<string>();
    for (const [, group] of eventPropGroups) {
      if (group.length <= 1) continue;
      group.sort((a, b) => (b.velocity || b.confidence || 0) - (a.velocity || a.confidence || 0));
      for (let i = 1; i < group.length; i++) {
        // BUG H FIX: scope the drop to the specific prop_type that conflicted
        droppedPlayers.add(`${group[i].event_id}|${group[i].player_name}|${group[i].prop_type}`);
        log(`⚠ Dropped conflicting signal: ${group[i].player_name} ${group[i].prop_type} (kept ${group[0].player_name})`);
      }
    }

    // Also check for same-player contradictions across different pattern types
    // e.g. velocity says TAKE spread but snapback says FADE spread for same team
    const playerPropGroups = new Map<string, typeof alerts>();
    for (const a of alerts) {
      const ppKey = `${a.event_id}|${a.player_name}|${a.prop_type}`;
      if (!playerPropGroups.has(ppKey)) playerPropGroups.set(ppKey, []);
      playerPropGroups.get(ppKey)!.push(a);
    }
    for (const [, group] of playerPropGroups) {
      if (group.length <= 1) continue;
      // Multiple alerts for same player + same prop = keep strongest only
      group.sort((a, b) => (b.velocity || b.confidence || 0) - (a.velocity || a.confidence || 0));
      for (let i = 1; i < group.length; i++) {
        droppedPlayers.add(`${group[i].event_id}|${group[i].player_name}|${group[i].prop_type}`);
        log(`⚠ Dropped same-player conflicting ${group[i].type}: ${group[i].player_name} ${group[i].prop_type}`);
      }
    }

    if (droppedPlayers.size > 0) {
      alerts = alerts.filter(a => !droppedPlayers.has(`${a.event_id}|${a.player_name}|${a.prop_type}`));
    }

    // ====== CROSS-RUN DEDUP: Don't re-insert same player+prop+signal within 2 hours ======
    const { data: recentPreds } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("player_name, prop_type, signal_type, event_id")
      .gte("created_at", twoHoursAgo)
      .limit(1000);

    const recentPredKeys = new Set(
      (recentPreds || []).map(r => `${r.event_id}|${r.player_name}|${r.prop_type}|${r.signal_type}`)
    );

    // ====== MINUTES VOLATILITY GATE ======
    // Query L10 minutes for all unique players in alerts, flag high-CV players
    const VOLATILITY_EXTRA_BUFFER = 2.0; // kept for volatility warning display only
    const VOLATILITY_CV_THRESHOLD = 0.20; // 20%
    const volatilityMap = new Map<string, { avgMin: number; cv: number; isVolatile: boolean }>();

    const sportTableMap: Record<string, { table: string; col: string }> = {
      NBA: { table: "nba_player_game_logs", col: "minutes_played" },
      NCAAB: { table: "ncaab_player_game_logs", col: "minutes_played" },
      NHL: { table: "nhl_player_game_logs", col: "minutes_played" },
    };

    // Collect unique player+sport combos from individual player alerts (skip aggregate signals)
    const playerSportPairs = new Map<string, string>();
    for (const a of alerts) {
      if (a.players_moving) {
        // Aggregate signal — check each individual player
        for (const p of a.players_moving) {
          if (p.name && a.sport) playerSportPairs.set(p.name, a.sport);
        }
      } else if (a.player_name && a.sport && !a.player_name.includes(" players") && !a.player_name.includes(" games")) {
        playerSportPairs.set(a.player_name, a.sport);
      }
    }

    // Batch query per sport
    for (const [sport, cfg] of Object.entries(sportTableMap)) {
      const playersForSport = [...playerSportPairs.entries()].filter(([, s]) => s === sport).map(([name]) => name);
      if (playersForSport.length === 0) continue;

      const { data: gameLogs, error: glErr } = await supabase
        .from(cfg.table)
        .select(`player_name, ${cfg.col}, game_date`)
        .in("player_name", playersForSport)
        .order("game_date", { ascending: false })
        .limit(playersForSport.length * 10);

      if (glErr) {
        log(`⚠ Volatility lookup error (${sport}): ${glErr.message}`);
        continue;
      }

      // Group by player, take last 10
      const byPlayer = new Map<string, number[]>();
      for (const gl of (gameLogs || [])) {
        const mins = gl[cfg.col];
        if (mins == null || mins <= 0) continue;
        const pName = gl.player_name;
        if (!byPlayer.has(pName)) byPlayer.set(pName, []);
        const arr = byPlayer.get(pName)!;
        if (arr.length < 10) arr.push(mins);
      }

      for (const [pName, minutes] of byPlayer) {
        if (minutes.length < 5) continue; // Need at least 5 games for meaningful CV
        const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
        const variance = minutes.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / minutes.length;
        const stdDev = Math.sqrt(variance);
        const cv = avg > 0 ? stdDev / avg : 0;
        volatilityMap.set(pName, { avgMin: Math.round(avg * 10) / 10, cv: Math.round(cv * 100) / 100, isVolatile: cv > VOLATILITY_CV_THRESHOLD });
      }
    }

    const volatilePlayers = [...volatilityMap.entries()].filter(([, v]) => v.isVolatile);
    if (volatilePlayers.length > 0) {
      log(`⚠️ VOLATILE MINUTES detected: ${volatilePlayers.map(([name, v]) => `${name} (CV ${Math.round(v.cv * 100)}%, avg ${v.avgMin}min)`).join(", ")}`);
    }

    // Attach volatility data to each alert
    for (const a of alerts) {
      if (a.players_moving) {
        // For aggregate signals, check if any player is volatile
        const volPlayers = (a.players_moving || []).filter((p: any) => volatilityMap.get(p.name)?.isVolatile);
        a.has_volatile_players = volPlayers.length > 0;
        a.volatile_player_count = volPlayers.length;
      } else {
        const vol = volatilityMap.get(a.player_name);
        if (vol) {
          a.is_volatile_minutes = vol.isVolatile;
          a.minutes_cv = vol.cv;
          a.minutes_avg = vol.avgMin;
        }
      }
    }

    // ====== MLB PITCHER K CONTEXT ======
    // Fetch L3/L10 pitcher strikeouts + matchup data for all MLB pitcher alerts
    const MLB_PITCHER_PROPS = new Set(["pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_earned_runs"]);
    const mlbPitcherNames = [...new Set(
      alerts
        .filter(a => MLB_PITCHER_PROPS.has(a.prop_type) && a.player_name)
        .map(a => a.player_name)
    )];

    interface PitcherContext { l10Avg: number; l3Avg: number; avgIP: number; matchupAvg: number | null; matchupGames: number; }
    const pitcherContextMap = new Map<string, PitcherContext>();

    if (mlbPitcherNames.length > 0) {
      const { data: mlbLogs, error: mlbErr } = await supabase
        .from("mlb_player_game_logs")
        .select("player_name, opponent, game_date, pitcher_strikeouts, innings_pitched, earned_runs, pitcher_hits_allowed")
        .in("player_name", mlbPitcherNames)
        .not("pitcher_strikeouts", "is", null)
        .order("game_date", { ascending: false })
        .limit(mlbPitcherNames.length * 15);

      if (!mlbErr && mlbLogs) {
        const byPitcher = new Map<string, any[]>();
        for (const gl of mlbLogs) {
          if (gl.innings_pitched == null || gl.innings_pitched <= 0) continue;
          const name = gl.player_name;
          if (!byPitcher.has(name)) byPitcher.set(name, []);
          byPitcher.get(name)!.push(gl);
        }

        for (const [name, logs] of byPitcher) {
          if (logs.length < 3) continue;
          const l10 = logs.slice(0, 10);
          const l3 = logs.slice(0, 3);
          const l10Ks = l10.map((g: any) => Number(g.pitcher_strikeouts) || 0);
          const l3Ks = l3.map((g: any) => Number(g.pitcher_strikeouts) || 0);
          const ipValues = l10.map((g: any) => Number(g.innings_pitched) || 0);
          const l10Avg = l10Ks.reduce((a: number, b: number) => a + b, 0) / l10Ks.length;
          const l3Avg = l3Ks.reduce((a: number, b: number) => a + b, 0) / l3Ks.length;
          const avgIP = ipValues.reduce((a: number, b: number) => a + b, 0) / ipValues.length;
          pitcherContextMap.set(name, { l10Avg, l3Avg, avgIP, matchupAvg: null, matchupGames: 0, l10Ks });
        }

        // Resolve matchup: check opponent from event_description against game logs
        for (const a of alerts) {
          if (!MLB_PITCHER_PROPS.has(a.prop_type)) continue;
          const ctx = pitcherContextMap.get(a.player_name);
          if (!ctx) continue;
          const edLower = (a.event_description || "").toLowerCase();
          const logs = byPitcher.get(a.player_name) || [];
          const oppPerf: number[] = [];
          for (const gl of logs) {
            const opp = (gl.opponent || "").toLowerCase();
            if (opp && edLower.includes(opp)) {
              oppPerf.push(Number(gl.pitcher_strikeouts) || 0);
            }
          }
          if (oppPerf.length > 0) {
            ctx.matchupAvg = oppPerf.reduce((a, b) => a + b, 0) / oppPerf.length;
            ctx.matchupGames = oppPerf.length;
          }
        }
        log(`MLB pitcher context loaded: ${pitcherContextMap.size} pitchers`);
      }
    }

    // ====== CROSS-REFERENCE BLOCKING GATE ======
    // Load NBA/NHL L10 stats for non-MLB player props
    const NBA_PLAYER_PROPS = new Set(["player_points", "player_rebounds", "player_assists", "player_threes", "player_pra", "player_pts_reb", "player_pts_ast", "player_reb_ast", "player_steals", "player_blocks", "player_turnovers", "player_steals_blocks", "player_double_double"]);
    const NHL_PLAYER_PROPS = new Set(["player_shots_on_goal", "player_points", "player_assists", "player_goals", "player_saves", "player_blocked_shots"]);

    // Generic L10 context for NBA/NHL
    interface PlayerL10Context { l10Avg: number; l3Avg: number; hitRateOver: number; hitRateUnder: number; matchupAvg: number | null; matchupGames: number; }
    const playerL10Map = new Map<string, PlayerL10Context>();

    // Collect unique NBA player props needing validation
    const nbaPlayerNames = [...new Set(alerts.filter(a => a.sport === "NBA" && NBA_PLAYER_PROPS.has(a.prop_type) && a.player_name).map(a => `${a.player_name}|||${a.prop_type}|||${a.current_line ?? a.line_to ?? 0}`))];
    const nhlPlayerNames = [...new Set(alerts.filter(a => a.sport === "NHL" && NHL_PLAYER_PROPS.has(a.prop_type) && a.player_name).map(a => `${a.player_name}|||${a.prop_type}|||${a.current_line ?? a.line_to ?? 0}`))];

    // Helper to map prop_type to game log column
    function propToColumn(propType: string, sport: string): string | null {
      if (sport === "NBA" || sport === "NCAAB") {
        const map: Record<string, string> = { player_points: "points", player_rebounds: "rebounds", player_assists: "assists", player_threes: "three_pointers_made", player_steals: "steals", player_blocks: "blocks", player_turnovers: "turnovers" };
        return map[propType] || null;
      }
      if (sport === "NHL") {
        const map: Record<string, string> = { player_shots_on_goal: "shots_on_goal", player_goals: "goals", player_assists: "assists", player_points: "points", player_saves: "saves", player_blocked_shots: "blocked_shots" };
        return map[propType] || null;
      }
      return null;
    }

    // Fetch NBA L10 data
    if (nbaPlayerNames.length > 0) {
      const uniqueNames = [...new Set(nbaPlayerNames.map(n => n.split("|||")[0]))];
      const { data: nbaLogs } = await supabase
        .from("nba_player_game_logs")
        .select("player_name, points, rebounds, assists, three_pointers_made, steals, blocks, turnovers, game_date")
        .in("player_name", uniqueNames)
        .order("game_date", { ascending: false })
        .limit(uniqueNames.length * 12);

      if (nbaLogs) {
        for (const entry of nbaPlayerNames) {
          const [name, propType, lineStr] = entry.split("|||");
          const line = parseFloat(lineStr);
          const col = propToColumn(propType, "NBA");
          if (!col) continue;
          const playerLogs = nbaLogs.filter(g => g.player_name === name && g[col] != null);
          if (playerLogs.length < 3) continue;
          const l10 = playerLogs.slice(0, 10).map(g => Number(g[col]) || 0);
          const l3 = playerLogs.slice(0, 3).map(g => Number(g[col]) || 0);
          const l10Avg = l10.reduce((a, b) => a + b, 0) / l10.length;
          const l3Avg = l3.reduce((a, b) => a + b, 0) / l3.length;
          const hitOver = l10.filter(v => v > line).length / l10.length * 100;
          const hitUnder = l10.filter(v => v < line).length / l10.length * 100;
          playerL10Map.set(`${name}|${propType}`, { l10Avg, l3Avg, hitRateOver: hitOver, hitRateUnder: hitUnder, matchupAvg: null, matchupGames: 0 });
        }
        log(`NBA L10 context loaded: ${playerL10Map.size} player/prop combos`);
      }
    }

    // Fetch NHL L10 data
    if (nhlPlayerNames.length > 0) {
      const uniqueNames = [...new Set(nhlPlayerNames.map(n => n.split("|||")[0]))];
      const { data: nhlLogs } = await supabase
        .from("nhl_player_game_logs")
        .select("player_name, shots_on_goal, goals, assists, points, saves, blocked_shots, game_date")
        .in("player_name", uniqueNames)
        .order("game_date", { ascending: false })
        .limit(uniqueNames.length * 12);

      if (nhlLogs) {
        for (const entry of nhlPlayerNames) {
          const [name, propType, lineStr] = entry.split("|||");
          const line = parseFloat(lineStr);
          const col = propToColumn(propType, "NHL");
          if (!col) continue;
          const playerLogs = nhlLogs.filter(g => g.player_name === name && g[col] != null);
          if (playerLogs.length < 3) continue;
          const l10 = playerLogs.slice(0, 10).map(g => Number(g[col]) || 0);
          const l3 = playerLogs.slice(0, 3).map(g => Number(g[col]) || 0);
          const l10Avg = l10.reduce((a, b) => a + b, 0) / l10.length;
          const l3Avg = l3.reduce((a, b) => a + b, 0) / l3.length;
          const hitOver = l10.filter(v => v > line).length / l10.length * 100;
          const hitUnder = l10.filter(v => v < line).length / l10.length * 100;
          playerL10Map.set(`${name}|${propType}`, { l10Avg, l3Avg, hitRateOver: hitOver, hitRateUnder: hitUnder, matchupAvg: null, matchupGames: 0 });
        }
        log(`NHL L10 context loaded: ${playerL10Map.size} total player/prop combos`);
      }
    }

    // Cross-reference gate function — returns block reason or null (pass)
    function crossRefGate(a: any): string | null {
      const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
      if (isTeamMarket) return null; // Team markets validated elsewhere
      if (a.type === "cascade" || a.type === "correlated_movement" || a.type === "team_news_shift") return null; // Aggregate signals skip individual gate

      // Determine action side
      let actionSide: string | null = null;
      if (a.type === "take_it_now" || a.type === "line_about_to_move" || a.type === "velocity_spike") {
        actionSide = a.direction === "dropping" ? "UNDER" : "OVER";
       } else if (a.type === "snapback") {
        const isPitcherProp = a.prop_type?.startsWith("pitcher_");
        if (isPitcherProp) {
          // Pitcher props follow market movement (rising = OVER)
          actionSide = (a.current_line > a.opening_line) ? "OVER" : "UNDER";
        } else {
          actionSide = (a.current_line > a.opening_line) ? "UNDER" : "OVER";
        }
       }
       if (!actionSide) return null;

      const line = a.current_line ?? a.line_to ?? null;
      if (line == null) return null;

      // MLB pitcher props — use pitcherContextMap
      if (MLB_PITCHER_PROPS.has(a.prop_type)) {
        const ctx = pitcherContextMap.get(a.player_name);
        if (!ctx) return null; // No data = can't block

        // Snapback-specific: if line rose and we say UNDER, but L10 avg is ABOVE the line, block it
        if (a.type === "snapback" && actionSide === "UNDER" && ctx.l10Avg > line) {
          return `Snapback UNDER blocked: L10 avg ${ctx.l10Avg.toFixed(1)} > line ${line} — pitcher averages more Ks`;
        }
        if (a.type === "snapback" && actionSide === "OVER" && ctx.l10Avg < line) {
          return `Snapback OVER blocked: L10 avg ${ctx.l10Avg.toFixed(1)} < line ${line} — pitcher averages fewer Ks`;
        }

        // Hard block: L10 avg >10% against line AND hit rate <30%
        const edgePct = ((ctx.l10Avg - line) / line) * 100;
        if (actionSide === "OVER" && edgePct < -10) {
          const hitRate = (ctx.l10Avg > line) ? 100 : 0; // simplified — compute from logs
          // L10 avg is well below the line but we're saying OVER
          return `Hard block: L10 avg ${ctx.l10Avg.toFixed(1)} is ${Math.abs(edgePct).toFixed(0)}% below line ${line} for OVER`;
        }
        if (actionSide === "UNDER" && edgePct > 10) {
          return `Hard block: L10 avg ${ctx.l10Avg.toFixed(1)} is ${edgePct.toFixed(0)}% above line ${line} for UNDER`;
        }

        // Pitcher K gate: L3 >15% against line AND matchup doesn't support
        const l3Edge = ((ctx.l3Avg - line) / line) * 100;
        if (actionSide === "OVER" && l3Edge < -15 && (ctx.matchupAvg === null || ctx.matchupAvg < line)) {
          return `Pitcher K gate: L3 avg ${ctx.l3Avg.toFixed(1)} is ${Math.abs(l3Edge).toFixed(0)}% below line for OVER, matchup doesn't support`;
        }
        if (actionSide === "UNDER" && l3Edge > 15 && (ctx.matchupAvg === null || ctx.matchupAvg > line)) {
          return `Pitcher K gate: L3 avg ${ctx.l3Avg.toFixed(1)} is ${l3Edge.toFixed(0)}% above line for UNDER, matchup doesn't support`;
        }

        return null;
      }

      // NBA/NHL player props — use playerL10Map
      const l10Key = `${a.player_name}|${a.prop_type}`;
      const ctx = playerL10Map.get(l10Key);
      if (!ctx) return null; // No data = can't block

      // Hard block: L10 avg >10% against line AND hit rate <30%
      const edgePct = ((ctx.l10Avg - line) / line) * 100;
      if (actionSide === "OVER" && edgePct < -10 && ctx.hitRateOver < 30) {
        return `Hard block: L10 avg ${ctx.l10Avg.toFixed(1)} (${ctx.hitRateOver.toFixed(0)}% over rate) contradicts OVER ${line}`;
      }
      if (actionSide === "UNDER" && edgePct > 10 && ctx.hitRateUnder < 30) {
        return `Hard block: L10 avg ${ctx.l10Avg.toFixed(1)} (${ctx.hitRateUnder.toFixed(0)}% under rate) contradicts UNDER ${line}`;
      }

      // Soft block: L10 AND L3 both fail
      const l3Edge = ((ctx.l3Avg - line) / line) * 100;
      if (actionSide === "OVER" && edgePct < -5 && l3Edge < -5 && ctx.hitRateOver < 40) {
        return `Soft block: L10 avg ${ctx.l10Avg.toFixed(1)} & L3 avg ${ctx.l3Avg.toFixed(1)} both below line ${line} for OVER`;
      }
      if (actionSide === "UNDER" && edgePct > 5 && l3Edge > 5 && ctx.hitRateUnder < 40) {
        return `Soft block: L10 avg ${ctx.l10Avg.toFixed(1)} & L3 avg ${ctx.l3Avg.toFixed(1)} both above line ${line} for UNDER`;
      }

      // Snapback validation for NBA/NHL: same logic as pitcher
      if (a.type === "snapback") {
        if (actionSide === "UNDER" && ctx.l10Avg > line * 1.05) {
          return `Snapback UNDER blocked: L10 avg ${ctx.l10Avg.toFixed(1)} is 5%+ above line ${line}`;
        }
        if (actionSide === "OVER" && ctx.l10Avg < line * 0.95) {
          return `Snapback OVER blocked: L10 avg ${ctx.l10Avg.toFixed(1)} is 5%+ below line ${line}`;
        }
      }

      return null;
    }

    // Apply gate to all alerts — separate into passed and blocked
    const gatedAlerts: any[] = [];
    const blockedAlerts: any[] = [];
    for (const a of alerts) {
      const blockReason = crossRefGate(a);
      if (blockReason) {
        log(`🚫 BLOCKED: ${a.player_name} ${a.prop_type} ${a.type} — ${blockReason}`);
        blockedAlerts.push({ ...a, block_reason: blockReason });
      } else {
        gatedAlerts.push(a);
      }
    }
    log(`Cross-ref gate: ${gatedAlerts.length} passed, ${blockedAlerts.length} blocked`);

    // Helper to get pitcher K badge text (with L10 hit rate)
    function getPitcherKBadge(a: any): string {
      const ctx = pitcherContextMap.get(a.player_name);
      if (!ctx) return "";
      const line = a.current_line ?? a.line_to ?? null;

      // BUG I FIX: compute actual hit rate from stored l10Ks values
      let hitRateStr = "";
      if (line != null && ctx.l10Ks && ctx.l10Ks.length > 0) {
        const hitsOver = ctx.l10Ks.filter((k: number) => k > line).length;
        const hitRate = Math.round((hitsOver / ctx.l10Ks.length) * 100);
        const edgePct = ((ctx.l10Avg - line) / line * 100).toFixed(0);
        hitRateStr = ` | Hit Over: ${hitRate}% | Edge: ${edgePct}%`;
      }

      let badge = `⚾ L10 Avg: ${ctx.l10Avg.toFixed(1)} Ks | L3 Avg: ${ctx.l3Avg.toFixed(1)} Ks | Avg IP: ${ctx.avgIP.toFixed(1)}${hitRateStr}`;
      if (ctx.matchupAvg !== null) {
        badge += ` | vs Opp: ${ctx.matchupAvg.toFixed(1)} Ks (${ctx.matchupGames}g)`;
      }
      return badge;
    }

    // Helper to get NBA/NHL L10 badge
    function getPlayerL10Badge(a: any): string {
      const ctx = playerL10Map.get(`${a.player_name}|${a.prop_type}`);
      if (!ctx) return "";
      let badge = `📊 L10: ${ctx.l10Avg.toFixed(1)} | L3: ${ctx.l3Avg.toFixed(1)} | Hit: ${ctx.hitRateOver.toFixed(0)}% over / ${ctx.hitRateUnder.toFixed(0)}% under`;
      if (ctx.matchupAvg !== null) {
        badge += ` | vs Opp: ${ctx.matchupAvg.toFixed(1)} (${ctx.matchupGames}g)`;
      }
      return badge;
    }

    // Use gatedAlerts instead of alerts from here on
    // ====== STORE ALERTS AS PREDICTION ACCURACY RECORDS ======
    const predRows = (await Promise.all(gatedAlerts
      .filter(a => {
        // BUG F FIX: use signal_type as canonical field name (matches DB column)
        const signalTypeKey = a.signal_type ?? a.type;
        const dedupKey = `${a.event_id}|${a.player_name}|${a.prop_type}|${signalTypeKey}`;
        if (recentPredKeys.has(dedupKey)) {
          log(`⏭ Skipping duplicate: ${a.player_name} ${a.prop_type} ${signalTypeKey}`);
          return false;
        }
        return true;
      })
      .map(async (a) => {
        // Determine prediction text based on signal type
        let predictionText: string;
        if (a.type === "take_it_now") {
          predictionText = `TAKE IT NOW: ${a.current_line} (${a.drift_pct_of_range}% of range, ~${a.remaining_move} more expected)`;
        } else if (a.type === "line_about_to_move") {
          predictionText = `Line ${a.direction} steadily at ${a.velocity}/hr (${a.consistencyRate}% consistent)`;
        } else if (a.type === "cascade") {
          predictionText = `Cascade: ${a.pending_props?.join(",")} will follow ${a.moved_props?.join(",")}`;
        } else if (a.type === "velocity_spike") {
          predictionText = `Line ${a.direction} at ${a.velocity}/hr`;
        } else if (a.type === "snapback") {
          predictionText = `Snapback from ${a.current_line} toward ${a.opening_line}`;
        } else if (a.type === "team_news_shift") {
          // News-driven: go WITH the movement
          const side = a.dominant_direction === "dropping" ? "UNDER" : "OVER";
          predictionText = `Team News Shift: ${(a.players_moving || []).length} players ${a.dominant_direction} (${a.correlation_rate || Math.round((a.cascade_sequence?.correlation || 0) * 100)}% aligned) → ${side}`;
        } else if (a.type === "correlated_movement") {
           // Follow market movement (same as team_news_shift)
           const side = a.dominant_direction === "dropping" ? "UNDER" : "OVER";
           predictionText = `Correlated Movement: ${(a.players_moving || []).length} players ${a.dominant_direction} → ${side}`;
        } else {
          predictionText = `Unknown signal`;
        }

        // Calculate alt line for this prediction
        let actionSide: string | null = null;
        if (a.type === "take_it_now") {
          actionSide = a.direction === "dropping" ? "UNDER" : "OVER";
        } else if (a.type === "line_about_to_move" || a.type === "velocity_spike") {
          actionSide = a.direction === "dropping" ? "UNDER" : "OVER";
         } else if (a.type === "snapback") {
           const isPitcherPropAlt = a.prop_type?.startsWith("pitcher_");
           actionSide = isPitcherPropAlt
             ? (a.current_line > a.opening_line ? "OVER" : "UNDER")
             : (a.current_line > a.opening_line ? "UNDER" : "OVER");
         } else if (a.type === "team_news_shift") {
          actionSide = a.dominant_direction === "dropping" ? "UNDER" : "OVER";
        } else if (a.type === "correlated_movement") {
          actionSide = a.dominant_direction === "dropping" ? "UNDER" : "OVER";
        }

        const lineForAlt = a.current_line ?? a.line_to ?? a.avg_current_line ?? null;
        const altLine = (lineForAlt != null && actionSide)
          ? (await fetchRealAltLine(a.event_id, a.player_name, a.prop_type || "", actionSide, lineForAlt, a.sport || "NBA"))?.line ?? null
          : null;

        return ({
          signal_type: a.type,
          sport: a.sport,
          prop_type: a.prop_type || a.moved_props?.[0] || "unknown",
          player_name: a.player_name,
          event_id: a.event_id,
          prediction: predictionText,
          predicted_direction: a.direction || a.dominant_direction || (a.type === "snapback" ? "revert" : null),
          predicted_magnitude: a.velocity || a.drift_pct || a.drift_amount || null,
          confidence_at_signal: a.confidence,
          velocity_at_signal: a.velocity || null,
          time_to_tip_hours: a.hours_to_tip,
          signal_factors: a,
          line_at_alert: a.current_line ?? null,
          hours_before_tip: a.hours_to_tip ?? null,
          alert_sent_at: new Date().toISOString(),
          snapshots_at_alert: a.snapshot_count ?? a.sample_size ?? null,
          drift_pct_at_alert: a.drift_pct_of_range ?? a.drift_pct ?? null,
          recommended_alt_line: altLine,
          alt_line_source: "fanduel_real",
        });
      }))).filter(Boolean);

    log(`Inserting ${predRows.length} new predictions (${gatedAlerts.length - predRows.length} duplicates skipped, ${blockedAlerts.length} cross-ref blocked)`);

    if (predRows.length > 0) {
      const { error } = await supabase.from("fanduel_prediction_accuracy").insert(predRows);
      if (error) log(`⚠ Prediction insert error: ${error.message}`);
    }

    // ====== SEND TELEGRAM — DEDUPED, GROUPED, PAGINATED ======
    const highConfAlerts = gatedAlerts.filter((a) => a.confidence >= 70);
    if (highConfAlerts.length > 0) {
      // Pre-fetch all alt lines in parallel so formatAlert can be sync
      const altLinePrefetchPromises = highConfAlerts.map(async (a: any) => {
        const line = a.current_line ?? a.line_to ?? a.avg_current_line ?? null;
        if (line == null) return;
        // Determine side for this alert
        let side = "";
        if (a.action) {
          if (a.action.toUpperCase().includes("OVER")) side = "OVER";
          else if (a.action.toUpperCase().includes("UNDER")) side = "UNDER";
        }
        if (!side && a.direction) {
          side = a.direction === "dropping" ? "UNDER" : "OVER";
        }
        if (!side && a.dominant_direction) {
          side = a.dominant_direction === "dropping" ? "UNDER" : "OVER";
        }
        if (side) {
          await fetchRealAltLine(a.event_id, a.player_name, a.prop_type || "", side, line, a.sport || "NBA");
        }
        // Also prefetch for correlated/team_news players
        if (a.players_moving) {
          for (const p of a.players_moving.slice(0, 4)) {
            if (p.current_line != null && a.dominant_direction) {
              const pSide = a.dominant_direction === "dropping" ? "UNDER" : "OVER";
              await fetchRealAltLine(a.event_id, p.name, a.prop_type || "", pSide, p.current_line, a.sport || "NBA");
            }
          }
        }
      });
      await Promise.allSettled(altLinePrefetchPromises);

      const formatAlert = (a: any): string => {
        const liveTag = a.live ? " [🔴 LIVE]" : "";

        // Volatility warning helper
        const getVolatilityWarning = (alert: any): string => {
          if (!alert.is_volatile_minutes) return "";
          return `⚠️ *VOLATILE MINUTES* — L10 avg ${alert.minutes_avg} min (CV ${Math.round(alert.minutes_cv * 100)}%) — extra buffer applied`;
        };

        // Alt line helper — uses pre-fetched cache from fetchRealAltLine
        const getAltLineText = (action: string, currentLine: number | null, propType: string, playerName: string, eventId: string): string => {
          if (currentLine == null) return "";
          const isOver = action.toUpperCase().includes("OVER");
          const isUnder = action.toUpperCase().includes("UNDER");
          if (!isOver && !isUnder) return "";
          const side = isOver ? "OVER" : "UNDER";
          const cacheKey = `${eventId}|${playerName}|${propType}`;
          const cached = altLineCache.get(cacheKey);
          if (!cached) return "🎯 *Alt Line: unavailable*";
          return `🎯 *Alt Line (FanDuel): ${side} ${cached.line} (${fmtAltOdds(cached.odds)})*`;
        };

        // Combined stats badge (pitcher K or NBA/NHL L10)
        const getStatsBadge = (alert: any): string => {
          const pkBadge = getPitcherKBadge(alert);
          if (pkBadge) return pkBadge;
          return getPlayerL10Badge(alert);
        };

        // ====== TAKE IT NOW — OPTIMAL ENTRY POINT ======
        if (a.type === "take_it_now") {
          const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
          let action: string;
          let reason: string;
          if (isTeamMarket && (a.prop_type === "h2h" || a.prop_type === "moneyline")) {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `BACK ${esc(a.player_name)}${gameName}` : `FADE ${esc(a.player_name)}${gameName}`;
            reason = `Line at ${a.drift_pct_of_range}% of typical range — ~${a.remaining_move} more movement expected`;
          } else if (isTeamMarket && a.prop_type === "spreads") {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `TAKE ${esc(a.player_name)} SPREAD${gameName}` : `FADE ${esc(a.player_name)} SPREAD${gameName}`;
            reason = `Spread at ${a.drift_pct_of_range}% of range — expect ~${a.remaining_move} more`;
          } else if (isTeamMarket && a.prop_type === "totals") {
            const gameName = a.event_description ? esc(a.event_description) : esc(a.player_name);
            action = a.direction === "dropping" ? `UNDER ${gameName}` : `OVER ${gameName}`;
            reason = `Total at ${a.drift_pct_of_range}% of range — ~${a.remaining_move} more expected`;
          } else {
            action = a.direction === "dropping" ? `UNDER ${a.current_line}` : `OVER ${a.current_line}`;
            reason = a.direction === "dropping"
              ? `Dropped ${a.drift_amount} pts (${a.drift_pct_of_range}% of typical ${a.expected_drift} drift) — line dropping = sharp money on under`
              : `Rose ${a.drift_amount} pts (${a.drift_pct_of_range}% of typical ${a.expected_drift} drift) — line rising = sharp money on over`;
          }
          const propLabel = isTeamMarket ? a.prop_type.toUpperCase() : esc(a.prop_type).replace("player ", "").toUpperCase();
          const displayName = (isTeamMarket && a.prop_type === "totals" && a.event_description)
            ? esc(a.event_description)
            : esc(a.player_name);
          const altLineMsg = isTeamMarket ? "" : getAltLineText(action, a.current_line, a.prop_type, a.player_name, a.event_id);
          const volWarning = getVolatilityWarning(a);
          const statsBadge = getStatsBadge(a);
          return [
            `🔥 *TAKE IT NOW*${liveTag} — ${esc(a.sport)}`,
            `${displayName} ${propLabel}`,
            `Open: ${a.opening_line} → Now: ${a.current_line} (moved ${a.drift_amount})`,
            `📏 ${a.drift_pct_of_range}% of typical range (avg drift: ${a.expected_drift})`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            ...(statsBadge ? [statsBadge] : []),
            `✅ *Action: ${action}*`,
            ...(volWarning ? [volWarning] : []),
            ...(altLineMsg ? [altLineMsg] : []),
            `💡 ${reason}`,
          ].join("\n");
        }

        // ====== LINE ABOUT TO MOVE (primary signal) ======
        if (a.type === "line_about_to_move") {
          const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
          let action: string;
          let reason: string;
          if (isTeamMarket && (a.prop_type === "h2h" || a.prop_type === "moneyline")) {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `BACK ${esc(a.player_name)}${gameName}` : `FADE ${esc(a.player_name)}${gameName}`;
            reason = "Steady drift = smart money building position";
          } else if (isTeamMarket && a.prop_type === "spreads") {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `TAKE ${esc(a.player_name)} SPREAD${gameName}` : `FADE ${esc(a.player_name)} SPREAD${gameName}`;
            reason = "Spread steadily shifting = sharps accumulating";
          } else if (isTeamMarket && a.prop_type === "totals") {
            const gameName = a.event_description ? esc(a.event_description) : esc(a.player_name);
            action = a.direction === "dropping" ? `UNDER ${gameName}` : `OVER ${gameName}`;
            reason = a.direction === "dropping"
              ? "Total steadily dropping = money on under"
              : "Total steadily rising = money on over";
          } else {
            action = a.direction === "dropping" ? "UNDER" : "OVER";
            reason = a.direction === "dropping"
              ? "Line consistently dropping = sharps expecting under"
              : "Line consistently rising = sharps expecting over";
          }
          const propLabel = isTeamMarket ? a.prop_type.toUpperCase() : esc(a.prop_type).replace("player ", "").toUpperCase();
          const displayName = (isTeamMarket && a.prop_type === "totals" && a.event_description)
            ? esc(a.event_description)
            : esc(a.player_name);
          const altLineMsg = isTeamMarket ? "" : getAltLineText(action, a.line_to, a.prop_type, a.player_name, a.event_id);
          const volWarning = getVolatilityWarning(a);
          const statsBadge = getStatsBadge(a);
          return [
            `🎯 *LINE ABOUT TO MOVE*${liveTag} — ${esc(a.sport)}`,
            `${displayName} ${propLabel}`,
            `Line ${a.direction}: ${a.line_from} → ${a.line_to}`,
            `Consistency: ${a.consistencyRate}% | Speed: ${a.velocity}/hr`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            ...(statsBadge ? [statsBadge] : []),
            `✅ *Action: ${action}${isTeamMarket ? "" : ` ${a.line_to}`}*`,
            ...(volWarning ? [volWarning] : []),
            ...(altLineMsg ? [altLineMsg] : []),
            `💡 ${reason}`,
          ].join("\n");
        }

        if (a.type === "velocity_spike") {
          const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
          let action: string;
          let reason: string;
          if (isTeamMarket && (a.prop_type === "h2h" || a.prop_type === "moneyline")) {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `BACK ${esc(a.player_name)}${gameName}` : `FADE ${esc(a.player_name)}${gameName}`;
            reason = a.direction === "dropping"
              ? "Odds shortening = sharp money on this team"
              : "Odds drifting = money moving away from this team";
          } else if (isTeamMarket && a.prop_type === "spreads") {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.direction === "dropping" ? `TAKE ${esc(a.player_name)} SPREAD${gameName}` : `FADE ${esc(a.player_name)} SPREAD${gameName}`;
            reason = a.direction === "dropping"
              ? "Spread tightening = sharps backing this side"
              : "Spread widening = sharps fading this side";
          } else if (isTeamMarket && a.prop_type === "totals") {
            const gameName = a.event_description ? esc(a.event_description) : esc(a.player_name);
            action = a.direction === "dropping" ? `UNDER ${gameName}` : `OVER ${gameName}`;
            reason = a.direction === "dropping"
              ? "Total dropping = sharps expecting low-scoring game"
              : "Total rising = sharps expecting high-scoring game";
          } else {
            action = a.direction === "dropping" ? "UNDER" : "OVER";
            reason = a.direction === "dropping"
              ? "Line dropping = sharp money expects under"
              : "Line rising = sharp money expects over";
          }
          const propLabel = isTeamMarket ? a.prop_type.toUpperCase() : esc(a.prop_type).replace("player ", "").toUpperCase();
          const displayName = (isTeamMarket && a.prop_type === "totals" && a.event_description)
            ? esc(a.event_description)
            : esc(a.player_name);
          const altLineMsg = isTeamMarket ? "" : getAltLineText(action, a.line_to, a.prop_type, a.player_name, a.event_id);
          const volWarning = getVolatilityWarning(a);
          const statsBadge = getStatsBadge(a);
          return [
            `⚡ *VELOCITY*${liveTag} — ${esc(a.sport)}`,
            `${displayName} ${propLabel}`,
            `Line ${a.direction}: ${a.line_from} → ${a.line_to}`,
            `Speed: ${a.velocity}/hr over ${a.time_span_min}min`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            ...(statsBadge ? [statsBadge] : []),
            `✅ *Action: ${action}${isTeamMarket ? "" : ` ${a.line_to}`}*`,
            ...(volWarning ? [volWarning] : []),
            ...(altLineMsg ? [altLineMsg] : []),
            `💡 ${reason}`,
          ].join("\n");
        }
        if (a.type === "cascade") {
          return [
            `🌊 *CASCADE*${liveTag} — ${esc(a.sport)}`,
            `${esc(a.player_name)}`,
            `Moved: ${(a.moved_props || []).map(esc).join(", ")}`,
            `⏳ Pending: ${(a.pending_props || []).map(esc).join(", ")}`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: Grab pending props NOW*`,
            `💡 Related props follow within 5-15 min`,
          ].join("\n");
        }
        if (a.type === "snapback") {
          const isTeamMarket = ["h2h", "moneyline", "spreads", "totals"].includes(a.prop_type);
          let action: string;
          let reason: string;
          if (isTeamMarket && (a.prop_type === "h2h" || a.prop_type === "moneyline")) {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.current_line > a.opening_line ? `FADE ${esc(a.player_name)}${gameName}` : `BACK ${esc(a.player_name)}${gameName}`;
            reason = a.current_line > a.opening_line
              ? "Odds drifted too far — expect correction back"
              : "Odds dropped too far — expect reversion";
          } else if (isTeamMarket && a.prop_type === "spreads") {
            const gameName = a.event_description ? ` (${esc(a.event_description)})` : "";
            action = a.current_line > a.opening_line ? `FADE ${esc(a.player_name)} SPREAD${gameName}` : `TAKE ${esc(a.player_name)} SPREAD${gameName}`;
            reason = a.current_line > a.opening_line
              ? "Spread inflated past open — expect snapback"
              : "Spread compressed past open — expect reversion";
          } else if (isTeamMarket && a.prop_type === "totals") {
            const gameName = a.event_description ? esc(a.event_description) : esc(a.player_name);
            action = a.current_line > a.opening_line ? `UNDER ${gameName}` : `OVER ${gameName}`;
            reason = a.current_line > a.opening_line
              ? "Total inflated above open — snaps back down"
              : "Total deflated below open — snaps back up";
           } else {
             const isPitcherSnapback = a.prop_type?.startsWith("pitcher_");
             if (isPitcherSnapback) {
               // Pitcher props follow market (rising K line = OVER)
               action = a.current_line > a.opening_line ? "OVER" : "UNDER";
               reason = a.current_line > a.opening_line
                 ? "K line rising — matchup/sharp money favors OVER"
                 : "K line dropping — matchup/sharp money favors UNDER";
             } else {
               action = a.current_line > a.opening_line ? "UNDER" : "OVER";
               reason = a.current_line > a.opening_line
                 ? "Inflated above open — snaps back down"
                 : "Deflated below open — snaps back up";
             }
           }
          const propLabel = isTeamMarket ? a.prop_type.toUpperCase() : esc(a.prop_type).replace("player ", "").toUpperCase();
          const displayName = (isTeamMarket && a.prop_type === "totals" && a.event_description)
            ? esc(a.event_description)
            : esc(a.player_name);
          const altLineMsg = isTeamMarket ? "" : getAltLineText(action, a.current_line, a.prop_type, a.player_name, a.event_id);
          const volWarning = getVolatilityWarning(a);
          const statsBadge = getStatsBadge(a);
          return [
            `🔄 *SNAPBACK*${liveTag} — ${esc(a.sport)}`,
            `${displayName} ${propLabel}`,
            `Open: ${a.opening_line} → Now: ${a.current_line} (${a.drift_pct}%)`,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            ...(statsBadge ? [statsBadge] : []),
            `✅ *Action: ${action}${isTeamMarket ? "" : ` ${a.current_line}`}*`,
            ...(volWarning ? [volWarning] : []),
            ...(altLineMsg ? [altLineMsg] : []),
            `💡 ${reason}`,
          ].join("\n");
        }
        // ====== CORRELATION / TEAM NEWS SHIFT ======
        if (a.type === "correlated_movement" || a.type === "team_news_shift") {
          const emoji = a.type === "team_news_shift" ? "📰" : "🔗";
          const label = a.type === "team_news_shift" ? "TEAM NEWS SHIFT" : "CORRELATED MOVEMENT";
          const propLabel = esc(a.prop_type).replace("player ", "").toUpperCase();
          const isLeagueWide = a.derived_from === "team_market_cross_game";
          const topPlayers = (a.players_moving || []).slice(0, 4).map((p: any) => {
            const playerVol = volatilityMap.get(p.name);
            const volTag = playerVol?.isVolatile ? ` ⚠️CV${Math.round(playerVol.cv * 100)}%` : "";
            if (isLeagueWide && p.current_line != null) {
              // League-wide: show game matchup with actual total line
              const openTag = p.opening_line != null ? ` (opened ${p.opening_line})` : "";
              return `  ${p.name}: ${p.direction} ${p.magnitude} — Total: ${p.current_line}${openTag}`;
            }
            const playerAltText = (() => {
              if (p.current_line == null) return "";
              const side = a.dominant_direction === "dropping" ? "UNDER" : "OVER";
              const cacheKey = `${a.event_id}|${p.name}|${a.prop_type || ""}`;
              const cached = altLineCache.get(cacheKey);
              if (!cached) return " → Alt: N/A";
              return ` → Alt ${side} ${cached.line} (${fmtAltOdds(cached.odds)}) [FD]`;
            })();
            return `  ${p.name}: ${p.direction} ${p.magnitude}${playerAltText}${volTag}`;
          }).join("\n");
           // Both team_news_shift and correlated_movement: follow the market movement
           let action: string;
           let reason: string;
          const playerCount = (a.players_moving || []).length;
          if (a.type === "team_news_shift") {
            const isTeamMarketDerived = a.prop_type === "totals" || a.prop_type === "moneyline";
            if (isTeamMarketDerived && a.prop_type === "totals") {
              const totalLine = a.game_total_line ? ` ${a.game_total_line}` : '';
              const oddsTag = a.dominant_direction === "dropping" && a.game_total_under_odds
                ? ` (${a.game_total_under_odds > 0 ? '+' : ''}${a.game_total_under_odds})`
                : a.game_total_over_odds
                ? ` (${a.game_total_over_odds > 0 ? '+' : ''}${a.game_total_over_odds})`
                : '';
              const batterTag = a.batter_validation ? `\n📊 Batters: ${a.batter_validation}` : '';
              const pitcherTag = a.pitcher_validation ? ` | Pitcher: ${a.pitcher_validation}` : '';
              action = a.dominant_direction === "dropping"
                ? `UNDER${totalLine}${oddsTag} — ${playerCount} player props dropping → game total likely lower${batterTag}${pitcherTag}`
                : `OVER${totalLine}${oddsTag} — ${playerCount} player props rising → game total likely higher${batterTag}${pitcherTag}`;
              reason = `Derived from player prop team news shift. ${playerCount} players moving ${a.dominant_direction} → Totals ${a.dominant_direction === "dropping" ? "UNDER" : "OVER"}${totalLine}.`;
            } else if (isTeamMarketDerived && a.prop_type === "moneyline") {
              const teamName = a.team_to_back || 'this side';
              const mlOddsTag = a.team_to_back_odds
                ? ` (${a.team_to_back_odds > 0 ? '+' : ''}${a.team_to_back_odds})`
                : '';
              action = a.dominant_direction === "dropping"
                ? `FADE — ${playerCount} player props dropping → fade ${teamName}`
                : `BACK ${teamName}${mlOddsTag} — ${playerCount} player props rising → back ${teamName}`;
              reason = `Derived from player prop team news shift. ${playerCount}+ players shifting = likely lineup/injury impact on ${teamName} ML.`;
            } else if (a.derived_from === "team_market_cross_game") {
              const gameCount = playerCount;
              action = a.dominant_direction === "dropping"
                ? `UNDER — ${gameCount} games' ${a.prop_type} dropping across ${esc(a.sport)}`
                : `OVER — ${gameCount} games' ${a.prop_type} rising across ${esc(a.sport)}`;
              reason = `Cross-game ${a.prop_type} correlation: ${gameCount} games shifting ${a.dominant_direction} = league-wide trend.`;
            } else {
              // Standard player prop team news shift
              action = a.dominant_direction === "dropping"
                ? `UNDER — ${playerCount} players dropping = real news, take UNDER`
                : `OVER — ${playerCount} players rising = real news, take OVER`;
              reason = `85%+ correlation across ${playerCount} players = likely injury/lineup news. Following the market shift.`;
            }
          } else {
            // Fade — contrarian logic for lower-correlation moves
            action = a.dominant_direction === "dropping"
              ? `OVER — lines dropping across ${playerCount} players (fade the trap)`
              : `UNDER — lines rising across ${playerCount} players (fade the trap)`;
            reason = `Coordinated movement below news threshold — fading as potential public trap.`;
          }
          const itemLabel = (a.prop_type === "totals" || a.prop_type === "moneyline" || a.derived_from === "team_market_cross_game") ? "games" : "players";
          const isTeamMarketCorr = ["h2h", "moneyline"].includes(a.prop_type);
          const altLineMsg = ""; // Per-player alt lines already shown inline for correlation alerts
          const volWarning = a.has_volatile_players ? `⚠️ *${a.volatile_player_count} VOLATILE PLAYER${a.volatile_player_count > 1 ? "S" : ""}* — extra buffer applied to flagged players` : "";
          return [
            `${emoji} *${label}* — ${esc(a.sport)}`,
            `${esc(a.event_description)} — ${propLabel}`,
            `${playerCount} ${itemLabel} moving ${a.dominant_direction} (${a.correlation_rate}% aligned)`,
            topPlayers,
            `📊 Conf: ${Math.round(a.confidence)}%`,
            `✅ *Action: ${action}*`,
            ...(volWarning ? [volWarning] : []),
            ...(altLineMsg ? [altLineMsg] : []),
            `💡 ${reason}`,
          ].join("\n");
        }
        return "";
      };

      // ====== OWNER RULES FILTER — block alerts that violate rules before Telegram ======
      let rulesBlocked = 0;
      const filteredAlerts = highConfAlerts.filter((a: any) => {
        const check = checkOwnerRules(a);
        if (check.blocked) {
          log(`🚫 RULE BLOCKED: [${check.rule}] ${check.reason} — ${a.player_name || a.event_description}`);
          rulesBlocked++;
          // Log to audit
          supabase.from("bot_audit_log").insert({
            rule_key: check.rule,
            violation_description: `${check.reason} — ${a.player_name || a.event_description || ""}`,
            action_taken: "blocked",
            affected_table: "behavior_alerts",
            metadata: { alert_type: a.type, prop_type: a.prop_type, player: a.player_name },
          }).then(() => {});
          return false;
        }
        if (check.rule) {
          log(`⚠️ RULE WARN: [${check.rule}] ${check.reason}`);
        }
        return true;
      });
      if (rulesBlocked > 0) log(`Owner rules blocked ${rulesBlocked} alert(s)`);

      const takeItNowAlerts = filteredAlerts.filter((a: any) => a.type === "take_it_now");
      const lineAboutToMoveAlerts = filteredAlerts.filter((a: any) => a.type === "line_about_to_move");
      const velocityAlerts = filteredAlerts.filter((a: any) => a.type === "velocity_spike");
      const cascadeAlerts = filteredAlerts.filter((a: any) => a.type === "cascade");
      const snapbackAlerts = filteredAlerts.filter((a: any) => a.type === "snapback");
      const correlationAlerts = filteredAlerts.filter((a: any) => a.type === "correlated_movement" || a.type === "team_news_shift");

      const allFormatted: string[] = [];
      // Highest priority first
      if (takeItNowAlerts.length > 0) {
        allFormatted.push(`\n— *🔥 TAKE IT NOW (${takeItNowAlerts.length})* —`);
        allFormatted.push(...takeItNowAlerts.map(formatAlert));
      }
      if (lineAboutToMoveAlerts.length > 0) {
        allFormatted.push(`\n— *🎯 LINE ABOUT TO MOVE (${lineAboutToMoveAlerts.length})* —`);
        allFormatted.push(...lineAboutToMoveAlerts.map(formatAlert));
      }
      if (velocityAlerts.length > 0) {
        allFormatted.push(`\n— *VELOCITY SPIKES (${velocityAlerts.length})* —`);
        allFormatted.push(...velocityAlerts.map(formatAlert));
      }
      if (cascadeAlerts.length > 0) {
        allFormatted.push(`\n— *CASCADE OPPORTUNITIES (${cascadeAlerts.length})* —`);
        allFormatted.push(...cascadeAlerts.map(formatAlert));
      }
      if (snapbackAlerts.length > 0) {
        allFormatted.push(`\n— *SNAPBACK CANDIDATES (${snapbackAlerts.length})* —`);
        allFormatted.push(...snapbackAlerts.map(formatAlert));
      }
      if (correlationAlerts.length > 0) {
        allFormatted.push(`\n— *🔗 CORRELATED SHIFTS (${correlationAlerts.length})* —`);
        allFormatted.push(...correlationAlerts.map(formatAlert));
      }

      const MAX_CHARS = 3800;
      const pages: string[][] = [];
      let currentPage: string[] = [];
      let currentLen = 0;

      for (const line of allFormatted) {
        const lineLen = line.length + 1;
        if (currentPage.length > 0 && !line.startsWith("\n—") && currentLen + lineLen > MAX_CHARS) {
          pages.push(currentPage);
          currentPage = [];
          currentLen = 0;
        }
        currentPage.push(line);
        currentLen += lineLen;
      }
      if (currentPage.length > 0) pages.push(currentPage);

      for (let i = 0; i < pages.length; i++) {
        const pageLabel = pages.length > 1 ? ` (${i + 1}/${pages.length})` : "";
        const header = i === 0
          ? [`🧠 *FanDuel Behavior*${pageLabel}`, `${highConfAlerts.length} signals — 🔥${takeItNowAlerts.length} 🎯${lineAboutToMoveAlerts.length} ⚡${velocityAlerts.length} 🌊${cascadeAlerts.length} 🔄${snapbackAlerts.length} 🔗${correlationAlerts.length}`, ""]
          : [`🧠 *Behavior${pageLabel}*`, ""];

        const msg = [...header, ...pages[i]].join("\n");

        try {
          await supabase.functions.invoke("bot-send-telegram", {
            body: { message: msg, parse_mode: "Markdown", admin_only: true },
          });
        } catch (tgErr: any) {
          log(`Telegram error page ${i + 1}: ${tgErr.message}`);
        }
      }
    }

    log(`=== ANALYSIS COMPLETE: ${patterns.length} patterns, ${alerts.length} alerts (deduped), ${highConfAlerts.length} high-conf ===`);

    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-behavior-analyzer",
      status: "completed",
      started_at: now.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: { patterns: patterns.length, alerts: alerts.length, highConf: highConfAlerts.length },
    });

    return new Response(
      JSON.stringify({ success: true, patterns: patterns.length, alerts: alerts.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

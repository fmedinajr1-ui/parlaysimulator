import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- Helpers ----------
function median(arr: number[]): number {
  if (!arr?.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdDev(arr: number[]): number {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

// Defense code (0–100) -> multiplier
// Higher code = harder defense = suppress stats
function defenseMultiplier(code: number | null | undefined): number {
  if (code === null || code === undefined) return 0;
  if (code >= 80) return -0.08;  // Hard defense
  if (code >= 60) return -0.04;
  if (code >= 40) return 0;       // Neutral
  if (code >= 20) return 0.04;
  return 0.08;                    // Soft defense, boost stats
}

// Prop type mapping
type StatKey = "points" | "rebounds" | "assists" | "pra" | "pr" | "pa" | "ra";

function normalizePropType(propType: string): StatKey | null {
  const t = (propType || "").toLowerCase();
  if (t.includes("player_points_rebounds_assists") || t.includes("pra")) return "pra";
  if (t.includes("player_points_rebounds") || t.includes("pr")) return "pr";
  if (t.includes("player_points_assists") || t.includes("pa")) return "pa";
  if (t.includes("player_rebounds_assists") || t.includes("ra")) return "ra";
  if (t.includes("player_points")) return "points";
  if (t.includes("player_rebounds")) return "rebounds";
  if (t.includes("player_assists")) return "assists";
  return null;
}

// Build series for a stat or combo
function seriesFromLogs(logs: any[], stat: StatKey): number[] {
  const safe = (n: any) => (typeof n === "number" ? n : 0);

  if (stat === "points") return logs.map(l => safe(l.points ?? l.pts));
  if (stat === "rebounds") return logs.map(l => safe(l.rebounds ?? l.reb));
  if (stat === "assists") return logs.map(l => safe(l.assists ?? l.ast));

  // combos: sum per-game series
  return logs.map(l => {
    const pts = safe(l.points ?? l.pts);
    const reb = safe(l.rebounds ?? l.reb);
    const ast = safe(l.assists ?? l.ast);
    if (stat === "pra") return pts + reb + ast;
    if (stat === "pr") return pts + reb;
    if (stat === "pa") return pts + ast;
    if (stat === "ra") return reb + ast;
    return 0;
  });
}

// Hit rate vs line
function hitRates(series: number[], line: number) {
  const over = series.filter(v => v > line).length / (series.length || 1);
  const under = series.filter(v => v < line).length / (series.length || 1);
  return { over, under };
}

// Volatility ratio (coefficient of variation)
function volatilityRatio(series: number[]) {
  const mu = series.reduce((a, b) => a + b, 0) / (series.length || 1);
  const sd = stdDev(series);
  return mu > 0 ? sd / mu : 1;
}

// Stat-specific thresholds (balanced accuracy mode)
const THRESH: Record<StatKey, { lean: number; strong: number; volCapStrong: number }> = {
  points:   { lean: 1.5, strong: 3.0, volCapStrong: 0.32 },
  rebounds: { lean: 1.3, strong: 2.5, volCapStrong: 0.34 },
  assists:  { lean: 1.2, strong: 2.2, volCapStrong: 0.30 },
  pra:      { lean: 2.0, strong: 4.0, volCapStrong: 0.28 },
  pr:       { lean: 1.8, strong: 3.5, volCapStrong: 0.30 },
  pa:       { lean: 1.6, strong: 3.0, volCapStrong: 0.30 },
  ra:       { lean: 1.4, strong: 2.6, volCapStrong: 0.32 },
};

type EngineResult = {
  player_name: string;
  stat_type: StatKey;
  line: number;
  games_analyzed: number;
  median10: number;
  median5: number;
  adjusted_median: number;
  edge: number;
  hit_rate_over_10: number;
  hit_rate_under_10: number;
  volatility: number;
  defense_code: number | null;
  defense_multiplier: number;
  recommendation: "STRONG OVER" | "LEAN OVER" | "STRONG UNDER" | "LEAN UNDER" | "NO BET";
  confidence_tier: "A" | "B" | "C" | "D";
  reason: string;
  event_id?: string;
  opponent_team?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "analyze_auto";

    // --------- AUTO MODE: pull NBA props and compute results ----------
    if (action === "analyze_auto") {
      const nowIso = new Date().toISOString();
      const today = nowIso.split('T')[0];

      // 1) Pull upcoming NBA props
      const { data: props, error: propsErr } = await supabase
        .from("unified_props")
        .select("*")
        .eq("sport", "basketball_nba")
        .gte("commence_time", nowIso)
        .eq("is_active", true);

      if (propsErr) throw propsErr;

      console.log(`[NBA-MEDIAN-V2] Found ${props?.length || 0} NBA props`);

      // 2) Pull defense codes
      const { data: defRows } = await supabase
        .from("nba_defense_codes")
        .select("*")
        .eq("season", "2024-25");

      const defMap = new Map<string, any>();
      (defRows || []).forEach((r: any) => {
        defMap.set((r.team_name || "").toLowerCase(), r);
        if (r.team_abbreviation) {
          defMap.set(r.team_abbreviation.toLowerCase(), r);
        }
      });

      console.log(`[NBA-MEDIAN-V2] Loaded ${defRows?.length || 0} defense codes`);

      // 3) Pull game logs (paginated for large tables)
      const { data: logs, error: logsErr } = await supabase
        .from("nba_player_game_logs")
        .select("player_name, game_date, opponent, is_home, minutes_played, points, rebounds, assists")
        .order("game_date", { ascending: false })
        .range(0, 15000);

      if (logsErr) throw logsErr;

      console.log(`[NBA-MEDIAN-V2] Loaded ${logs?.length || 0} game logs`);

      // Index logs by player_name
      const byPlayer = new Map<string, any[]>();
      for (const l of logs || []) {
        const key = (l.player_name || "").toLowerCase();
        if (!key) continue;
        if (!byPlayer.has(key)) byPlayer.set(key, []);
        byPlayer.get(key)!.push(l);
      }

      const results: EngineResult[] = [];

      for (const p of props || []) {
        const player = (p.player_name || "").trim();
        const statType = normalizePropType(p.prop_type);
        if (!player || !statType) continue;

        const line = Number(p.current_line ?? p.line ?? 0);
        if (!Number.isFinite(line) || line <= 0) continue;

        const playerLogs = (byPlayer.get(player.toLowerCase()) || [])
          .filter(l => (l.minutes_played ?? 0) > 0)
          .slice(0, 10);

        // Minimum 8 games required (v2 spec)
        if (playerLogs.length < 8) {
          results.push({
            player_name: player,
            stat_type: statType,
            line,
            games_analyzed: playerLogs.length,
            median10: 0,
            median5: 0,
            adjusted_median: 0,
            edge: 0,
            hit_rate_over_10: 0,
            hit_rate_under_10: 0,
            volatility: 1,
            defense_code: null,
            defense_multiplier: 0,
            recommendation: "NO BET",
            confidence_tier: "D",
            reason: `Insufficient sample (${playerLogs.length}/8 games)`,
            event_id: p.event_id,
            opponent_team: p.opponent_team
          });
          continue;
        }

        const series10 = seriesFromLogs(playerLogs, statType);
        const series5 = series10.slice(0, 5);

        const med10 = median(series10);
        const med5 = median(series5);

        const { over, under } = hitRates(series10, line);
        const vol = volatilityRatio(series10);

        // Defense code lookup (opponent team)
        const opp = (p.opponent_team || "").toLowerCase();
        const def = defMap.get(opp) || null;

        let defCode: number | null = null;
        if (def) {
          // Get stat-appropriate defense code
          if (statType === "points") defCode = def.vs_points_code ?? null;
          else if (statType === "rebounds") defCode = def.vs_rebounds_code ?? null;
          else if (statType === "assists") defCode = def.vs_assists_code ?? null;
          else if (statType === "pra") defCode = Math.round((def.vs_points_code + def.vs_rebounds_code + def.vs_assists_code) / 3) ?? null;
          else if (statType === "pr") defCode = Math.round((def.vs_points_code + def.vs_rebounds_code) / 2) ?? null;
          else if (statType === "pa") defCode = Math.round((def.vs_points_code + def.vs_assists_code) / 2) ?? null;
          else if (statType === "ra") defCode = Math.round((def.vs_rebounds_code + def.vs_assists_code) / 2) ?? null;
        }

        const defMult = defenseMultiplier(defCode);
        const adjustedMedian = med10 * (1 + defMult);

        let edge = adjustedMedian - line;

        // Recency influence (20% weight to recent form)
        edge += (med5 - med10) * 0.20;

        // Volatility dampening
        if (vol > 0.35) edge *= 0.88;

        // Decision logic (v2 gates: edge + hit rate must agree)
        const t = THRESH[statType];
        let rec: EngineResult["recommendation"] = "NO BET";
        const dir = edge >= 0 ? "OVER" : "UNDER";
        const absEdge = Math.abs(edge);
        const hitRateDir = dir === "OVER" ? over : under;

        // LEAN: |edge| >= threshold AND hit_rate >= 60%
        if (absEdge >= t.lean && hitRateDir >= 0.60) {
          rec = dir === "OVER" ? "LEAN OVER" : "LEAN UNDER";
        }
        
        // STRONG: |edge| >= threshold AND hit_rate >= 70% AND low volatility
        if (absEdge >= t.strong && hitRateDir >= 0.70 && vol <= t.volCapStrong) {
          rec = dir === "OVER" ? "STRONG OVER" : "STRONG UNDER";
        }

        // Confidence tier
        let tier: EngineResult["confidence_tier"] = "D";
        if (rec.includes("STRONG")) tier = "A";
        else if (rec.includes("LEAN")) tier = hitRateDir >= 0.67 ? "B" : "C";

        const reason = [
          `med10=${med10.toFixed(1)}`,
          `med5=${med5.toFixed(1)}`,
          `adj=${adjustedMedian.toFixed(1)}`,
          defCode !== null ? `def=${defCode}→${(defMult * 100).toFixed(0)}%` : 'def=NA',
          `edge=${edge >= 0 ? '+' : ''}${edge.toFixed(2)}`,
          `hit${dir.toLowerCase()}=${(hitRateDir * 100).toFixed(0)}%`,
          `vol=${vol.toFixed(2)}`
        ].join(' | ');

        results.push({
          player_name: player,
          stat_type: statType,
          line,
          games_analyzed: playerLogs.length,
          median10: Number(med10.toFixed(2)),
          median5: Number(med5.toFixed(2)),
          adjusted_median: Number(adjustedMedian.toFixed(2)),
          edge: Number(edge.toFixed(2)),
          hit_rate_over_10: Number(over.toFixed(3)),
          hit_rate_under_10: Number(under.toFixed(3)),
          volatility: Number(vol.toFixed(3)),
          defense_code: defCode,
          defense_multiplier: defMult,
          recommendation: rec,
          confidence_tier: tier,
          reason,
          event_id: p.event_id,
          opponent_team: p.opponent_team
        });
      }

      // Filter actionable picks
      const actionable = results.filter(r => r.recommendation !== "NO BET");

      console.log(`[NBA-MEDIAN-V2] Analyzed: ${results.length}, Actionable: ${actionable.length}`);

      // Save actionable picks to median_edge_picks
      if (actionable.length > 0) {
        const picksToSave = actionable.map(r => ({
          player_name: r.player_name,
          stat_type: r.stat_type,
          sportsbook_line: r.line,
          true_median: r.median10,
          edge: r.edge,
          recommendation: r.recommendation,
          confidence_flag: r.recommendation.includes('STRONG') ? 'HIGH' : 'MEDIUM',
          reason_summary: r.reason,
          game_date: today,
          // V2 fields
          adjusted_median: r.adjusted_median,
          defense_code: r.defense_code,
          defense_multiplier: r.defense_multiplier,
          hit_rate_over_10: r.hit_rate_over_10,
          hit_rate_under_10: r.hit_rate_under_10,
          median5: r.median5,
          volatility: r.volatility,
          confidence_tier: r.confidence_tier,
          engine_version: 'v2'
        }));

        // Clear today's old picks first
        await supabase
          .from('median_edge_picks')
          .delete()
          .eq('game_date', today);

        // Insert new picks
        const { error: insertError } = await supabase
          .from('median_edge_picks')
          .insert(picksToSave);

        if (insertError) {
          console.error('[NBA-MEDIAN-V2] Insert error:', insertError);
        } else {
          console.log(`[NBA-MEDIAN-V2] Saved ${picksToSave.length} picks`);
        }
      }

      const strongCount = actionable.filter(r => r.recommendation.includes('STRONG')).length;
      const leanCount = actionable.filter(r => r.recommendation.includes('LEAN')).length;

      return new Response(JSON.stringify({
        success: true,
        engine: "NBA_MEDIAN_MATCHUP_V2",
        analyzed: results.length,
        actionable_picks: actionable.length,
        strong_picks: strongCount,
        lean_picks: leanCount,
        tier_breakdown: {
          A: actionable.filter(r => r.confidence_tier === 'A').length,
          B: actionable.filter(r => r.confidence_tier === 'B').length,
          C: actionable.filter(r => r.confidence_tier === 'C').length,
        },
        picks: actionable,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    // GET_PICKS action - retrieve saved picks
    if (action === "get_picks") {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: picks, error } = await supabase
        .from('median_edge_picks')
        .select('*')
        .eq('game_date', today)
        .eq('engine_version', 'v2')
        .order('edge', { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify({
        success: true,
        picks: picks || []
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    // Default info
    return new Response(JSON.stringify({
      success: true,
      engine: "NBA_MEDIAN_MATCHUP_V2",
      version: "2.0.0",
      supports: ["points", "rebounds", "assists", "pra", "pr", "pa", "ra"],
      features: [
        "Defense code multipliers (0-100 → -8% to +8%)",
        "Hit rate validation (60%+ for LEAN, 70%+ for STRONG)",
        "Per-stat thresholds",
        "Volatility dampening",
        "Confidence tiers (A/B/C/D)"
      ],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});

  } catch (e) {
    console.error('[NBA-MEDIAN-V2] Error:', e);
    return new Response(JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : String(e)
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }
});

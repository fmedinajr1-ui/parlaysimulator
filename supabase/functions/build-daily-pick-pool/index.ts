import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeProp(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeSide(value: string | null | undefined): string | null {
  if (!value) return null;
  const side = value.trim().toLowerCase();
  if (side === "over" || side === "under") return side;
  return null;
}

function safeNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function inferCategoryFromProp(propType: string | null | undefined): string {
  const prop = normalizeProp(propType);
  if (prop.includes("assist")) return "ASSISTS";
  if (prop.includes("rebound")) return "BIG_REBOUNDER";
  if (prop.includes("three") || prop.includes("3pt") || prop.includes("threes")) return "THREE_POINT_SHOOTER";
  if (prop.includes("steal")) return "STEALS";
  if (prop.includes("block")) return "BLOCKS";
  if (prop.includes("points_q1") || prop.includes("point_q1")) return "STAR_FLOOR_OVER";
  if (prop.includes("points")) return "VOLUME_SCORER";
  if (prop.includes("pra") || prop.includes("points_rebounds_assists")) return "PRA";
  if (prop.includes("rebounds_assists")) return "R+A";
  return "UNKNOWN";
}

function computeCompositeScore(input: {
  confidenceTenScale?: number | null;
  l10HitRate?: number | null;
  edge?: number | null;
  weightMultiplier?: number | null;
  sourceBoost?: number;
}): number {
  const confidencePct = clamp(0, 100, (input.confidenceTenScale ?? 0) * 10);
  const hitRatePct = clamp(0, 100, (input.l10HitRate ?? 0) * 100);
  const edgeScore = clamp(0, 100, ((input.edge ?? 0) + 8) / 16 * 100);
  const weighted = confidencePct * 0.55 + hitRatePct * 0.25 + edgeScore * 0.20 + (input.sourceBoost ?? 0);
  const multiplier = input.weightMultiplier ?? 1;
  return clamp(1, 99, Math.round(weighted * multiplier));
}

interface WeightRow {
  category: string;
  side: string;
  weight: number | null;
  is_blocked?: boolean | null;
}

interface RiskPickRow {
  player_name: string | null;
  prop_type: string | null;
  side: string | null;
  line: number | null;
  confidence_score: number | null;
  edge: number | null;
  true_median: number | null;
  l10_avg: number | null;
  l10_hit_rate: number | null;
  game_date: string;
  mode: string | null;
  rejection_reason?: string | null;
  created_at?: string | null;
}

interface SweetSpotRow {
  player_name: string | null;
  prop_type: string | null;
  recommended_side: string | null;
  recommended_line: number | null;
  confidence_score: number | null;
  projected_value: number | null;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  l3_avg?: number | null;
  category: string | null;
  analysis_date: string;
  is_active?: boolean | null;
  actual_line?: number | null;
  created_at?: string | null;
}

interface PoolRowInsert {
  pick_date: string;
  player_name: string;
  prop_type: string;
  recommended_side: string;
  recommended_line: number;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  l3_avg: number | null;
  confidence_score: number;
  composite_score: number;
  projected_value: number | null;
  rejection_reason: string | null;
  was_used_in_parlay: boolean;
  category: string;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const targetDate = typeof body.date === "string" && body.date ? body.date : getEasternDate();
    const minimumRiskRows = safeNumber(body.minimum_risk_rows) ?? 8;
    const minimumPoolRows = safeNumber(body.minimum_pool_rows) ?? 12;
    const fallbackLimit = safeNumber(body.fallback_limit) ?? 40;
    const deleteExisting = body.delete_existing !== false;

    const diagnostics: Record<string, number | string | boolean> = {
      target_date: targetDate,
      minimum_risk_rows: minimumRiskRows,
      minimum_pool_rows: minimumPoolRows,
      fallback_limit: fallbackLimit,
      delete_existing: deleteExisting,
    };

    const [riskRes, sweetRes, weightsRes] = await Promise.all([
      supabase
        .from("nba_risk_engine_picks")
        .select("player_name, prop_type, side, line, confidence_score, edge, true_median, l10_avg, l10_hit_rate, game_date, mode, rejection_reason, created_at")
        .eq("game_date", targetDate)
        .eq("mode", "full_slate")
        .is("rejection_reason", null)
        .order("confidence_score", { ascending: false }),
      supabase
        .from("category_sweet_spots")
        .select("player_name, prop_type, recommended_side, recommended_line, confidence_score, projected_value, l10_hit_rate, l10_avg, l3_avg, category, analysis_date, is_active, actual_line, created_at")
        .eq("analysis_date", targetDate)
        .eq("is_active", true)
        .order("confidence_score", { ascending: false })
        .limit(fallbackLimit),
      supabase
        .from("bot_category_weights")
        .select("category, side, weight, is_blocked"),
    ]);

    if (riskRes.error) throw riskRes.error;
    if (sweetRes.error) throw sweetRes.error;
    if (weightsRes.error) throw weightsRes.error;

    const weightMap = new Map<string, WeightRow>();
    for (const row of (weightsRes.data || []) as WeightRow[]) {
      weightMap.set(`${(row.category || "").toUpperCase()}__${(row.side || "").toLowerCase()}`, row);
    }

    const poolRows: PoolRowInsert[] = [];
    const seen = new Set<string>();
    let riskAccepted = 0;
    let riskSkippedInvalid = 0;
    let riskSkippedDuplicate = 0;
    let fallbackAccepted = 0;
    let fallbackSkippedInvalid = 0;
    let fallbackSkippedDuplicate = 0;

    const buildDedupeKey = (playerName: string, propType: string, side: string, line: number) =>
      `${normalizeName(playerName)}|${normalizeProp(propType)}|${side}|${line}`;

    const addPoolRow = (row: PoolRowInsert, source: "risk" | "fallback") => {
      const key = buildDedupeKey(row.player_name, row.prop_type, row.recommended_side, row.recommended_line);
      if (seen.has(key)) {
        if (source === "risk") riskSkippedDuplicate += 1;
        else fallbackSkippedDuplicate += 1;
        return;
      }
      seen.add(key);
      poolRows.push(row);
      if (source === "risk") riskAccepted += 1;
      else fallbackAccepted += 1;
    };

    for (const pick of (riskRes.data || []) as RiskPickRow[]) {
      const playerName = pick.player_name?.trim();
      const propType = pick.prop_type?.trim();
      const side = normalizeSide(pick.side);
      const line = safeNumber(pick.line);
      if (!playerName || !propType || !side || line == null) {
        riskSkippedInvalid += 1;
        continue;
      }

      const category = inferCategoryFromProp(propType);
      const weightRow = weightMap.get(`${category}__${side}`);
      const weightMultiplier = weightRow?.is_blocked ? 0 : weightRow?.weight ?? 1;
      const projectedValue = safeNumber(pick.true_median) ?? safeNumber(pick.l10_avg) ?? line;
      const compositeScore = computeCompositeScore({
        confidenceTenScale: safeNumber(pick.confidence_score),
        l10HitRate: safeNumber(pick.l10_hit_rate),
        edge: safeNumber(pick.edge),
        weightMultiplier,
        sourceBoost: 4,
      });

      addPoolRow({
        pick_date: targetDate,
        player_name: playerName,
        prop_type: propType,
        recommended_side: side,
        recommended_line: line,
        l10_hit_rate: safeNumber(pick.l10_hit_rate),
        l10_avg: safeNumber(pick.l10_avg),
        l3_avg: null,
        confidence_score: compositeScore,
        composite_score: compositeScore,
        projected_value: projectedValue,
        rejection_reason: null,
        was_used_in_parlay: false,
        category,
        created_at: pick.created_at || new Date().toISOString(),
      }, "risk");
    }

    const needsFallback = riskAccepted < minimumRiskRows;
    diagnostics.risk_pick_rows = (riskRes.data || []).length;
    diagnostics.risk_rows_accepted = riskAccepted;
    diagnostics.risk_rows_skipped_invalid = riskSkippedInvalid;
    diagnostics.risk_rows_skipped_duplicate = riskSkippedDuplicate;
    diagnostics.used_fallback = needsFallback;

    if (needsFallback) {
      for (const pick of (sweetRes.data || []) as SweetSpotRow[]) {
        const playerName = pick.player_name?.trim();
        const propType = pick.prop_type?.trim();
        const side = normalizeSide(pick.recommended_side);
        const line = safeNumber(pick.actual_line) ?? safeNumber(pick.recommended_line);
        if (!playerName || !propType || !side || line == null) {
          fallbackSkippedInvalid += 1;
          continue;
        }

        const category = (pick.category || inferCategoryFromProp(propType)).toString().trim().toUpperCase() || "UNKNOWN";
        const weightRow = weightMap.get(`${category}__${side}`);
        const weightMultiplier = weightRow?.is_blocked ? 0 : weightRow?.weight ?? 1;
        const confidenceTenScale = ((safeNumber(pick.confidence_score) ?? 0.7) <= 1)
          ? (safeNumber(pick.confidence_score) ?? 0.7) * 10
          : safeNumber(pick.confidence_score);
        const compositeScore = computeCompositeScore({
          confidenceTenScale,
          l10HitRate: safeNumber(pick.l10_hit_rate),
          edge: (safeNumber(pick.projected_value) ?? safeNumber(pick.l10_avg) ?? line) - line,
          weightMultiplier,
          sourceBoost: 0,
        });

        addPoolRow({
          pick_date: targetDate,
          player_name: playerName,
          prop_type: propType,
          recommended_side: side,
          recommended_line: line,
          l10_hit_rate: safeNumber(pick.l10_hit_rate),
          l10_avg: safeNumber(pick.l10_avg),
          l3_avg: safeNumber(pick.l3_avg),
          confidence_score: compositeScore,
          composite_score: compositeScore,
          projected_value: safeNumber(pick.projected_value) ?? safeNumber(pick.l10_avg) ?? line,
          rejection_reason: null,
          was_used_in_parlay: false,
          category,
          created_at: pick.created_at || new Date().toISOString(),
        }, "fallback");
      }
    }

    diagnostics.fallback_rows_scanned = needsFallback ? (sweetRes.data || []).length : 0;
    diagnostics.fallback_rows_accepted = fallbackAccepted;
    diagnostics.fallback_rows_skipped_invalid = fallbackSkippedInvalid;
    diagnostics.fallback_rows_skipped_duplicate = fallbackSkippedDuplicate;
    diagnostics.pool_rows_built = poolRows.length;
    diagnostics.pool_status = poolRows.length >= minimumPoolRows ? "ready" : poolRows.length > 0 ? "thin" : "empty";

    if (deleteExisting) {
      const { error: deleteError } = await supabase
        .from("bot_daily_pick_pool")
        .delete()
        .eq("pick_date", targetDate);
      if (deleteError) throw deleteError;
    }

    let inserted = 0;
    if (poolRows.length > 0) {
      const { error: insertError, count } = await supabase
        .from("bot_daily_pick_pool")
        .insert(poolRows, { count: "exact" });
      if (insertError) throw insertError;
      inserted = count ?? poolRows.length;
    }
    diagnostics.pool_rows_inserted = inserted;

    return new Response(JSON.stringify({
      success: poolRows.length >= minimumPoolRows,
      degraded: poolRows.length > 0 && poolRows.length < minimumPoolRows,
      target_date: targetDate,
      diagnostics,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: poolRows.length === 0 ? 409 : 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[build-daily-pick-pool] Error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

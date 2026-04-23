import { etDateKey } from "./date-et.ts";

export interface DirectPickRow {
  id: string;
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
  source_origin: "risk" | "fallback" | "raw_props";
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
  actual_line?: number | null;
  created_at?: string | null;
}

export interface DirectPickSourceOptions {
  targetDate?: string;
  minimumRiskRows?: number;
  fallbackLimit?: number;
  rawPropsLimit?: number;
  allowRawPropsFallback?: boolean;
}

export interface DirectPickSourceResult {
  rows: DirectPickRow[];
  diagnostics: Record<string, unknown>;
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

function buildDedupeKey(playerName: string, propType: string, side: string, line: number) {
  return `${normalizeName(playerName)}|${normalizeProp(propType)}|${side}|${line}`;
}

export async function loadDirectPickRows(
  sb: any,
  options: DirectPickSourceOptions = {},
): Promise<DirectPickSourceResult> {
  const targetDate = options.targetDate ?? etDateKey();
  const minimumRiskRows = options.minimumRiskRows ?? 8;
  const fallbackLimit = options.fallbackLimit ?? 40;
  const rawPropsLimit = options.rawPropsLimit ?? 60;
  const allowRawPropsFallback = options.allowRawPropsFallback ?? true;

  const diagnostics: Record<string, unknown> = {
    target_date: targetDate,
    minimum_risk_rows: minimumRiskRows,
    fallback_limit: fallbackLimit,
    raw_props_limit: rawPropsLimit,
    allow_raw_props_fallback: allowRawPropsFallback,
    risk_layer_bypassed: true,
  };

  const [riskRes, sweetRes, weightsRes] = await Promise.all([
    sb
      .from("nba_risk_engine_picks")
      .select("player_name, prop_type, side, line, confidence_score, edge, true_median, l10_avg, l10_hit_rate, created_at")
      .eq("game_date", targetDate)
      .eq("mode", "full_slate")
      .is("rejection_reason", null)
      .order("confidence_score", { ascending: false }),
    sb
      .from("category_sweet_spots")
      .select("player_name, prop_type, recommended_side, recommended_line, confidence_score, projected_value, l10_hit_rate, l10_avg, l3_avg, category, actual_line, created_at")
      .eq("analysis_date", targetDate)
      .eq("is_active", true)
      .order("confidence_score", { ascending: false })
      .limit(fallbackLimit),
    sb
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

  const rows: DirectPickRow[] = [];
  const seen = new Set<string>();
  let riskAccepted = 0;
  let riskSkippedInvalid = 0;
  let riskSkippedDuplicate = 0;
  let fallbackAccepted = 0;
  let fallbackSkippedInvalid = 0;
  let fallbackSkippedDuplicate = 0;

  const addRow = (row: DirectPickRow) => {
    const dedupeKey = buildDedupeKey(row.player_name, row.prop_type, row.recommended_side, row.recommended_line);
    if (seen.has(dedupeKey)) {
      if (row.source_origin === "risk") riskSkippedDuplicate += 1;
      else fallbackSkippedDuplicate += 1;
      return;
    }
    seen.add(dedupeKey);
    rows.push(row);
    if (row.source_origin === "risk") riskAccepted += 1;
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

    addRow({
      id: `risk:${buildDedupeKey(playerName, propType, side, line)}`,
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
      source_origin: "risk",
    });
  }

  const needsFallback = riskAccepted < minimumRiskRows;
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
      const confidenceRaw = safeNumber(pick.confidence_score) ?? 0.7;
      const confidenceTenScale = confidenceRaw <= 1 ? confidenceRaw * 10 : confidenceRaw;
      const compositeScore = computeCompositeScore({
        confidenceTenScale,
        l10HitRate: safeNumber(pick.l10_hit_rate),
        edge: (safeNumber(pick.projected_value) ?? safeNumber(pick.l10_avg) ?? line) - line,
        weightMultiplier,
        sourceBoost: 0,
      });

      addRow({
        id: `fallback:${buildDedupeKey(playerName, propType, side, line)}`,
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
        source_origin: "fallback",
      });
    }
  }

  // RISK LAYER BYPASS — if both risk and fallback came up empty (or thin),
  // pull straight from unified_props for today so the slate never starves.
  let rawPropsScanned = 0;
  let rawPropsAccepted = 0;
  let rawPropsSkipped = 0;
  const needsRawProps = allowRawPropsFallback && rows.length < minimumRiskRows;
  if (needsRawProps) {
    const freshWindow = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const rawRes = await sb
      .from("unified_props")
      .select("player_name, prop_type, current_line, recommended_side, recommendation, confidence, composite_score, category, over_price, under_price, odds_updated_at, updated_at, created_at, sport, is_active")
      .eq("sport", "basketball_nba")
      .eq("is_active", true)
      .or(`odds_updated_at.gte.${freshWindow},updated_at.gte.${freshWindow},created_at.gte.${freshWindow}`)
      .order("composite_score", { ascending: false, nullsFirst: false })
      .limit(rawPropsLimit * 3);

    if (!rawRes.error) {
      for (const prop of (rawRes.data || []) as any[]) {
        rawPropsScanned += 1;
        const playerName = (prop.player_name || "").trim();
        const propType = (prop.prop_type || "").trim();
        const line = safeNumber(prop.current_line);
        // Pick a side: prefer explicit recommended_side, else infer from prices
        let side = normalizeSide(prop.recommended_side) || normalizeSide(prop.recommendation);
        if (!side) {
          const over = safeNumber(prop.over_price);
          const under = safeNumber(prop.under_price);
          if (over != null && under != null) side = over <= under ? "over" : "under";
          else if (over != null) side = "over";
          else if (under != null) side = "under";
        }
        if (!playerName || !propType || !side || line == null) {
          rawPropsSkipped += 1;
          continue;
        }
        const dedupeKey = buildDedupeKey(playerName, propType, side, line);
        if (seen.has(dedupeKey)) { rawPropsSkipped += 1; continue; }

        const category = (prop.category || inferCategoryFromProp(propType) || "UNKNOWN").toString().toUpperCase();
        const weightRow = weightMap.get(`${category}__${side}`);
        const weightMultiplier = weightRow?.is_blocked ? 0 : weightRow?.weight ?? 1;
        const confidenceRaw = safeNumber(prop.confidence) ?? 0.55;
        const confidenceTenScale = confidenceRaw <= 1 ? confidenceRaw * 10 : confidenceRaw;
        const composite = computeCompositeScore({
          confidenceTenScale,
          l10HitRate: null,
          edge: 0,
          weightMultiplier,
          sourceBoost: -6, // de-prioritise raw_props vs risk/sweet
        });

        seen.add(dedupeKey);
        rows.push({
          id: `raw:${dedupeKey}`,
          pick_date: targetDate,
          player_name: playerName,
          prop_type: propType,
          recommended_side: side,
          recommended_line: line,
          l10_hit_rate: null,
          l10_avg: null,
          l3_avg: null,
          confidence_score: composite,
          composite_score: composite,
          projected_value: line,
          rejection_reason: null,
          was_used_in_parlay: false,
          category,
          created_at: prop.odds_updated_at || prop.updated_at || prop.created_at || new Date().toISOString(),
          source_origin: "raw_props",
        });
        rawPropsAccepted += 1;
        if (rawPropsAccepted >= rawPropsLimit) break;
      }
    } else {
      diagnostics.raw_props_error = rawRes.error.message || String(rawRes.error);
    }
  }

  rows.sort((a, b) => (b.composite_score - a.composite_score) || (b.l10_hit_rate ?? 0) - (a.l10_hit_rate ?? 0));

  Object.assign(diagnostics, {
    risk_pick_rows: (riskRes.data || []).length,
    risk_rows_accepted: riskAccepted,
    risk_rows_skipped_invalid: riskSkippedInvalid,
    risk_rows_skipped_duplicate: riskSkippedDuplicate,
    used_fallback: needsFallback,
    fallback_rows_scanned: needsFallback ? (sweetRes.data || []).length : 0,
    fallback_rows_accepted: fallbackAccepted,
    fallback_rows_skipped_invalid: fallbackSkippedInvalid,
    fallback_rows_skipped_duplicate: fallbackSkippedDuplicate,
    direct_rows_built: rows.length,
    direct_rows_from_risk: rows.filter((row) => row.source_origin === "risk").length,
    direct_rows_from_fallback: rows.filter((row) => row.source_origin === "fallback").length,
    used_raw_props: needsRawProps,
    raw_props_scanned: rawPropsScanned,
    raw_props_accepted: rawPropsAccepted,
    raw_props_skipped: rawPropsSkipped,
    direct_rows_from_raw_props: rows.filter((row) => row.source_origin === "raw_props").length,
    risk_layer_status: riskAccepted === 0 ? "empty" : riskAccepted < minimumRiskRows ? "thin" : "active",
    source_status: rows.length === 0 ? "empty" : rows.length < minimumRiskRows ? "thin" : "ready",
  });

  return { rows, diagnostics };
}
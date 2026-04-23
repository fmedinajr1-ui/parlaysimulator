import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { etDateKey } from "../_shared/date-et.ts";
import { BOOKMAKER_PRIORITY, MAX_BOOK_LINE_AGE_MIN, MAX_LINE_DRIFT } from "../_shared/parlay-engine-v2/config.ts";
import { loadDirectPickRows } from "../_shared/direct-pick-sources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PoolRow {
  id: string;
  pick_date: string;
  player_name: string;
  prop_type: string | null;
  recommended_side: string | null;
  recommended_line: number | null;
  confidence_score: number | null;
  composite_score: number | null;
  projected_value: number | null;
  category: string | null;
  l10_hit_rate?: number | null;
  l10_avg?: number | null;
  l3_avg?: number | null;
  created_at: string;
}

interface PropRow {
  player_name: string | null;
  prop_type: string | null;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean | null;
  bookmaker?: string | null;
  odds_updated_at?: string | null;
  updated_at?: string | null;
}

interface StraightBetRow {
  bet_date: string;
  player_name: string;
  prop_type: string;
  side: string;
  line: number;
  standard_line: number | null;
  ceiling_line: number | null;
  ceiling_reason: string | null;
  american_odds: number | null;
  simulated_stake: number;
  simulated_payout: number | null;
  composite_score: number;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  source: string;
  line_source: string | null;
  bet_type: string;
  outcome: string;
  h2h_boost: number | null;
  buffer_pct: number | null;
  created_at: string;
}

const MAX_STANDARD_STRAIGHTS = 8;
const MAX_CEILING_STRAIGHTS = 4;
const MIN_STANDARD_COMPOSITE_SCORE = 70;
const MIN_STANDARD_HIT_RATE = 0.58;
const MIN_CEILING_COMPOSITE_SCORE = 74;
const MIN_CEILING_HIT_RATE = 0.52;
const MIN_CEILING_BUFFER = 0.25;
const STANDARD_STAKE_MULTIPLIER = 0.6;
const CEILING_STAKE_MULTIPLIER = 0.4;

function safeNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(value: string | null | undefined): string | null {
  if (!value) return null;
  const side = value.trim().toLowerCase();
  if (side === "over" || side === "under") return side;
  return null;
}

function normalizeKey(playerName: string, propType: string): string {
  return `${playerName.trim().toLowerCase()}|${propType.trim().toLowerCase()}`;
}

function pickPreferredBook(rows: PropRow[]): PropRow | null {
  if (!rows.length) return null;
  for (const book of BOOKMAKER_PRIORITY) {
    const match = rows.find((row) => (row.bookmaker ?? "").toLowerCase() === book);
    if (match) return match;
  }
  return rows.find((row) => row.is_active) ?? rows[0];
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function americanToDecimal(american: number | null): number | null {
  if (american == null || american === 0) return null;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function computeStakeUnits(compositeScore: number, hitRate: number | null, multiplier: number): number {
  const confidence = clamp(0, 1, compositeScore / 100);
  const hitBonus = clamp(0, 1, hitRate ?? 0.5);
  const raw = (0.8 + confidence * 1.6 + hitBonus * 0.6) * multiplier;
  return Math.round(raw * 100) / 100;
}

function computePayout(stake: number, americanOdds: number | null): number | null {
  const decimal = americanToDecimal(americanOdds);
  if (decimal == null) return null;
  return Math.round(stake * (decimal - 1) * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const targetDate = typeof body.date === "string" && body.date ? body.date : etDateKey();
    const dryRun = body.dry_run === true;
    const deleteExisting = body.delete_existing !== false;

    const directSourceState = await loadDirectPickRows(sb, { targetDate, minimumRiskRows: 8, fallbackLimit: 40 });
    const poolState = {
      pool: directSourceState.rows as PoolRow[],
      poolBeforeCount: directSourceState.rows.length,
      poolAfterCount: directSourceState.rows.length,
      poolAutoBuildAttempted: false,
      poolAutoBuildSuccess: directSourceState.rows.length > 0,
      poolBuildDiagnostics: directSourceState.diagnostics,
    };
    const diagnostics: Record<string, unknown> = {
      target_date: targetDate,
      direct_rows_loaded: poolState.poolAfterCount,
      source_diagnostics: poolState.poolBuildDiagnostics,
    };

    const zeroPool = poolState.poolAfterCount === 0;
    if (zeroPool) {
      return new Response(JSON.stringify({
        success: false,
        degraded: true,
        degraded_reason: "empty_direct_sources",
        diagnostics,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const playerNames = Array.from(new Set(poolState.pool.map((row) => row.player_name).filter(Boolean)));
    const { data: propData, error: propErr } = await sb
      .from("unified_props")
      .select("player_name, prop_type, current_line, over_price, under_price, is_active, bookmaker, odds_updated_at, updated_at")
      .in("player_name", playerNames)
      .eq("is_active", true);
    if (propErr) throw propErr;

    const propsByKey = new Map<string, PropRow[]>();
    for (const prop of (propData ?? []) as PropRow[]) {
      if (!prop.player_name || !prop.prop_type) continue;
      const key = normalizeKey(prop.player_name, prop.prop_type);
      const rows = propsByKey.get(key) ?? [];
      rows.push(prop);
      propsByKey.set(key, rows);
    }

    let bookMatchedRows = 0;
    let staleRejected = 0;
    let driftRejected = 0;
    let missingPriceRejected = 0;
    let inactiveRejected = 0;

    const now = new Date();
    const standardCandidates: StraightBetRow[] = [];
    const ceilingCandidates: StraightBetRow[] = [];
    const insertedKeys = new Set<string>();

    for (const row of poolState.pool) {
      if (!row.prop_type || !row.recommended_side || row.recommended_line == null) continue;
      const side = normalizeSide(row.recommended_side);
      if (!side) continue;

      const key = normalizeKey(row.player_name, row.prop_type);
      const matched = pickPreferredBook(propsByKey.get(key) ?? []);
      if (!matched) continue;
      if (matched.is_active === false) {
        inactiveRejected += 1;
        continue;
      }

      const ts = matched.odds_updated_at ?? matched.updated_at;
      if (!ts) {
        staleRejected += 1;
        continue;
      }
      const ageMin = (now.getTime() - new Date(ts).getTime()) / 60_000;
      if (ageMin > MAX_BOOK_LINE_AGE_MIN) {
        staleRejected += 1;
        continue;
      }

      if (matched.current_line == null || Math.abs(Number(matched.current_line) - Number(row.recommended_line)) > MAX_LINE_DRIFT) {
        driftRejected += 1;
        continue;
      }

      const americanOdds = side === "over" ? safeNumber(matched.over_price) : safeNumber(matched.under_price);
      if (americanOdds == null) {
        missingPriceRejected += 1;
        continue;
      }

      bookMatchedRows += 1;
      const compositeScore = Math.round(safeNumber(row.composite_score) ?? safeNumber(row.confidence_score) ?? 65);
      const l10HitRate = safeNumber(row.l10_hit_rate);
      const l10Avg = safeNumber(row.l10_avg);
      const l3Avg = safeNumber(row.l3_avg);
      const projectedValue = safeNumber(row.projected_value);
      const bookLine = safeNumber(matched.current_line) ?? safeNumber(row.recommended_line)!;
      const lineGap = Math.abs(bookLine - Number(row.recommended_line));
      const bufferPct = bookLine === 0 ? 0 : Math.abs(((projectedValue ?? l10Avg ?? bookLine) - bookLine) / bookLine);
      const baseKey = `${row.player_name}|${row.prop_type}|${side}`.toLowerCase();

      if (!insertedKeys.has(`standard|${baseKey}`)
        && compositeScore >= MIN_STANDARD_COMPOSITE_SCORE
        && (l10HitRate == null || l10HitRate >= MIN_STANDARD_HIT_RATE)) {
        insertedKeys.add(`standard|${baseKey}`);
        const stake = computeStakeUnits(compositeScore, l10HitRate, STANDARD_STAKE_MULTIPLIER);
        standardCandidates.push({
          bet_date: targetDate,
          player_name: row.player_name,
          prop_type: row.prop_type,
          side,
          line: bookLine,
          standard_line: bookLine,
          ceiling_line: null,
          ceiling_reason: null,
          american_odds: americanOdds,
          simulated_stake: stake,
          simulated_payout: computePayout(stake, americanOdds),
          composite_score: compositeScore,
          l10_hit_rate: l10HitRate,
          l10_avg: l10Avg,
          source: row.category ?? "pick_pool",
          line_source: matched.bookmaker ?? null,
          bet_type: "standard_straight",
          outcome: "pending",
          h2h_boost: null,
          buffer_pct: Math.round(bufferPct * 1000) / 1000,
          created_at: new Date().toISOString(),
        });
      }

      const sideIsOver = side === "over";
      const l10MaxProxy = Math.max(projectedValue ?? 0, l10Avg ?? 0, l3Avg ?? 0, bookLine);
      const overBuffer = sideIsOver && l3Avg != null && l10MaxProxy >= bookLine * (1 + MIN_CEILING_BUFFER);
      if (!insertedKeys.has(`ceiling|${baseKey}`)
        && overBuffer
        && compositeScore >= MIN_CEILING_COMPOSITE_SCORE
        && (l10HitRate == null || l10HitRate >= MIN_CEILING_HIT_RATE)) {
        const ceilingLine = roundToHalf(Math.min((l3Avg ?? bookLine) * 0.95, l10MaxProxy * 0.8));
        if (ceilingLine > bookLine) {
          insertedKeys.add(`ceiling|${baseKey}`);
          const stake = computeStakeUnits(compositeScore, l10HitRate, CEILING_STAKE_MULTIPLIER);
          ceilingCandidates.push({
            bet_date: targetDate,
            player_name: row.player_name,
            prop_type: row.prop_type,
            side,
            line: ceilingLine,
            standard_line: bookLine,
            ceiling_line: ceilingLine,
            ceiling_reason: `L3 ${l3Avg?.toFixed(1) ?? "n/a"} and projection buffer ${Math.round(bufferPct * 100)}% support a higher ceiling than book line ${bookLine}`,
            american_odds: americanOdds,
            simulated_stake: stake,
            simulated_payout: computePayout(stake, americanOdds),
            composite_score: compositeScore,
            l10_hit_rate: l10HitRate,
            l10_avg: l10Avg,
            source: row.category ?? "pick_pool",
            line_source: matched.bookmaker ?? null,
            bet_type: "ceiling_straight",
            outcome: "pending",
            h2h_boost: null,
            buffer_pct: Math.round(bufferPct * 1000) / 1000,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    standardCandidates.sort((a, b) => (b.composite_score - a.composite_score) || ((b.l10_hit_rate ?? 0) - (a.l10_hit_rate ?? 0)));
    ceilingCandidates.sort((a, b) => (b.composite_score - a.composite_score) || ((b.buffer_pct ?? 0) - (a.buffer_pct ?? 0)));

    const rows = [
      ...standardCandidates.slice(0, MAX_STANDARD_STRAIGHTS),
      ...ceilingCandidates.slice(0, MAX_CEILING_STRAIGHTS),
    ];

    Object.assign(diagnostics, {
      direct_rows_loaded: poolState.poolAfterCount,
      book_matched_rows: bookMatchedRows,
      stale_rejected: staleRejected,
      drift_rejected: driftRejected,
      missing_price_rejected: missingPriceRejected,
      inactive_rejected: inactiveRejected,
      standard_candidates: standardCandidates.length,
      ceiling_candidates: ceilingCandidates.length,
      standard_inserted: standardCandidates.slice(0, MAX_STANDARD_STRAIGHTS).length,
      ceiling_inserted: ceilingCandidates.slice(0, MAX_CEILING_STRAIGHTS).length,
    });

    if (dryRun) {
      const degradedReason = rows.length === 0
        ? (bookMatchedRows === 0 ? "no_book_matched_candidates" : "no_valid_straight_bets_built")
        : null;
      return new Response(JSON.stringify({
        success: !degradedReason,
        degraded: !!degradedReason,
        degraded_reason: degradedReason,
        diagnostics,
        preview: rows,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (deleteExisting) {
      const { error: deleteError } = await sb
        .from("bot_straight_bets")
        .delete()
        .eq("bet_date", targetDate)
        .eq("outcome", "pending")
        .in("bet_type", ["standard_straight", "ceiling_straight"]);
      if (deleteError) throw deleteError;
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { error: insertError, count } = await sb
        .from("bot_straight_bets")
        .insert(rows, { count: "exact" });
      if (insertError) throw insertError;
      inserted = count ?? rows.length;
    }

    const degradedReason = inserted === 0
      ? (bookMatchedRows === 0 ? "no_book_matched_candidates" : "no_valid_straight_bets_built")
      : null;

    return new Response(JSON.stringify({
      success: !degradedReason,
      degraded: !!degradedReason,
      degraded_reason: degradedReason,
      inserted,
      diagnostics,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bot-generate-straight-bets] Error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
// ============================================================================
// parlay-engine-v2-backtest — Phase B edge function
//
// Replays historical parlays through v2 rules. Optionally writes summary to
// backtest_runs + per-parlay rows to backtest_parlay_results.
//
// POST body: {
//   date_start: "YYYY-MM-DD",
//   date_end:   "YYYY-MM-DD",
//   mode?:      "backtest" | "calibrate" | "both",
//   run_name?:  string,
//   dry_run?:   boolean,                            // default true
//   options?:   { strict_void_mode?, strict_confidence_mode?, apply_exposure_caps? }
// }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CandidateLeg,
  HistoricalParlay,
  BacktestOptions,
  replayParlays,
  calibrate,
} from "../_shared/parlay-engine-v2/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RawParlayRow {
  id: string;
  parlay_date: string;
  created_at: string;
  strategy_name: string;
  tier: string | null;
  legs: unknown;
  outcome: string | null;
  simulated_stake: number | null;
  expected_odds: number | null;
  combined_probability: number | null;
}

function parseLegs(raw: unknown, parlayCreatedAt: string): CandidateLeg[] {
  if (!Array.isArray(raw)) return [];
  const fallbackTipoff = new Date(new Date(parlayCreatedAt).getTime() + 6 * 3600_000);
  const projUpdated = new Date(parlayCreatedAt);

  return raw.map((leg: any): CandidateLeg => {
    const sport = String(leg?.sport ?? "NBA").toUpperCase();
    const player_name = leg?.player_name ?? null;
    const team = String(leg?.team ?? "UNK");
    const opponent = String(leg?.opponent ?? "UNK");
    const prop_type = String(leg?.prop_type ?? "");
    const side = String(leg?.side ?? "OVER").toUpperCase();
    const line = Number(leg?.line ?? 0);
    const american_odds = Number(leg?.american_odds ?? -110);
    const projected = Number(leg?.projected ?? leg?.projected_value ?? line);
    const confidenceRaw = leg?.confidence;
    const confidence = confidenceRaw == null
      ? NaN
      : (confidenceRaw > 1 ? confidenceRaw / 100 : Number(confidenceRaw));
    const edgeRaw = leg?.edge;
    const edge = edgeRaw != null ? Number(edgeRaw) : projected - line;
    const signal_source = String(leg?.signal_source ?? leg?.category ?? "UNKNOWN").toUpperCase();
    const tipoff = leg?.commence_time ? new Date(leg.commence_time) : fallbackTipoff;

    return {
      sport,
      player_name,
      team,
      opponent,
      prop_type,
      side,
      line,
      american_odds,
      projected,
      confidence,
      edge,
      signal_source,
      tipoff,
      projection_updated_at: projUpdated,
      line_confirmed_on_book: leg?.is_active ?? true,
      player_active: leg?.player_active ?? true,
      defensive_context_updated_at: null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const date_start = String(body.date_start ?? "");
    const date_end = String(body.date_end ?? "");
    const mode = (body.mode ?? "both") as "backtest" | "calibrate" | "both";
    const dryRun = body.dry_run !== false;
    const runName = body.run_name ?? `replay_${date_start}_to_${date_end}`;
    const options: BacktestOptions = body.options ?? {};

    if (!DATE_RE.test(date_start) || !DATE_RE.test(date_end)) {
      return new Response(JSON.stringify({ success: false, error: "date_start/date_end must be YYYY-MM-DD" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["backtest", "calibrate", "both"].includes(mode)) {
      return new Response(JSON.stringify({ success: false, error: "mode must be backtest|calibrate|both" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pull historical parlays in window. Page through in 1000-row chunks.
    const all: RawParlayRow[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb
        .from("bot_daily_parlays")
        .select("id, parlay_date, created_at, strategy_name, tier, legs, outcome, simulated_stake, expected_odds, combined_probability")
        .gte("parlay_date", date_start)
        .lte("parlay_date", date_end)
        .order("parlay_date", { ascending: true })
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...(data as RawParlayRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const historical: HistoricalParlay[] = all.map(r => ({
      id: r.id,
      parlay_date: r.parlay_date,
      created_at: r.created_at,
      strategy_name: r.strategy_name,
      tier: r.tier,
      legs: parseLegs(r.legs, r.created_at),
      outcome: (r.outcome ?? "pending"),
      simulated_stake: r.simulated_stake ?? 1,
      expected_odds: r.expected_odds ?? -110,
      combined_probability: r.combined_probability ?? 0,
    }));

    let backtestReport = null;
    let calibrationReport = null;

    if (mode === "backtest" || mode === "both") {
      backtestReport = replayParlays(historical, options);
    }
    if (mode === "calibrate" || mode === "both") {
      calibrationReport = calibrate(historical);
    }

    let runId: string | null = null;
    if (!dryRun && backtestReport) {
      const { data: runRow, error: runErr } = await sb
        .from("backtest_runs")
        .insert({
          run_name: runName,
          builder_version: "parlay_engine_v2.1",
          date_range_start: date_start,
          date_range_end: date_end,
          completed_at: new Date().toISOString(),
          config: {
            options: backtestReport.options_used,
            backtest_report: backtestReport,
            calibration_report: calibrationReport,
          },
          total_parlays_built: backtestReport.v2_shipped.resolved + backtestReport.v2_shipped.void,
          parlay_win_rate: backtestReport.v2_shipped.wr,
          picks_blocked_by_edge: backtestReport.rejected_count,
        })
        .select("id")
        .single();
      if (runErr) throw runErr;
      runId = runRow?.id ?? null;
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      run_id: runId,
      total_parlays_in: historical.length,
      backtest_report: backtestReport,
      calibration_report: calibrationReport,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[parlay-engine-v2-backtest] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

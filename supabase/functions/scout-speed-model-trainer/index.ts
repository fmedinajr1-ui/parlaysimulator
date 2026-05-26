// Scout Speed Edge — Phase 1 model trainer.
// Pulls resolved lag_edges (actual_move IS NOT NULL), fits a logistic
// regression on hit-probability and an OLS regression on actual_move,
// and writes the resulting coefficients to scout_speed_models.
//
// Behaviour:
//   - If fewer than MIN_SAMPLES resolved rows exist, returns
//     { ok: true, skipped: "insufficient_data", n } and writes nothing.
//   - Otherwise inserts a NEW row with active=false. Activation is a
//     deliberate admin action via { activate: <version> } or { activate_latest: true }.
//   - Caller may pass { dry_run: true } to fit + return metrics without persisting.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fitLogistic,
  fitLinear,
  logLoss,
  brierScore,
  mseMove,
  type TrainingRow,
  type SpeedModelCoefficients,
} from "../_shared/scout-speed/model.ts";
import { impactScore } from "../_shared/scout-speed/scoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_SAMPLES = 200;
const HIT_THRESHOLD = 0.25; // |actual_move| ≥ this counts as a successful edge

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function activateVersion(version: number) {
  // Service-role; partial unique index enforces single-active invariant.
  const { error: clearErr } = await supabase
    .from("scout_speed_models")
    .update({ active: false })
    .eq("active", true);
  if (clearErr) return { ok: false, error: clearErr.message };
  const { error: setErr } = await supabase
    .from("scout_speed_models")
    .update({ active: true })
    .eq("version", version);
  if (setErr) return { ok: false, error: setErr.message };
  return { ok: true, version };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  // --- Activation paths (admin-driven) ---
  if (typeof body?.activate === "number") return json(await activateVersion(body.activate));
  if (body?.activate_latest === true) {
    const { data, error } = await supabase
      .from("scout_speed_models")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "no models exist" }, 404);
    return json(await activateVersion(data.version));
  }

  // --- Training path ---
  const { data: edges, error } = await supabase
    .from("lag_edges")
    .select("excess_lag_seconds, event_impact, actual_move, source_event_id, edge_type, created_at")
    .not("actual_move", "is", null)
    .order("created_at", { ascending: true });
  if (error) return json({ ok: false, error: error.message }, 500);

  // We need event_type → impact. event_impact is already stored, so use it directly,
  // and synthesize a time_remaining default of 24 (we did not persist it in lag_edges yet).
  const rows: TrainingRow[] = (edges ?? [])
    .filter((r: any) => r.excess_lag_seconds != null && r.event_impact != null && r.actual_move != null)
    .map((r: any) => ({
      excess_lag: Number(r.excess_lag_seconds),
      event_impact: Number(r.event_impact),
      time_remaining: 24,
      hit: Math.abs(Number(r.actual_move)) >= HIT_THRESHOLD ? 1 : 0,
      actual_move: Math.abs(Number(r.actual_move)),
    }));

  void impactScore; // kept for future enrichment via live_events join

  const n = rows.length;
  if (n < MIN_SAMPLES) {
    return json({
      ok: true,
      skipped: "insufficient_data",
      n,
      min_samples: MIN_SAMPLES,
      message: `Need ${MIN_SAMPLES - n} more resolved edges before training.`,
    });
  }

  // Fit
  const wProb = fitLogistic(rows);
  const wMove = fitLinear(rows);
  const ll = logLoss(rows, wProb);
  const br = brierScore(rows, wProb);
  const mse = mseMove(rows, wMove);

  const coefficients: SpeedModelCoefficients = {
    prob_intercept: wProb[0],
    prob_b_lag: wProb[1],
    prob_b_impact: wProb[2],
    prob_b_time: wProb[3],
    prob_cap: 0.95,
    move_intercept: wMove[0],
    move_b_lag: wMove[1],
    move_b_impact: wMove[2],
    move_floor: 0.05,
  };

  if (body?.dry_run === true) {
    return json({ ok: true, dry_run: true, n, log_loss: ll, brier: br, mse_move: mse, coefficients });
  }

  // Next version number
  const { data: latest } = await supabase
    .from("scout_speed_models")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const start = (edges?.[0] as any)?.created_at ?? null;
  const end = (edges?.[edges.length - 1] as any)?.created_at ?? null;

  const { data: inserted, error: insErr } = await supabase
    .from("scout_speed_models")
    .insert({
      version: nextVersion,
      coefficients,
      training_window_start: start,
      training_window_end: end,
      n_samples: n,
      log_loss: ll,
      brier: br,
      mse_move: mse,
      active: false,
      notes: body?.notes ?? null,
    })
    .select()
    .single();
  if (insErr) return json({ ok: false, error: insErr.message }, 500);

  return json({
    ok: true,
    version: nextVersion,
    n,
    log_loss: ll,
    brier: br,
    mse_move: mse,
    model_id: inserted.id,
    note: "Inserted as inactive. POST { activate: <version> } or { activate_latest: true } to promote.",
  });
});